import type {
  ConceptLookup,
  MedEditorConfig,
  ProviderMeta,
  Recognizer,
  ResearchProvider,
  SttProvider,
  TtsProvider,
} from './types.ts';

export interface SlotMap {
  recognizers: Recognizer;
  lookups: ConceptLookup;
  tts: TtsProvider;
  stt: SttProvider;
  research: ResearchProvider;
}

export type Slot = keyof SlotMap;
export type MultiSlot = 'recognizers' | 'lookups';
export type SingleSlot = 'tts' | 'stt' | 'research';

export const SLOTS: readonly Slot[] = ['recognizers', 'lookups', 'research', 'tts', 'stt'];
export const MULTI_SLOTS: readonly MultiSlot[] = ['recognizers', 'lookups'];

export function isMultiSlot(slot: Slot): slot is MultiSlot {
  return slot === 'recognizers' || slot === 'lookups';
}

export interface RegistryChange {
  slot: Slot;
  reason: 'selection' | 'register' | 'unregister';
}

export interface RegistryOptions {
  /** localStorage key for the user's selection. `''` disables persistence. */
  storageKey?: string;
  /** Injected for tests / non-browser hosts. Defaults to `globalThis.localStorage` if usable. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

export interface Registry {
  readonly language: string | undefined;
  /** All registered providers of a slot, in registration order. */
  list<S extends Slot>(slot: S): readonly SlotMap[S][];
  /** The providers the user currently has switched on. */
  active<S extends Slot>(slot: S): SlotMap[S][];
  /** Convenience for the single-select slots. */
  activeOne<S extends SingleSlot>(slot: S): SlotMap[S] | undefined;
  isActive(slot: Slot, id: string): boolean;
  /**
   * Multi-select slots: switches one provider on/off. Single-select slots: `on` selects the
   * provider (deselecting the previous one); `off` on the selected one leaves the slot inactive.
   */
  setActive(slot: Slot, id: string, on: boolean): void;
  /** Adds (or replaces, by id) a provider at runtime. */
  register<S extends Slot>(slot: S, provider: SlotMap[S]): void;
  unregister(slot: Slot, id: string): void;
  /** True if any active recognizer sends the document text to a network service. */
  hasActiveRemoteRecognizer(): boolean;
  subscribe(listener: (change: RegistryChange) => void): () => void;
}

interface Persisted {
  v: 1;
  /** Explicit user decisions only, so providers registered later still get their defaults. */
  multi: Record<MultiSlot, Record<string, boolean>>;
  /** `null` = user explicitly chose "none". */
  single: Partial<Record<SingleSlot, string | null>>;
}

export const DEFAULT_STORAGE_KEY = 'termlight.providers.v1';

function emptyPersisted(): Persisted {
  return { v: 1, multi: { recognizers: {}, lookups: {} }, single: {} };
}

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    // Accessing the property itself can throw (sandboxed iframes, disabled cookies).
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readPersisted(storage: RegistryOptions['storage'], key: string): Persisted {
  const fallback = emptyPersisted();
  if (!storage || !key) return fallback;
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Persisted> | null;
    if (!parsed || parsed.v !== 1) return fallback;
    for (const slot of MULTI_SLOTS) {
      const map = parsed.multi?.[slot];
      if (map && typeof map === 'object') {
        for (const [id, on] of Object.entries(map)) {
          if (typeof on === 'boolean') fallback.multi[slot][id] = on;
        }
      }
    }
    for (const slot of ['tts', 'stt', 'research'] as const) {
      const id = parsed.single?.[slot];
      if (typeof id === 'string' || id === null) fallback.single[slot] = id;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * Privacy default: a recognizer sees the whole document on every keystroke, so remote ones stay
 * off until the user opts in. Lookups only ever send a single term and may start active.
 */
function defaultOn(slot: MultiSlot, provider: ProviderMeta): boolean {
  return slot === 'recognizers' ? provider.locality === 'local' : true;
}

export function createRegistry(config: MedEditorConfig = {}, opts: RegistryOptions = {}): Registry {
  const storageKey = opts.storageKey ?? DEFAULT_STORAGE_KEY;
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const persisted = readPersisted(storage, storageKey);
  const listeners = new Set<(change: RegistryChange) => void>();

  const providers: { [S in Slot]: SlotMap[S][] } = {
    recognizers: dedupe(config.recognizers),
    lookups: dedupe(config.lookups),
    tts: dedupe(config.tts),
    stt: dedupe(config.stt),
    research: dedupe(config.research),
  };

  function dedupe<T extends ProviderMeta>(list: readonly T[] | undefined): T[] {
    const byId = new Map<string, T>();
    for (const p of list ?? []) byId.set(p.id, p);
    return [...byId.values()];
  }

  function persist(): void {
    if (!storage || !storageKey) return;
    try {
      storage.setItem(storageKey, JSON.stringify(persisted));
    } catch {
      // Quota exceeded / private mode: the selection simply lasts for this session only.
    }
  }

  function emit(change: RegistryChange): void {
    for (const listener of [...listeners]) {
      try {
        listener(change);
      } catch (error) {
        console.error('[termlight] registry listener failed', error);
      }
    }
  }

  function isActive(slot: Slot, id: string): boolean {
    const list: readonly ProviderMeta[] = providers[slot];
    const provider = list.find((p) => p.id === id);
    if (!provider) return false;
    if (isMultiSlot(slot)) {
      return persisted.multi[slot][id] ?? defaultOn(slot, provider);
    }
    const chosen = persisted.single[slot as SingleSlot];
    if (chosen === null) return false;
    // A stored id whose provider is gone falls back to the first registered one.
    const effective = chosen !== undefined && list.some((p) => p.id === chosen) ? chosen : list[0]?.id;
    return effective === id;
  }

  const registry: Registry = {
    language: config.language,
    list: (slot) => providers[slot],
    active: (slot) => providers[slot].filter((p) => isActive(slot, p.id)) as never,
    activeOne: (slot) => providers[slot].find((p) => isActive(slot, p.id)) as never,
    isActive,
    setActive(slot, id, on) {
      if (!providers[slot].some((p) => p.id === id)) return;
      if (isActive(slot, id) === on) return;
      if (isMultiSlot(slot)) {
        persisted.multi[slot][id] = on;
      } else {
        persisted.single[slot as SingleSlot] = on ? id : null;
      }
      persist();
      emit({ slot, reason: 'selection' });
    },
    register(slot, provider) {
      const list = providers[slot] as ProviderMeta[];
      const index = list.findIndex((p) => p.id === provider.id);
      if (index >= 0) list[index] = provider;
      else list.push(provider);
      emit({ slot, reason: 'register' });
    },
    unregister(slot, id) {
      const list = providers[slot] as ProviderMeta[];
      const index = list.findIndex((p) => p.id === id);
      if (index < 0) return;
      list.splice(index, 1);
      emit({ slot, reason: 'unregister' });
    },
    hasActiveRemoteRecognizer: () =>
      providers.recognizers.some((p) => p.locality === 'remote' && isActive('recognizers', p.id)),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return registry;
}
