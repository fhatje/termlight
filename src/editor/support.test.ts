import { describe, expect, it, vi } from 'vitest';
import type { ConceptInfo, ConceptLookup, ConceptRef, ResearchAnswer, ResearchProvider } from '../core/types.ts';
import { LookupStore } from './lookup-store.ts';
import { HISTORY_LIMIT, ResearchController } from './research-controller.ts';
import { answerToPlainText, formatDate, padBlock, spaceDictation } from './text-utils.ts';

const concept: ConceptRef = { conceptId: 'x:1', label: 'Metamizol', type: 'medication' };
const info = (name: string): ConceptInfo => ({ conceptId: 'x:1', title: 'Metamizol', type: 'medication', definition: name, attribution: { name } });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('LookupStore', () => {
  it('loads progressively, filters by supports() and caches per concept', async () => {
    let release!: (v: ConceptInfo) => void;
    const slow: ConceptLookup = { id: 'slow', label: 'Slow', locality: 'remote', lookup: vi.fn(() => new Promise<ConceptInfo>((r) => (release = r))) };
    const fast: ConceptLookup = { id: 'fast', label: 'Fast', locality: 'local', lookup: vi.fn(async () => info('fast')) };
    const other: ConceptLookup = { id: 'other', label: 'Other', locality: 'local', supports: (c) => c.type === 'anatomy', lookup: vi.fn(async () => info('other')) };
    const empty: ConceptLookup = { id: 'empty', label: 'Empty', locality: 'local', lookup: vi.fn(async () => null) };
    const store = new LookupStore(() => [slow, fast, other, empty]);
    const changed = vi.fn();

    store.load(concept, changed);
    expect(store.entries(concept).map((e) => [e.provider.id, e.status])).toEqual([['slow', 'loading'], ['fast', 'loading'], ['empty', 'loading']]);
    await tick();
    expect(store.entries(concept).map((e) => e.status)).toEqual(['loading', 'done', 'empty']);
    release(info('slow'));
    await tick();
    expect(store.entries(concept).map((e) => e.status)).toEqual(['done', 'done', 'empty']);
    expect(changed).toHaveBeenCalledTimes(3);
    expect(other.lookup).not.toHaveBeenCalled();

    store.load(concept, changed);
    expect(fast.lookup).toHaveBeenCalledTimes(1);
    expect(slow.lookup).toHaveBeenCalledTimes(1);
  });

  it('reports errors per provider and retries them on the next load', async () => {
    let fail = true;
    const flaky: ConceptLookup = {
      id: 'flaky',
      label: 'Flaky',
      locality: 'remote',
      lookup: vi.fn(async () => {
        if (fail) throw new Error('HTTP 503');
        return info('ok');
      }),
    };
    const throwsSync: ConceptLookup = { id: 'sync', label: 'Sync', locality: 'remote', lookup: () => { throw new Error('boom'); } };
    const store = new LookupStore(() => [flaky, throwsSync]);
    store.load(concept, () => {});
    await tick();
    expect(store.entries(concept).map((e) => [e.status, e.error?.message])).toEqual([['error', 'HTTP 503'], ['error', 'boom']]);
    fail = false;
    store.retry(concept, 'flaky', () => {});
    await tick();
    expect(store.entries(concept)[0]!.status).toBe('done');
  });
});

function answerFor(question: string): ResearchAnswer {
  return { question, answer: 'A [1]', citations: [{ index: 1, title: 'T', url: 'https://example.org', source: 'S' }], grounded: true, sourcesSearched: ['S'], provider: 'p' };
}

describe('ResearchController', () => {
  function setup(provider: ResearchProvider | undefined) {
    const answered = vi.fn();
    const changed = vi.fn();
    const controller = new ResearchController({ provider: () => provider, language: () => 'de', changed, answered });
    return { controller, answered, changed };
  }

  it('streams progress, then stores the answer and history', async () => {
    const provider: ResearchProvider = {
      id: 'p', label: 'P', locality: 'remote',
      async research(query, opts) {
        opts?.onProgress?.({ stage: 'searching', detail: 'a' });
        opts?.onProgress?.({ stage: 'searching', detail: 'b' });
        opts?.onProgress?.({ stage: 'answering', delta: 'Hal' });
        opts?.onProgress?.({ stage: 'answering', delta: 'lo' });
        expect(query).toEqual({ question: 'Frage', concept, language: 'de' });
        return answerFor(query.question);
      },
    };
    const { controller, answered } = setup(provider);
    controller.concept = concept;
    const done = controller.ask('  Frage ');
    expect(controller.status).toBe('running');
    expect(controller.stages).toEqual([{ stage: 'searching', details: ['a', 'b'] }, { stage: 'answering', details: [] }]);
    expect(controller.streamed).toBe('Hallo');
    await done;
    expect(controller.status).toBe('done');
    expect(controller.answer?.question).toBe('Frage');
    expect(answered).toHaveBeenCalledTimes(1);
    expect(controller.history).toHaveLength(1);
  });

  it('cancel aborts the request and ignores a late result', async () => {
    let signal: AbortSignal | undefined;
    let resolve!: (a: ResearchAnswer) => void;
    const provider: ResearchProvider = {
      id: 'p', label: 'P', locality: 'remote',
      research: (_q, opts) => {
        signal = opts?.signal;
        return new Promise((r) => (resolve = r));
      },
    };
    const { controller, answered } = setup(provider);
    const done = controller.ask('Frage');
    controller.cancel();
    expect(signal?.aborted).toBe(true);
    expect(controller.status).toBe('idle');
    expect(controller.cancelled).toBe(true);
    resolve(answerFor('Frage'));
    await done;
    expect(controller.answer).toBeNull();
    expect(answered).not.toHaveBeenCalled();
  });

  it('surfaces provider errors and limits the history', async () => {
    let fail = true;
    const provider: ResearchProvider = {
      id: 'p', label: 'P', locality: 'remote',
      async research(q) {
        if (fail) throw new Error('HTTP 502');
        return answerFor(q.question);
      },
    };
    const { controller } = setup(provider);
    await controller.ask('x');
    expect(controller.status).toBe('error');
    expect(controller.error).toBe('HTTP 502');
    fail = false;
    for (let i = 0; i < HISTORY_LIMIT + 3; i++) await controller.ask(`Frage ${i}`);
    await controller.ask('Frage 5');
    expect(controller.history).toHaveLength(HISTORY_LIMIT);
    expect(controller.history[0]!.question).toBe('Frage 5');
    expect(controller.history.filter((h) => h.question === 'Frage 5')).toHaveLength(1);
  });

  it('does nothing without a provider or question', async () => {
    const { controller } = setup(undefined);
    await controller.ask('Frage');
    expect(controller.status).toBe('idle');
  });
});

describe('text utils', () => {
  it('formats ISO dates the German way', () => {
    expect(formatDate('2024-03-18')).toBe('18.03.2024');
    expect(formatDate('2022-11')).toBe('11/2022');
    expect(formatDate('2021')).toBe('2021');
    expect(formatDate(undefined)).toBe('');
  });

  it('renders an answer with its source list', () => {
    const text = answerToPlainText({ ...answerFor('q'), answer: '**Fett** [1]', citations: [{ index: 1, title: 'Titel', url: 'https://example.org/x', source: 'openFDA', date: '2024-03-18' }] }, 'Quellen');
    expect(text).toBe('Fett [1]\n\nQuellen:\n[1] Titel (openFDA, 18.03.2024) – https://example.org/x');
  });

  it('spaces dictated chunks against their surroundings', () => {
    expect(spaceDictation('Kein Erguss.', 'Befund.', '')).toBe(' Kein Erguss.');
    expect(spaceDictation('Kein Erguss.', 'Befund. ', '')).toBe('Kein Erguss.');
    expect(spaceDictation(' Kein Erguss.', '', '')).toBe('Kein Erguss.');
    expect(spaceDictation('Kein Erguss.', 'x\n', 'Weiter')).toBe('Kein Erguss. ');
    expect(spaceDictation(', links', 'Erguss', '')).toBe(', links');
    expect(spaceDictation('Erguss', 'kein', '.')).toBe(' Erguss');
  });

  it('gives an inserted block its own paragraph', () => {
    expect(padBlock('X', '', '')).toBe('X');
    expect(padBlock('X', 'a.', 'b')).toBe('\n\nX\n\n');
    expect(padBlock('X', '.\n', '\n')).toBe('\nX');
    expect(padBlock('X', '\n\n', '')).toBe('X');
  });
});
