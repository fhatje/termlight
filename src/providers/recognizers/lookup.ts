import type { CallOptions, ConceptInfo, ConceptLookup, ConceptRef, PackConcept, TermPack } from '../../core/types.ts';
import { abortError, loadPacks } from './packs.ts';

export interface PackLookupOptions {
  packs: Array<string | TermPack>;
  id?: string;
  label?: string;
}

const LINKS: Record<string, (code: string) => string> = {
  Wikidata: (code) => `https://www.wikidata.org/wiki/${encodeURIComponent(code)}`,
  MeSH: (code) => `https://meshb.nlm.nih.gov/record/ui?ui=${encodeURIComponent(code)}`,
  RxNorm: (code) => `https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${encodeURIComponent(code)}`,
};

/** Answers hover lookups straight from pack data (label, synonyms, codes, definition). */
export function createPackLookup(options: PackLookupOptions): ConceptLookup {
  let index: Promise<Map<string, { pack: TermPack; concept: PackConcept }>> | null = null;
  let known: Set<string> | null = null;

  function load(): Promise<Map<string, { pack: TermPack; concept: PackConcept }>> {
    if (!index) {
      index = loadPacks(options.packs).then(({ packs }) => {
        const map = new Map<string, { pack: TermPack; concept: PackConcept }>();
        // Earlier packs win, like in the recognizer.
        for (const pack of packs) {
          for (const concept of pack.concepts) {
            const key = `${pack.id}:${concept.id}`;
            if (!map.has(key)) map.set(key, { pack, concept });
          }
        }
        known = new Set(map.keys());
        return map;
      });
      index.catch(() => {
        index = null;
      });
    }
    return index;
  }

  return {
    id: options.id ?? 'packs',
    label: options.label ?? 'Terminologie-Pakete (lokal)',
    locality: 'local',
    description: 'Zeigt Synonyme, Codes und Definitionen aus den geladenen Terminologie-Paketen; keine Netzabfrage.',

    supports(concept: ConceptRef): boolean {
      return known ? known.has(concept.conceptId) : true;
    },

    async lookup(concept: ConceptRef, opts?: CallOptions): Promise<ConceptInfo | null> {
      if (opts?.signal?.aborted) throw abortError();
      const hit = (await load()).get(concept.conceptId);
      if (opts?.signal?.aborted) throw abortError();
      if (!hit) return null;
      const { pack, concept: c } = hit;
      const info: ConceptInfo = {
        conceptId: concept.conceptId,
        title: c.label,
        type: c.type,
        language: pack.language,
        attribution: { name: pack.attribution || pack.name, license: pack.license, ...(pack.homepage ? { url: pack.homepage } : {}) },
      };
      if (c.definition) info.definition = c.definition;
      const exact = (c as PackConcept & { exact?: string[] }).exact ?? [];
      const synonyms = [...new Set([...(c.terms ?? []), ...exact])].filter((t) => t !== c.label);
      if (synonyms.length) info.synonyms = synonyms;
      // `name:en` is a hint for other providers, not a code to show.
      const codes = (c.codes ?? []).filter((code) => code.system !== 'name:en');
      if (codes.length) info.codes = codes;
      const english = (c.codes ?? []).find((code) => code.system === 'name:en');
      if (english) info.sections = [{ title: 'Englische Bezeichnung', text: english.code }];
      const links = codes.flatMap((code) => {
        const url = LINKS[code.system]?.(code.code);
        return url ? [{ label: `${code.system} ${code.code}`, url }] : [];
      });
      if (links.length) info.links = links;
      return info;
    },
  };
}
