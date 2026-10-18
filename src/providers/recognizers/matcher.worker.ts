/** Web Worker: builds the trie off the main thread and answers match requests. */
import type { TermMatcher } from '../../core/matcher/index.ts';
import { createMatcher } from '../../core/matcher/index.ts';
import { loadPacks } from './packs.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

const scope = self as unknown as {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: { data: WorkerRequest }) => void) | null;
};

let matcher: Promise<TermMatcher> | null = null;

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'init') {
    matcher = loadPacks(message.packs).then(({ packs, failed }) => {
      const built = createMatcher(packs, { source: message.source, language: message.language });
      scope.postMessage({ type: 'ready', stats: built.stats, failed });
      return built;
    });
    matcher.catch((error: unknown) => scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }));
    return;
  }
  if (!matcher) {
    scope.postMessage({ type: 'error', id: message.id, message: 'matcher worker used before init' });
    return;
  }
  matcher.then(
    (m) => scope.postMessage({ type: 'result', id: message.id, annotations: m.match(message.text) }),
    (error: unknown) => scope.postMessage({ type: 'error', id: message.id, message: error instanceof Error ? error.message : String(error) }),
  );
};
