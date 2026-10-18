import type { Annotation, CallOptions, Recognizer, TermPack } from '../../core/types.ts';
import type { MatcherOptions, MatcherStats } from '../../core/matcher/index.ts';
import { createMatcher } from '../../core/matcher/index.ts';
import { abortError, loadPacks, resolvePackUrl } from './packs.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

export interface DictionaryRecognizerOptions {
  /** Pack URLs (JSON, fetched lazily on the first `recognize`) or inline packs; earlier = higher priority. */
  packs: Array<string | TermPack>;
  /**
   * Language of the documents (`de`, `en`, `fr`). Selects the negation / uncertainty / laterality
   * rules; packs of another language are matched under a stricter guard. Default: German and
   * English rules together.
   */
  language?: string;
  id?: string;
  label?: string;
  /** Build the trie and match in a Web Worker. Default: true where `Worker` exists. */
  useWorker?: boolean;
  /** Matcher tuning; only applied on the main thread (functions/regexes do not cross to a worker). */
  matcher?: Omit<MatcherOptions, 'source'>;
}

export interface DictionaryRecognizer extends Recognizer {
  /** Resolves once the packs are loaded and the trie is built; useful for preloading. */
  ready(): Promise<{ stats: MatcherStats; failed: string[]; worker: boolean }>;
}

interface Engine {
  worker: boolean;
  stats: MatcherStats;
  failed: string[];
  match(text: string): Promise<Annotation[]>;
  dispose(): void;
}

function createWorkerEngine(packs: Array<string | TermPack>, source: string, language?: string): Promise<Engine> {
  return new Promise<Engine>((resolve, reject) => {
    const worker = new Worker(new URL('./matcher.worker.ts', import.meta.url), { type: 'module' });
    let nextId = 1;
    let ready = false;
    // At most one request is inside the worker; the others queue up. Several editors may share one
    // recognizer, so a newer text must not cancel an older one: it may belong to another editor.
    let running: { id: number; resolve(a: Annotation[]): void; reject(e: Error): void } | null = null;
    const waiting: { text: string; resolve(a: Annotation[]): void; reject(e: Error): void }[] = [];
    const post = (message: WorkerRequest): void => worker.postMessage(message);

    const pump = (): void => {
      const next = running ? undefined : waiting.shift();
      if (!next) return;
      running = { id: nextId++, resolve: next.resolve, reject: next.reject };
      post({ type: 'match', id: running.id, text: next.text });
    };
    const failAll = (error: Error): void => {
      running?.reject(error);
      for (const request of waiting.splice(0)) request.reject(error);
      running = null;
    };

    worker.onmessage = (event: MessageEvent<WorkerResponse>): void => {
      const message = event.data;
      if (message.type === 'ready') {
        ready = true;
        resolve({
          worker: true,
          stats: message.stats,
          failed: message.failed,
          match(text) {
            return new Promise<Annotation[]>((res, rej) => {
              waiting.push({ text, resolve: res, reject: rej });
              pump();
            });
          },
          dispose() {
            worker.terminate();
            failAll(abortError('recognizer disposed'));
          },
        });
        return;
      }
      if (message.type === 'error' && !ready) {
        worker.terminate();
        reject(new Error(message.message));
        return;
      }
      if (!running || (message.id !== undefined && message.id !== running.id)) return;
      const done = running;
      running = null;
      if (message.type === 'result') done.resolve(message.annotations);
      else done.reject(new Error(message.message));
      pump();
    };
    worker.onerror = (event: ErrorEvent): void => {
      const error = new Error(event.message || 'matcher worker failed');
      if (!ready) {
        worker.terminate();
        reject(error);
      } else failAll(error);
    };
    post({ type: 'init', packs: packs.map((p) => (typeof p === 'string' ? resolvePackUrl(p) : p)), source, language });
  });
}

async function createMainEngine(packs: Array<string | TermPack>, source: string, options?: Omit<MatcherOptions, 'source'>): Promise<Engine> {
  const loaded = await loadPacks(packs);
  const matcher = createMatcher(loaded.packs, { ...options, source });
  return {
    worker: false,
    stats: matcher.stats,
    failed: loaded.failed,
    match: (text) => Promise.resolve(matcher.match(text)),
    dispose() {},
  };
}

const TEXT: Record<string, { label: string; description: string }> = {
  de: {
    label: 'Wörterbuch (lokal)',
    description: 'Gleicht den Text im Browser mit Terminologie-Paketen ab; der Text verlässt das Gerät nicht.',
  },
  en: {
    label: 'Dictionary (local)',
    description: 'Matches the text against terminology packs in the browser; the text never leaves the device.',
  },
  fr: {
    label: 'Dictionnaire (local)',
    description: 'Compare le texte aux paquets terminologiques dans le navigateur ; le texte ne quitte pas l’appareil.',
  },
};

/**
 * Local dictionary recognizer: matches the given term packs against the text. Nothing leaves the
 * device apart from fetching the pack files themselves.
 *
 * A `recognize` call rejects with an `AbortError` when its signal aborts. Calls are answered in
 * order, so one recognizer can serve several editors.
 */
export function createDictionaryRecognizer(options: DictionaryRecognizerOptions): DictionaryRecognizer {
  const id = options.id ?? 'dictionary';
  const wantWorker = (options.useWorker ?? true) && typeof Worker !== 'undefined' && !options.matcher;
  const text = TEXT[(options.language ?? 'de').toLowerCase().split('-')[0] ?? 'de'] ?? (TEXT.de as { label: string; description: string });
  let engine: Promise<Engine> | null = null;
  let disposed = false;

  function start(): Promise<Engine> {
    if (!engine) {
      const main = (): Promise<Engine> => createMainEngine(options.packs, id, { language: options.language, ...options.matcher });
      engine = wantWorker
        ? Promise.resolve()
            .then(() => createWorkerEngine(options.packs, id, options.language))
            .catch((error: unknown) => {
              console.warn(`[${id}] Worker nicht verfügbar, Abgleich läuft im Hauptthread:`, error);
              return main();
            })
        : main();
      engine.then(
        (e) => {
          if (disposed) e.dispose();
          for (const failure of e.failed) console.warn(`[${id}] Paket übersprungen: ${failure}`);
        },
        () => {
          engine = null; // allow a retry on the next call (e.g. network back)
        },
      );
    }
    return engine;
  }

  return {
    id,
    label: options.label ?? text.label,
    locality: 'local',
    description: text.description,

    async recognize(text: string, opts?: CallOptions): Promise<Annotation[]> {
      const check = (): void => {
        if (opts?.signal?.aborted) throw abortError();
        if (disposed) throw abortError('recognizer disposed');
      };
      check();
      const e = await start();
      check();
      if (text.length === 0) return [];
      const result = await e.match(text);
      check();
      return result;
    },

    async ready() {
      const e = await start();
      return { stats: e.stats, failed: e.failed, worker: e.worker };
    },

    dispose(): void {
      disposed = true;
      void engine?.then((e) => e.dispose()).catch(() => undefined);
    },
  };
}
