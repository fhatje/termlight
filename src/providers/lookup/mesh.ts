import { API_ACCESS } from '../shared/access.ts';
import { createHttpClient, qs } from '../shared/http.ts';
import { unique } from '../shared/text.ts';
import { codeOf, languageOf, resolverOf, searchNames } from './common.ts';
import type { LookupOptions, RemoteConceptLookup } from './common.ts';

const MESH = 'https://id.nlm.nih.gov/mesh';

const TREE_CATEGORIES: Record<string, string> = {
  A: 'Anatomy',
  B: 'Organisms',
  C: 'Diseases',
  D: 'Chemicals and Drugs',
  E: 'Analytical, Diagnostic and Therapeutic Techniques, and Equipment',
  F: 'Psychiatry and Psychology',
  G: 'Phenomena and Processes',
  H: 'Disciplines and Occupations',
  I: 'Anthropology, Education, Sociology, and Social Phenomena',
  J: 'Technology, Industry, and Agriculture',
  K: 'Humanities',
  L: 'Information Science',
  M: 'Named Groups',
  N: 'Health Care',
  V: 'Publication Characteristics',
  Z: 'Geographicals',
};

type Literal = string | { '@value'?: string };
interface Descriptor {
  identifier?: string;
  label?: Literal;
  preferredConcept?: string;
  treeNumber?: string | string[];
  annotation?: Literal;
}
interface Concept {
  scopeNote?: Literal;
}
interface Details {
  terms?: { label: string; preferred?: boolean }[];
}

function literal(value: Literal | undefined): string | undefined {
  return typeof value === 'string' ? value : value?.['@value'];
}

function tail(uri: string): string {
  return uri.slice(uri.lastIndexOf('/') + 1);
}

/**
 * MeSH descriptor (U.S. National Library of Medicine): scope note, entry terms, tree numbers.
 * English only; German labels are bridged through Wikidata (MeSH id or English name).
 * CORS: yes, no proxy needed.
 */
export function createMeshLookup(opts: LookupOptions = {}): RemoteConceptLookup {
  const http = createHttpClient({ provider: 'MeSH', ...API_ACCESS.mesh }, opts);
  const resolve = resolverOf(opts);

  async function descriptorByName(names: string[], signal?: AbortSignal): Promise<string | undefined> {
    for (const name of names) {
      const hits = await http.json<{ resource: string }[]>(
        `${MESH}/lookup/descriptor?${qs({ label: name, match: 'exact', limit: 1 })}`,
        { signal },
      );
      if (hits?.[0]?.resource) return tail(hits[0].resource);
    }
    return undefined;
  }

  return {
    id: 'mesh',
    label: 'MeSH (NLM)',
    locality: 'remote',
    needsProxy: false,
    description:
      'Definition (Scope Note), Synonyme und Einordnung im MeSH-Thesaurus der U.S. National Library of Medicine. Englisch; gesendet wird nur der Begriff. Frei nutzbar mit Quellenangabe (NLM).',

    async lookup(concept, callOpts) {
      const signal = callOpts?.signal;
      let id = codeOf(concept.codes, 'MeSH');
      if (!id) {
        const variants = await resolve(concept.label, {
          language: languageOf(callOpts, opts.language),
          codes: concept.codes,
          type: concept.type,
          signal,
        });
        // Without an English name the label itself would be matched against English MeSH terms;
        // that only makes sense for internationalisms, which exact matching handles safely.
        id = codeOf(variants.codes, 'MeSH') ?? (await descriptorByName(searchNames(concept, variants, 3), signal));
      }
      if (!id || !/^[A-Z]\d+$/.test(id)) return null;

      const descriptor = await http.json<Descriptor>(`${MESH}/${id}.json`, { signal, nullOn: [404] });
      if (!descriptor?.label) return null;
      const [concept0, details] = await Promise.all([
        descriptor.preferredConcept
          ? http.json<Concept>(`${MESH}/${tail(descriptor.preferredConcept)}.json`, { signal, nullOn: [404] })
          : null,
        http.json<Details>(`${MESH}/lookup/details?${qs({ descriptor: id })}`, { signal, nullOn: [404] }),
      ]);

      const trees = [descriptor.treeNumber ?? []].flat().map(tail).sort();
      const categories = unique(trees.map((t) => TREE_CATEGORIES[t[0]!]).filter((c): c is string => !!c));
      const sections = [];
      if (trees.length) {
        sections.push({ title: 'MeSH tree numbers', text: `${trees.join(', ')}${categories.length ? ` – ${categories.join('; ')}` : ''}` });
      }
      const note = literal(descriptor.annotation);
      if (note) sections.push({ title: 'Indexing annotation', text: note });

      const url = `https://meshb.nlm.nih.gov/record/ui?ui=${id}`;
      return {
        conceptId: concept.conceptId,
        title: literal(descriptor.label) ?? concept.label,
        type: concept.type,
        definition: literal(concept0?.scopeNote),
        synonyms: (details?.terms ?? []).filter((t) => !t.preferred).map((t) => t.label).slice(0, 12),
        codes: [{ system: 'MeSH', code: id }],
        sections,
        links: [{ label: 'MeSH Browser', url }],
        language: 'en',
        attribution: {
          name: 'Medical Subject Headings (MeSH), U.S. National Library of Medicine',
          url,
          license: 'Courtesy of the U.S. National Library of Medicine; free to use with attribution',
        },
      };
    },
  };
}
