/**
 * Minimal Wikidata client shared by the hover lookup and the cross-language term bridge.
 * API: https://www.wikidata.org/w/api.php (CORS with `origin=*`, data licensed CC0).
 */
import type { CodeRef, ConceptType } from '../../core/types.ts';
import { API_ACCESS } from '../shared/access.ts';
import { createHttpClient, ProviderError, qs } from '../shared/http.ts';
import type { HttpClient, RemoteOptions } from '../shared/http.ts';
import { fold, unique } from '../shared/text.ts';

const API = 'https://www.wikidata.org/w/api.php';

/** Wikidata property → code system. Order = display order. */
const CODE_PROPS: [prop: string, system: string][] = [
  ['P494', 'ICD-10'],
  ['P7329', 'ICD-11'],
  ['P267', 'ATC'],
  ['P3345', 'RxNorm'],
  ['P486', 'MeSH'],
  ['P1554', 'UBERON'],
  ['P1402', 'FMA'],
  ['P1694', 'TA98'],
  ['P5270', 'MONDO'],
  ['P699', 'DOID'],
  ['P3841', 'HPO'],
  ['P5806', 'SNOMED CT'],
  ['P2892', 'UMLS'],
  ['P1748', 'NCIt'],
  ['P1550', 'Orphanet'],
  ['P4338', 'LOINC'],
  ['P715', 'DrugBank'],
  ['P652', 'UNII'],
  ['P231', 'CAS'],
];

/** Pure chemistry identifiers do not prove that an item is a medical concept. */
const NON_MEDICAL_SYSTEMS = new Set(['UNII', 'CAS']);

const TYPE_SYSTEMS: Partial<Record<ConceptType, string[]>> = {
  anatomy: ['UBERON', 'FMA', 'TA98'],
  medication: ['ATC', 'RxNorm', 'DrugBank'],
  substance: ['ATC', 'RxNorm', 'DrugBank', 'UNII', 'CAS'],
  disease: ['ICD-10', 'ICD-11', 'MONDO', 'DOID', 'Orphanet'],
  symptom: ['HPO', 'ICD-10', 'ICD-11', 'MeSH'],
  finding: ['HPO', 'ICD-10', 'ICD-11', 'MeSH'],
  lab: ['LOINC', 'MeSH'],
};

export interface WikidataEntity {
  id: string;
  labels: Record<string, string>;
  descriptions: Record<string, string>;
  aliases: Record<string, string[]>;
  codes: CodeRef[];
  /** Wikipedia article per language code, e.g. `de` → `{ title, url }`. */
  articles: Record<string, { title: string; url: string }>;
  /** International nonproprietary names (P2275) per language. */
  inn: Record<string, string>;
}

interface RawSnak {
  mainsnak?: { datavalue?: { value?: unknown } };
  rank?: string;
}
interface RawEntity {
  id: string;
  missing?: string;
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  aliases?: Record<string, { value: string }[]>;
  claims?: Record<string, RawSnak[]>;
  sitelinks?: Record<string, { title: string; url?: string }>;
}
interface SearchResponse {
  search?: { id: string; label?: string; match?: { type?: string; text?: string } }[];
  error?: { info?: string };
}
interface EntitiesResponse {
  entities?: Record<string, RawEntity>;
  error?: { info?: string };
}

function mapValues<T, U>(record: Record<string, T> | undefined, fn: (value: T) => U): Record<string, U> {
  const out: Record<string, U> = {};
  for (const [key, value] of Object.entries(record ?? {})) out[key] = fn(value);
  return out;
}

function normalizeCode(system: string, value: string): string {
  // Wikidata stores MONDO as `MONDO_0005249`, the ontology itself writes `MONDO:0005249`.
  if (system === 'MONDO') return value.replace(/^MONDO[_:]?/, 'MONDO:');
  if (system === 'UBERON') return `UBERON:${value.replace(/^UBERON[_:]?/, '')}`;
  return value;
}

function parseEntity(raw: RawEntity): WikidataEntity {
  const codes: CodeRef[] = [];
  for (const [prop, system] of CODE_PROPS) {
    for (const claim of raw.claims?.[prop] ?? []) {
      const value = claim.mainsnak?.datavalue?.value;
      if (typeof value === 'string' && claim.rank !== 'deprecated') {
        codes.push({ system, code: normalizeCode(system, value) });
      }
    }
  }
  const inn: Record<string, string> = {};
  for (const claim of raw.claims?.['P2275'] ?? []) {
    const value = claim.mainsnak?.datavalue?.value as { text?: string; language?: string } | undefined;
    if (value?.text && value.language && !inn[value.language]) inn[value.language] = value.text;
  }
  const articles: WikidataEntity['articles'] = {};
  for (const [site, link] of Object.entries(raw.sitelinks ?? {})) {
    const lang = /^([a-z-]+)wiki$/.exec(site)?.[1];
    if (lang) {
      articles[lang] = {
        title: link.title,
        url: link.url ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(link.title.replace(/ /g, '_'))}`,
      };
    }
  }
  return {
    id: raw.id,
    labels: mapValues(raw.labels, (l) => l.value),
    descriptions: mapValues(raw.descriptions, (d) => d.value),
    aliases: mapValues(raw.aliases, (list) => list.map((a) => a.value)),
    codes: unique(codes, (c) => `${c.system}|${c.code}`),
    articles,
    inn,
  };
}

function medicalCodeCount(entity: WikidataEntity): number {
  return entity.codes.filter((c) => !NON_MEDICAL_SYSTEMS.has(c.system)).length;
}

export interface WikidataApi {
  entities(ids: string[], languages: string[], signal?: AbortSignal): Promise<WikidataEntity[]>;
  /**
   * Best medical item for a term, or `null`. Items without any medical identifier (bands, villages,
   * papers, people) are never returned, so "Lunge" resolves to the organ or to nothing.
   */
  find(term: string, o: { language: string; type?: ConceptType; signal?: AbortSignal }): Promise<WikidataEntity | null>;
}

export function createWikidataApi(opts: RemoteOptions = {}, client?: HttpClient): WikidataApi {
  const http = client ?? createHttpClient({ provider: 'Wikidata', ...API_ACCESS.wikidata }, opts);

  async function entities(ids: string[], languages: string[], signal?: AbortSignal): Promise<WikidataEntity[]> {
    if (ids.length === 0) return [];
    const langs = unique([...languages, 'en', 'de']);
    const url = `${API}?${qs({
      action: 'wbgetentities',
      ids: ids.join('|'),
      props: 'labels|descriptions|aliases|claims|sitelinks/urls',
      languages: langs.join('|'),
      sitefilter: langs.map((l) => `${l}wiki`).join('|'),
      format: 'json',
      origin: '*',
    })}`;
    const data = await http.json<EntitiesResponse>(url, { signal });
    if (data?.error) throw new ProviderError('Wikidata', data.error.info ?? 'API error', { url });
    return ids.flatMap((id) => {
      const raw = data?.entities?.[id];
      return raw && raw.missing === undefined ? [parseEntity(raw)] : [];
    });
  }

  async function find(
    term: string,
    o: { language: string; type?: ConceptType; signal?: AbortSignal },
  ): Promise<WikidataEntity | null> {
    const url = `${API}?${qs({
      action: 'wbsearchentities',
      search: term,
      language: o.language,
      uselang: o.language,
      type: 'item',
      limit: 5,
      format: 'json',
      origin: '*',
    })}`;
    const data = await http.json<SearchResponse>(url, { signal: o.signal });
    if (data?.error) throw new ProviderError('Wikidata', data.error.info ?? 'API error', { url });
    const hits = data?.search ?? [];
    if (hits.length === 0) return null;

    const candidates = await entities(hits.map((h) => h.id), [o.language], o.signal);
    const wanted = fold(term);
    const preferred = (o.type && TYPE_SYSTEMS[o.type]) || [];
    let best: { entity: WikidataEntity; score: number } | null = null;
    for (const entity of candidates) {
      const medical = medicalCodeCount(entity);
      if (medical === 0) continue;
      const rank = hits.findIndex((h) => h.id === entity.id);
      const labels = Object.values(entity.labels).map(fold);
      const aliases = Object.values(entity.aliases).flat().map(fold);
      let score = Math.min(medical, 8) - rank * 2;
      if (labels.includes(wanted)) score += 30;
      else if (aliases.includes(wanted)) score += 22;
      else if (labels.some((l) => l.startsWith(wanted))) score += 10;
      if (entity.codes.some((c) => preferred.includes(c.system))) score += 6;
      if (!best || score > best.score) best = { entity, score };
    }
    return best?.entity ?? null;
  }

  return { entities, find };
}

// One client (and response cache) per distinct transport, so the hover lookups, the term bridge
// and all research sources share the Wikidata round trips for the same term.
const shared: { fetch?: typeof fetch; proxy?: RemoteOptions['proxy']; proxyAll?: boolean; api: WikidataApi }[] = [];

export function sharedWikidataApi(opts: RemoteOptions = {}): WikidataApi {
  let entry = shared.find((a) => a.fetch === opts.fetch && a.proxy === opts.proxy && a.proxyAll === opts.proxyAll);
  if (!entry) {
    entry = { fetch: opts.fetch, proxy: opts.proxy, proxyAll: opts.proxyAll, api: createWikidataApi(opts) };
    shared.push(entry);
    if (shared.length > 8) shared.shift();
  }
  return entry.api;
}

/** `Q…` id from a `Wikidata` code or a `wikidata:Q…` concept id. */
export function wikidataIdOf(concept: { conceptId?: string; codes?: CodeRef[] }): string | undefined {
  const code = concept.codes?.find((c) => fold(c.system) === 'wikidata' && /^Q\d+$/.test(c.code))?.code;
  if (code) return code;
  return /^wikidata:(Q\d+)$/i.exec(concept.conceptId ?? '')?.[1];
}
