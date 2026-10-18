import type { CallOptions, SpeakOptions, SpeechHandle, TtsProvider, Voice } from '../../core/types.ts';
import { splitIntoChunks, toSpeechLocale } from './chunking.ts';

export interface WebSpeechTtsOptions {
  id?: string;
  label?: string;
  /** Injected for tests; default `window.speechSynthesis` / `SpeechSynthesisUtterance`. */
  synth?: SpeechSynthesis;
  Utterance?: typeof SpeechSynthesisUtterance;
}

export function isTtsSupported(): boolean {
  return typeof globalThis.speechSynthesis !== 'undefined' && typeof globalThis.SpeechSynthesisUtterance !== 'undefined';
}

function baseLanguage(tag: string): string {
  return tag.toLowerCase().replace('_', '-').split('-')[0] ?? '';
}

/** Voices for `language` first (exact region before same language), on-device before network voices. */
export function sortVoices(voices: SpeechSynthesisVoice[], language?: string): SpeechSynthesisVoice[] {
  const wanted = language ? toSpeechLocale(language).toLowerCase() : undefined;
  const base = wanted ? baseLanguage(wanted) : undefined;
  const rank = (v: SpeechSynthesisVoice) => {
    const lang = v.lang.toLowerCase().replace('_', '-');
    return (wanted && lang === wanted ? 0 : 4) + (v.localService ? 0 : 2) + (v.default ? 0 : 1);
  };
  return voices
    .filter((v) => !base || baseLanguage(v.lang) === base)
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export function createWebSpeechTts(opts: WebSpeechTtsOptions = {}): TtsProvider {
  const getSynth = () => opts.synth ?? globalThis.speechSynthesis;
  const getUtterance = () => opts.Utterance ?? globalThis.SpeechSynthesisUtterance;

  // Chrome fills the voice list asynchronously and announces it with `voiceschanged`.
  const loadVoices = async (): Promise<SpeechSynthesisVoice[]> => {
    const synth = getSynth();
    if (!synth) return [];
    const now = synth.getVoices();
    if (now.length) return now;
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        synth.removeEventListener?.('voiceschanged', done);
        resolve(synth.getVoices());
      };
      const timer = setTimeout(done, 1000);
      synth.addEventListener?.('voiceschanged', done);
    });
  };

  return {
    id: opts.id ?? 'webspeech',
    label: opts.label ?? 'Browser-Sprachausgabe',
    locality: 'local',
    description:
      'Sprachausgabe des Browsers bzw. Betriebssystems, ohne Zusatzdienst. Achtung: Manche Browser-Stimmen (z. B. „Google Deutsch“ in Chrome, „Online“-Stimmen in Edge) sind Netzwerkstimmen und senden den Text an den Hersteller – in der Stimmenliste als „online“ gekennzeichnet.',

    async voices(o?: CallOptions): Promise<Voice[]> {
      return sortVoices(await loadVoices(), o?.language).map((v) => ({
        id: v.voiceURI,
        label: `${v.name}${v.localService ? '' : ' (online)'}`,
        language: v.lang,
      }));
    },

    speak(text: string, o: SpeakOptions = {}): SpeechHandle {
      const synth = getSynth();
      const Utterance = getUtterance();
      if (!synth || !Utterance) {
        return failed(new Error('Dieser Browser unterstützt keine Sprachausgabe.'));
      }
      // Chrome silently stops utterances after roughly 15 s (network voices) and can hang on long
      // ones; speaking sentence-sized utterances one after the other avoids both.
      const chunks = splitIntoChunks(text);
      const locale = toSpeechLocale(o.language);
      let cancelled = false;
      let sawWordBoundary = false;
      let resolve!: () => void;
      let reject!: (e: Error) => void;
      const done = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const onAbort = () => handle.cancel();
      o.signal?.addEventListener('abort', onAbort, { once: true });
      const finish = (error?: Error) => {
        o.signal?.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve();
      };

      const speakChunk = (i: number, voice: SpeechSynthesisVoice | undefined) => {
        const chunk = chunks[i];
        if (cancelled || !chunk) return finish();
        const utterance = new Utterance(chunk.text);
        utterance.lang = voice?.lang ?? locale;
        if (voice) utterance.voice = voice;
        if (o.rate) utterance.rate = o.rate;
        utterance.onstart = () => {
          // Many voices never fire word boundaries; highlight per sentence until one shows up.
          if (!sawWordBoundary) o.onBoundary?.(chunk.offset, chunk.text.trimEnd().length);
        };
        utterance.onboundary = (event) => {
          if (event.name && event.name !== 'word') return;
          sawWordBoundary = true;
          const rest = chunk.text.slice(event.charIndex);
          const length = event.charLength || (rest.match(/^[^\s]+/)?.[0].length ?? 0);
          o.onBoundary?.(chunk.offset + event.charIndex, length);
        };
        utterance.onend = () => speakChunk(i + 1, voice);
        utterance.onerror = (event) => {
          if (cancelled || event.error === 'canceled' || event.error === 'interrupted') return finish();
          cancelled = true;
          finish(new Error(`Sprachausgabe fehlgeschlagen (${event.error}).`));
        };
        synth.speak(utterance);
      };

      const handle: SpeechHandle = {
        done,
        pause: () => synth.pause(),
        resume: () => synth.resume(),
        cancel: () => {
          if (cancelled) return;
          cancelled = true;
          synth.cancel();
          finish();
        },
      };

      if (o.signal?.aborted) {
        cancelled = true;
        finish();
        return handle;
      }
      // A previous read-aloud may still be queued; the engine is a single global queue.
      synth.cancel();
      void loadVoices().then((all) => {
        const voice = (o.voice ? all.find((v) => v.voiceURI === o.voice || v.name === o.voice) : undefined) ?? sortVoices(all, locale)[0];
        speakChunk(0, voice);
      });
      return handle;
    },
  };
}

export function failed(error: Error): SpeechHandle {
  const done = Promise.reject(error);
  done.catch(() => {}); // the caller may only look at `done` later
  return { done, pause() {}, resume() {}, cancel() {} };
}
