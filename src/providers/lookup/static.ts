import type { ConceptInfo, ConceptLookup } from '../../core/types.ts';

/** A lookup file: concept id → what the card shows. Written by tools/build-lookup-cache.ts. */
export type LookupFile = Record<string, ConceptInfo>;

export interface StaticLookupOptions {
  /** URL of the lookup file (fetched once, on the first card) or the data itself. */
  source: string | LookupFile;
  id?: string;
  label?: string;
  description?: string;
}

/**
 * Term cards from a file on your own server instead of from live services. The file is built
 * ahead of time for every concept of the dictionaries, so a visitor's browser never contacts a
 * third party, nothing is stored on their device, and the public services are not asked again
 * for every visitor. A missing or unreadable file simply yields no card content.
 */
export function createStaticLookup(options: StaticLookupOptions): ConceptLookup {
  let pending: Promise<LookupFile> | null = null;
  const load = (): Promise<LookupFile> => {
    if (typeof options.source !== 'string') return Promise.resolve(options.source);
    const url = options.source;
    pending ??= fetch(url)
      .then((response) => (response.ok ? (response.json() as Promise<LookupFile>) : {}))
      .catch(() => ({}));
    return pending;
  };
  return {
    id: options.id ?? 'static',
    label: options.label ?? 'Wikidata + Wikipedia',
    // Same origin as the page: nothing about the document reaches anyone else.
    locality: 'local',
    description: options.description ?? 'Vorab gespeicherte Auszüge aus Wikidata und Wikipedia, ausgeliefert vom eigenen Server.',
    async lookup(concept) {
      const file = await load();
      return file[concept.conceptId] ?? null;
    },
  };
}
