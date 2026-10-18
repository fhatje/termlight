import type { Annotation, TermPack } from '../../core/types.ts';
import type { MatcherStats } from '../../core/matcher/index.ts';

/** Messages between `createDictionaryRecognizer` and `matcher.worker.ts`. */
export type WorkerRequest =
  | { type: 'init'; packs: (string | TermPack)[]; source: string; language?: string }
  | { type: 'match'; id: number; text: string };

export type WorkerResponse =
  | { type: 'ready'; stats: MatcherStats; failed: string[] }
  | { type: 'result'; id: number; annotations: Annotation[] }
  | { type: 'error'; id?: number; message: string };
