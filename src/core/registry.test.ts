import { describe, expect, it, vi } from 'vitest';
import { createRegistry } from './registry.ts';
import type { ConceptLookup, Recognizer, ResearchProvider, TtsProvider } from './types.ts';

const rec = (id: string, locality: 'local' | 'remote'): Recognizer => ({
  id,
  label: id,
  locality,
  recognize: async () => [],
});
const lookup = (id: string, locality: 'local' | 'remote' = 'remote'): ConceptLookup => ({
  id,
  label: id,
  locality,
  lookup: async () => null,
});
const tts = (id: string): TtsProvider => ({
  id,
  label: id,
  locality: 'local',
  speak: () => ({ done: Promise.resolve(), pause() {}, resume() {}, cancel() {} }),
});
const research = (id: string): ResearchProvider => ({
  id,
  label: id,
  locality: 'remote',
  research: async (q) => ({
    question: q.question,
    answer: '',
    citations: [],
    grounded: false,
    sourcesSearched: [],
    provider: id,
  }),
});

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('createRegistry', () => {
  it('works with an empty config', () => {
    const r = createRegistry({}, { storage: null });
    expect(r.list('recognizers')).toEqual([]);
    expect(r.active('lookups')).toEqual([]);
    expect(r.activeOne('tts')).toBeUndefined();
    expect(r.hasActiveRemoteRecognizer()).toBe(false);
  });

  it('activates only local recognizers by default, but all lookups', () => {
    const r = createRegistry(
      {
        recognizers: [rec('dict', 'local'), rec('cloud', 'remote')],
        lookups: [lookup('pack', 'local'), lookup('wikidata', 'remote')],
      },
      { storage: null },
    );
    expect(r.active('recognizers').map((p) => p.id)).toEqual(['dict']);
    expect(r.active('lookups').map((p) => p.id)).toEqual(['pack', 'wikidata']);
    expect(r.hasActiveRemoteRecognizer()).toBe(false);
    r.setActive('recognizers', 'cloud', true);
    expect(r.hasActiveRemoteRecognizer()).toBe(true);
  });

  it('single-select slots default to the first provider and switch exclusively', () => {
    const r = createRegistry({ tts: [tts('a'), tts('b')] }, { storage: null });
    expect(r.activeOne('tts')?.id).toBe('a');
    r.setActive('tts', 'b', true);
    expect(r.active('tts').map((p) => p.id)).toEqual(['b']);
    r.setActive('tts', 'b', false);
    expect(r.activeOne('tts')).toBeUndefined();
  });

  it('persists the selection and restores it', () => {
    const storage = memoryStorage();
    const config = {
      recognizers: [rec('dict', 'local'), rec('cloud', 'remote')],
      research: [research('x'), research('y')],
    };
    const a = createRegistry(config, { storage, storageKey: 'k' });
    a.setActive('recognizers', 'cloud', true);
    a.setActive('recognizers', 'dict', false);
    a.setActive('research', 'y', true);

    const b = createRegistry(config, { storage, storageKey: 'k' });
    expect(b.active('recognizers').map((p) => p.id)).toEqual(['cloud']);
    expect(b.activeOne('research')?.id).toBe('y');
  });

  it('falls back to defaults for a stored single-select id that no longer exists', () => {
    const storage = memoryStorage();
    createRegistry({ research: [research('x'), research('y')] }, { storage }).setActive('research', 'y', true);
    const r = createRegistry({ research: [research('x')] }, { storage });
    expect(r.activeOne('research')?.id).toBe('x');
  });

  it('survives a throwing or corrupt storage', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const r = createRegistry({ recognizers: [rec('cloud', 'remote')] }, { storage: throwing });
    expect(() => r.setActive('recognizers', 'cloud', true)).not.toThrow();
    expect(r.isActive('recognizers', 'cloud')).toBe(true);

    const corrupt = memoryStorage();
    corrupt.data.set('k', '{not json');
    expect(createRegistry({ recognizers: [rec('d', 'local')] }, { storage: corrupt, storageKey: 'k' }).isActive('recognizers', 'd')).toBe(true);
  });

  it('emits change events and supports runtime registration', () => {
    const r = createRegistry({}, { storage: null });
    const listener = vi.fn();
    const off = r.subscribe(listener);
    r.register('recognizers', rec('cloud', 'remote'));
    r.register('recognizers', rec('dict', 'local'));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith({ slot: 'recognizers', reason: 'register' });
    // runtime-registered remote recognizers are still opt-in
    expect(r.active('recognizers').map((p) => p.id)).toEqual(['dict']);

    r.setActive('recognizers', 'dict', false);
    expect(listener).toHaveBeenLastCalledWith({ slot: 'recognizers', reason: 'selection' });
    r.setActive('recognizers', 'dict', false); // no-op → no event
    expect(listener).toHaveBeenCalledTimes(3);

    r.unregister('recognizers', 'dict');
    expect(r.list('recognizers').map((p) => p.id)).toEqual(['cloud']);
    off();
    r.unregister('recognizers', 'cloud');
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('replaces a provider registered under an existing id', () => {
    const r = createRegistry({ lookups: [lookup('a')] }, { storage: null });
    const replacement = lookup('a');
    r.register('lookups', replacement);
    expect(r.list('lookups')).toHaveLength(1);
    expect(r.list('lookups')[0]).toBe(replacement);
  });
});
