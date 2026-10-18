import type { ConceptInfo, ConceptLookup, ConceptRef, ProviderMeta } from '../core/types.ts';

export interface LookupEntry {
  provider: ProviderMeta;
  status: 'loading' | 'done' | 'empty' | 'error';
  info?: ConceptInfo;
  error?: Error;
}

interface Cached {
  status: LookupEntry['status'];
  info?: ConceptInfo;
  error?: Error;
}

/**
 * Per-concept cache of lookup results. Hovering the same term twice (or the same concept
 * elsewhere in the text) must not hit the network again; failures are retried on the next open.
 */
export class LookupStore {
  private readonly cache = new Map<string, Cached>();
  private readonly lookups: () => readonly ConceptLookup[];
  private readonly language: () => string | undefined;

  constructor(lookups: () => readonly ConceptLookup[], language: () => string | undefined = () => undefined) {
    this.lookups = lookups;
    this.language = language;
  }

  private key(provider: ProviderMeta, concept: ConceptRef): string {
    return `${provider.id}\u0000${concept.conceptId}`;
  }

  private applicable(concept: ConceptRef): ConceptLookup[] {
    return this.lookups().filter((lookup) => {
      try {
        return lookup.supports ? lookup.supports(concept) : true;
      } catch {
        return false;
      }
    });
  }

  /** Snapshot for rendering; providers that were never asked show up as `loading` after `load()`. */
  entries(concept: ConceptRef): LookupEntry[] {
    const out: LookupEntry[] = [];
    for (const provider of this.applicable(concept)) {
      const cached = this.cache.get(this.key(provider, concept));
      if (cached) out.push({ provider, ...cached });
    }
    return out;
  }

  /** Starts every lookup that has no (successful) result yet; `onChange` fires per settled provider. */
  load(concept: ConceptRef, onChange: () => void): void {
    for (const provider of this.applicable(concept)) {
      const key = this.key(provider, concept);
      const cached = this.cache.get(key);
      if (cached && cached.status !== 'error') continue;
      this.start(provider, concept, key, onChange);
    }
  }

  /** True if a lookup for this concept has never been asked. Failed ones do not count: no retries in the background. */
  missing(concept: ConceptRef): boolean {
    return this.applicable(concept).some((provider) => !this.cache.has(this.key(provider, concept)));
  }

  /** Starts the lookups that were never asked; `onDone` fires once all of them have settled. */
  prefetch(concept: ConceptRef, onDone: () => void): void {
    const pending = this.applicable(concept).filter((provider) => !this.cache.has(this.key(provider, concept)));
    let open = pending.length;
    if (open === 0) {
      onDone();
      return;
    }
    for (const provider of pending) {
      this.start(provider, concept, this.key(provider, concept), () => {
        if (--open === 0) onDone();
      });
    }
  }

  retry(concept: ConceptRef, providerId: string, onChange: () => void): void {
    const provider = this.applicable(concept).find((p) => p.id === providerId);
    if (provider) this.start(provider, concept, this.key(provider, concept), onChange);
  }

  clear(): void {
    this.cache.clear();
  }

  private start(provider: ConceptLookup, concept: ConceptRef, key: string, onChange: () => void): void {
    const entry: Cached = { status: 'loading' };
    this.cache.set(key, entry);
    const settle = (next: Cached) => {
      // A retry may have replaced this request in the meantime.
      if (this.cache.get(key) !== entry) return;
      this.cache.set(key, next);
      onChange();
    };
    const language = this.language();
    let promise: Promise<ConceptInfo | null>;
    try {
      promise = provider.lookup(concept, language ? { language } : {});
    } catch (error) {
      promise = Promise.reject(error);
    }
    promise.then(
      (info) => settle(info ? { status: 'done', info } : { status: 'empty' }),
      (error: unknown) => settle({ status: 'error', error: error instanceof Error ? error : new Error(String(error)) }),
    );
  }
}
