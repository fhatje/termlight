import type { CallOptions, Locality, SpeakOptions, SpeechHandle, TtsProvider, Voice } from '../../core/types.ts';
import { httpError, isLoopbackUrl, joinUrl } from '../llm/openai-compatible.ts';
import { splitIntoChunks } from './chunking.ts';
import type { TextChunk } from './chunking.ts';

/** The part of `HTMLAudioElement` the provider uses (injectable for tests). */
export interface AudioLike {
  src: string;
  onended: ((this: never, ev: never) => unknown) | null;
  onerror: ((this: never, ev: never) => unknown) | null;
  play(): Promise<void>;
  pause(): void;
}

export interface OpenAiCompatibleTtsOptions {
  /** e.g. `https://api.openai.com/v1`, `http://localhost:8880/v1` (Kokoro-FastAPI). */
  baseUrl: string;
  apiKey?: string;
  /** Default `tts-1`, which local servers accept as an alias as well. */
  model?: string;
  /** Default `alloy`. */
  voice?: string;
  /** Voices offered in the UI when the server has no `/audio/voices` route. */
  voices?: string[];
  id?: string;
  label?: string;
  locality?: Locality;
  fetch?: typeof fetch;
  createAudio?: () => AudioLike;
}

const OPENAI_VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'];

export function createOpenAiCompatibleTts(opts: OpenAiCompatibleTtsOptions): TtsProvider {
  const locality = opts.locality ?? (isLoopbackUrl(opts.baseUrl) ? 'local' : 'remote');
  const doFetch: typeof fetch = (input, init) => (opts.fetch ?? globalThis.fetch)(input, init);
  const headers = (extra: Record<string, string> = {}) => ({
    ...extra,
    ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
  });

  return {
    id: opts.id ?? 'openai-tts',
    label: opts.label ?? (locality === 'local' ? 'Lokale Sprachausgabe (OpenAI-kompatibel)' : 'Sprachausgabe (OpenAI-kompatibel)'),
    locality,
    description:
      locality === 'local'
        ? 'Sprachsynthese über einen lokalen Server mit OpenAI-kompatibler Schnittstelle (z. B. Kokoro-FastAPI, openedai-speech, LocalAI). Der Text verlässt das Gerät bzw. das eigene Netz nicht.'
        : 'Sprachsynthese über eine OpenAI-kompatible Schnittstelle. Der vorzulesende Text wird an den Anbieter übertragen.',

    async voices(o?: CallOptions): Promise<Voice[]> {
      const fallback = (opts.voices ?? OPENAI_VOICES).map((v) => ({ id: v, label: v }));
      try {
        // Not part of the OpenAI API, but Kokoro-FastAPI and others expose it.
        const response = await doFetch(joinUrl(opts.baseUrl, '/audio/voices'), { headers: headers(), signal: o?.signal });
        if (!response.ok) return fallback;
        const json = (await response.json()) as { voices?: (string | { id?: string; name?: string })[] };
        const listed = (json.voices ?? []).flatMap((v) => {
          const id = typeof v === 'string' ? v : (v.id ?? v.name);
          return id ? [{ id, label: typeof v === 'string' ? v : (v.name ?? id) }] : [];
        });
        return listed.length ? listed : fallback;
      } catch {
        return fallback;
      }
    },

    speak(text: string, o: SpeakOptions = {}): SpeechHandle {
      // Sentence-sized requests: the first one returns quickly, so playback starts long before
      // the whole text is synthesised.
      const chunks = splitIntoChunks(text, 300, 500);
      const abort = new AbortController();
      const audio: AudioLike = opts.createAudio ? opts.createAudio() : (new Audio() as unknown as AudioLike);
      const urls: string[] = [];
      let finished = false;
      let paused = false;
      let loaded = false;
      let resolve!: () => void;
      let reject!: (e: Error) => void;
      const done = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });

      const cleanup = () => {
        finished = true;
        abort.abort();
        o.signal?.removeEventListener('abort', cancel);
        audio.onended = audio.onerror = null;
        for (const url of urls) URL.revokeObjectURL(url);
      };
      const cancel = () => {
        if (finished) return;
        audio.pause();
        cleanup();
        resolve();
      };
      const fail = (error: unknown) => {
        if (finished) return;
        audio.pause();
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      const synthesize = async (chunk: TextChunk): Promise<string> => {
        const response = await doFetch(joinUrl(opts.baseUrl, '/audio/speech'), {
          method: 'POST',
          headers: headers({ 'content-type': 'application/json' }),
          body: JSON.stringify({
            model: opts.model ?? 'tts-1',
            voice: o.voice ?? opts.voice ?? 'alloy',
            input: chunk.text.trim(),
            response_format: 'mp3',
            ...(o.rate && o.rate !== 1 ? { speed: Math.min(4, Math.max(0.25, o.rate)) } : {}),
          }),
          signal: abort.signal,
        });
        if (!response.ok) throw await httpError(response, 'Sprachsynthese fehlgeschlagen');
        const url = URL.createObjectURL(await response.blob());
        urls.push(url);
        return url;
      };

      const play = (url: string) =>
        new Promise<void>((res, rej) => {
          audio.onended = () => res();
          audio.onerror = () => rej(new Error('Audiowiedergabe fehlgeschlagen.'));
          audio.src = url;
          loaded = true;
          if (!paused) audio.play().catch(rej);
        });

      const run = async () => {
        let next = chunks[0] ? synthesize(chunks[0]) : undefined;
        for (let i = 0; i < chunks.length && next; i++) {
          const url = await next;
          if (finished) return;
          // Synthesise one chunk ahead while the current one plays.
          const upcoming = chunks[i + 1];
          next = upcoming ? synthesize(upcoming) : undefined;
          next?.catch(() => {}); // surfaced when awaited above
          const chunk = chunks[i]!;
          o.onBoundary?.(chunk.offset, chunk.text.trimEnd().length);
          await play(url);
          if (finished) return;
        }
        cleanup();
        resolve();
      };

      if (o.signal?.aborted) {
        cancel();
      } else {
        o.signal?.addEventListener('abort', cancel, { once: true });
        run().catch(fail);
      }

      return {
        done,
        pause() {
          paused = true;
          audio.pause();
        },
        resume() {
          if (!paused || finished) return;
          paused = false;
          if (loaded) audio.play().catch(fail);
        },
        cancel,
      };
    },
  };
}
