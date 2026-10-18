import type { DictationOptions, DictationSession, SttProvider } from '../../core/types.ts';
import { toSpeechLocale } from './chunking.ts';
import { normalizeDictation } from './normalize-dictation.ts';

/** Minimal shape of the (still prefixed, untyped in lib.dom) Web Speech recognition API. */
export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface WebSpeechSttOptions {
  id?: string;
  label?: string;
  /** Apply `normalizeDictation` to final results. Default true. */
  normalize?: boolean;
  /** Injected for tests; default `SpeechRecognition` / `webkitSpeechRecognition`. */
  Recognition?: new () => RecognitionLike;
}

function recognitionCtor(): (new () => RecognitionLike) | undefined {
  const g = globalThis as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition;
}

/**
 * True when the browser offers working Web Speech recognition (Chrome, Edge, Safari; not Firefox).
 * Brave exposes the API but ships without the recognition service behind it, so every session
 * ends in a `network` error.
 */
export function isSttSupported(): boolean {
  if ((globalThis.navigator as { brave?: unknown } | undefined)?.brave) return false;
  return recognitionCtor() !== undefined;
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Der Zugriff auf das Mikrofon wurde nicht erlaubt.',
  'service-not-allowed': 'Die Spracherkennung ist in diesem Browser nicht zugelassen.',
  'audio-capture': 'Kein Mikrofon gefunden.',
  network: 'Der Spracherkennungsdienst ist nicht erreichbar.',
  'language-not-supported': 'Die Sprache wird von der Spracherkennung nicht unterstützt.',
};

export function createWebSpeechStt(opts: WebSpeechSttOptions = {}): SttProvider {
  return {
    id: opts.id ?? 'webspeech',
    label: opts.label ?? 'Browser-Spracherkennung',
    // The API gives no guarantee where recognition happens; in Chrome it is a Google cloud service.
    locality: 'remote',
    description:
      'Spracherkennung des Browsers. Achtung: In Chrome (und anderen Chromium-Browsern) wird die Tonaufnahme zur Erkennung an Server von Google gesendet, in Safari an Apple – für Patientendaten ohne Einwilligung bzw. Auftragsverarbeitung nicht geeignet. Für vertrauliche Diktate einen lokalen Whisper-Server verwenden.',

    start(o: DictationOptions): Promise<DictationSession> {
      const Recognition = opts.Recognition ?? recognitionCtor();
      if (!Recognition) return Promise.reject(new Error('Dieser Browser unterstützt keine Spracherkennung.'));
      const language = o.language ?? 'de';
      const recognition = new Recognition();
      recognition.lang = toSpeechLocale(language);
      recognition.continuous = true;
      recognition.interimResults = true;

      let started = false;
      let stopping = false;
      let ended = false;
      let onEnded: (() => void) | undefined;

      return new Promise<DictationSession>((resolveStart, rejectStart) => {
        const stop = (): Promise<void> => {
          if (ended) return Promise.resolve();
          stopping = true;
          return new Promise<void>((resolve) => {
            onEnded = resolve;
            // `stop()` (unlike `abort()`) still delivers the result of what was already spoken.
            try {
              recognition.stop();
            } catch {
              ended = true;
              resolve();
            }
          });
        };

        recognition.onstart = () => {
          if (started) return;
          started = true;
          resolveStart({ stop });
        };
        recognition.onresult = (event) => {
          let interim = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            const transcript = result?.[0]?.transcript ?? '';
            if (result?.isFinal) {
              const text = opts.normalize === false ? transcript.trim() : normalizeDictation(transcript, language);
              if (text) o.onFinal(text);
            } else {
              interim += transcript;
            }
          }
          o.onInterim?.(interim.trim());
        };
        recognition.onerror = (event) => {
          // Silence and our own stop are part of normal operation, not errors.
          if (event.error === 'no-speech' || event.error === 'aborted') return;
          const error = new Error(ERRORS[event.error] ?? `Spracherkennung fehlgeschlagen (${event.error}).`);
          stopping = true;
          if (!started) rejectStart(error);
          else o.onError?.(error);
        };
        recognition.onend = () => {
          // Chrome ends a "continuous" session after a pause in speech; keep going until stopped.
          if (!stopping && started) {
            try {
              recognition.start();
              return;
            } catch {
              // fall through and end the session
            }
          }
          ended = true;
          o.onInterim?.('');
          onEnded?.();
          if (!started) rejectStart(new Error('Die Spracherkennung konnte nicht gestartet werden.'));
        };

        const onAbort = () => void stop();
        if (o.signal?.aborted) return rejectStart(new DOMException('Abgebrochen', 'AbortError'));
        o.signal?.addEventListener('abort', onAbort, { once: true });
        try {
          recognition.start();
        } catch (error) {
          rejectStart(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
  };
}
