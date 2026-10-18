import type { DictationOptions, DictationSession, Locality, SttProvider } from '../../core/types.ts';
import { httpError, isLoopbackUrl, joinUrl } from '../llm/openai-compatible.ts';
import { normalizeDictation } from './normalize-dictation.ts';

export interface OpenAiCompatibleSttOptions {
  /** e.g. `https://api.openai.com/v1`, `http://localhost:8000/v1` (faster-whisper-server). */
  baseUrl: string;
  apiKey?: string;
  /** Default `whisper-1`. */
  model?: string;
  id?: string;
  label?: string;
  locality?: Locality;
  /** Vocabulary hint passed to the model, e.g. `Arztbrief. Metamizol, Agranulozytose, Z. n. Appendektomie.` */
  prompt?: string;
  /** Apply `normalizeDictation` to transcripts. Default true. */
  normalize?: boolean;
  /** Pause length that ends a segment, in ms. Default 900. */
  silenceMs?: number;
  /** Longest segment before a forced cut, in ms. Default 30 000. */
  maxSegmentMs?: number;
  fetch?: typeof fetch;
  /** Injected for tests. */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorder?: typeof MediaRecorder;
  /** Pass `null` to disable pause detection (one segment, sent on stop). */
  AudioContext?: typeof AudioContext | null;
}

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
const POLL_MS = 100;
/** RMS of the time-domain signal (0..1) above which a frame counts as speech. */
const SPEECH_LEVEL = 0.015;

function extensionFor(mime: string): string {
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}

export function createOpenAiCompatibleStt(opts: OpenAiCompatibleSttOptions): SttProvider {
  const locality = opts.locality ?? (isLoopbackUrl(opts.baseUrl) ? 'local' : 'remote');
  const doFetch: typeof fetch = (input, init) => (opts.fetch ?? globalThis.fetch)(input, init);

  return {
    id: opts.id ?? 'openai-stt',
    label: opts.label ?? (locality === 'local' ? 'Lokales Diktat (Whisper)' : 'Diktat (Whisper, OpenAI-kompatibel)'),
    locality,
    description:
      locality === 'local'
        ? 'Diktat über einen lokalen Whisper-Server mit OpenAI-kompatibler Schnittstelle (z. B. faster-whisper-server, whisper.cpp). Die Aufnahme verlässt das Gerät bzw. das eigene Netz nicht. Text erscheint nach jeder Sprechpause.'
        : 'Diktat über eine OpenAI-kompatible Transkriptions-Schnittstelle (Whisper). Die Tonaufnahme wird an den Anbieter übertragen. Text erscheint nach jeder Sprechpause.',

    async start(o: DictationOptions): Promise<DictationSession> {
      const Recorder = opts.MediaRecorder ?? globalThis.MediaRecorder;
      const getUserMedia =
        opts.getUserMedia ?? globalThis.navigator?.mediaDevices?.getUserMedia?.bind(globalThis.navigator.mediaDevices);
      if (!Recorder || !getUserMedia) throw new Error('Dieser Browser unterstützt keine Tonaufnahme.');

      let stream: MediaStream;
      try {
        stream = await getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch (error) {
        throw new Error('Der Zugriff auf das Mikrofon wurde nicht erlaubt.', { cause: error });
      }

      const language = o.language ?? 'de';
      const mime = MIME_CANDIDATES.find((m) => Recorder.isTypeSupported?.(m));
      const requests = new AbortController();
      let stopped = false;
      // Transcriptions are chained so that `onFinal` fires in speaking order even when a later,
      // shorter segment is transcribed faster.
      let queue: Promise<void> = Promise.resolve();

      const transcribe = async (blob: Blob) => {
        const type = blob.type || mime || 'audio/webm';
        const form = new FormData();
        form.append('file', blob, `diktat.${extensionFor(type)}`);
        form.append('model', opts.model ?? 'whisper-1');
        form.append('language', language.split('-')[0]!);
        form.append('response_format', 'json');
        if (opts.prompt) form.append('prompt', opts.prompt);
        const response = await doFetch(joinUrl(opts.baseUrl, '/audio/transcriptions'), {
          method: 'POST',
          headers: opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {},
          body: form,
          signal: requests.signal,
        });
        if (!response.ok) throw await httpError(response, 'Transkription fehlgeschlagen');
        const json = (await response.json()) as { text?: string };
        const raw = json.text ?? '';
        const text = opts.normalize === false ? raw.trim() : normalizeDictation(raw, language);
        if (text) o.onFinal(text);
      };

      // --- voice activity (optional) ---------------------------------------------------------
      const Ctx = opts.AudioContext === null ? undefined : (opts.AudioContext ?? globalThis.AudioContext);
      let context: AudioContext | undefined;
      let analyser: AnalyserNode | undefined;
      let samples: Float32Array<ArrayBuffer> | undefined;
      try {
        if (Ctx) {
          context = new Ctx();
          analyser = context.createAnalyser();
          analyser.fftSize = 1024;
          context.createMediaStreamSource(stream).connect(analyser);
          samples = new Float32Array(analyser.fftSize);
        }
      } catch {
        context = analyser = samples = undefined; // no pause detection, segment on stop only
      }

      // --- recording -------------------------------------------------------------------------
      // A MediaRecorder file is only decodable as a whole (the container header is in the first
      // chunk), so each segment is its own recorder run instead of a slice of one long recording.
      let recorder: MediaRecorder | undefined;
      let segmentStart = 0;
      let segment = { heard: false };
      let silentFor = 0;

      const startSegment = () => {
        const parts: Blob[] = [];
        const current = new Recorder(stream, mime ? { mimeType: mime } : undefined);
        // Without voice detection we cannot tell silence from speech, so every segment is sent.
        const own = { heard: !analyser };
        segment = own;
        current.ondataavailable = (event) => {
          if (event.data.size) parts.push(event.data);
        };
        current.onstop = () => {
          // Whisper invents text for silent audio, so segments without speech are never sent.
          if (!parts.length || !own.heard) return;
          const blob = new Blob(parts, { type: current.mimeType || mime || 'audio/webm' });
          o.onInterim?.('…');
          queue = queue
            .then(() => transcribe(blob))
            .catch((error: unknown) => {
              if (!requests.signal.aborted) o.onError?.(error instanceof Error ? error : new Error(String(error)));
            })
            .finally(() => o.onInterim?.(''));
        };
        recorder = current;
        segmentStart = Date.now();
        silentFor = 0;
        current.start();
      };

      const rotate = () => {
        if (recorder?.state === 'recording') recorder.stop();
        if (!stopped) startSegment();
      };

      const silenceMs = opts.silenceMs ?? 900;
      const maxSegmentMs = opts.maxSegmentMs ?? 30_000;
      const timer = analyser
        ? setInterval(() => {
            if (!analyser || !samples) return;
            analyser.getFloatTimeDomainData(samples);
            let sum = 0;
            for (const s of samples) sum += s * s;
            const level = Math.sqrt(sum / samples.length);
            if (level >= SPEECH_LEVEL) {
              segment.heard = true;
              silentFor = 0;
            } else {
              silentFor += POLL_MS;
            }
            const age = Date.now() - segmentStart;
            if (segment.heard && ((silentFor >= silenceMs && age >= 1500) || age >= maxSegmentMs)) rotate();
            // Do not let a long silent stretch pile up audio that is discarded anyway.
            else if (!segment.heard && age >= maxSegmentMs) rotate();
          }, POLL_MS)
        : undefined;

      startSegment();

      const stop = async (): Promise<void> => {
        if (stopped) return queue;
        stopped = true;
        o.signal?.removeEventListener('abort', onAbort);
        if (timer) clearInterval(timer);
        const last = recorder;
        if (last && last.state !== 'inactive') {
          await new Promise<void>((resolve) => {
            const onstop = last.onstop;
            last.onstop = (event) => {
              onstop?.call(last, event);
              resolve();
            };
            last.stop();
          });
        }
        for (const track of stream.getTracks()) track.stop();
        void context?.close().catch(() => {});
        await queue;
      };
      const onAbort = () => {
        requests.abort();
        void stop();
      };
      if (o.signal?.aborted) onAbort();
      else o.signal?.addEventListener('abort', onAbort, { once: true });

      return { stop };
    },
  };
}
