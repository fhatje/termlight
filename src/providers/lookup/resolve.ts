/**
 * Cross-language bridge: German clinical term → English name, synonyms and codes, via Wikidata.
 * English-only sources (openFDA, RxNav, PubMed, …) cannot be searched with German terms; they call
 * this first. Only the term itself is sent to Wikidata.
 */
import type { CodeRef, ConceptType } from '../../core/types.ts';
import type { RemoteOptions } from '../shared/http.ts';
import { fold, unique } from '../shared/text.ts';
import { sharedWikidataApi, wikidataIdOf } from './wikidata-api.ts';
import type { WikidataApi, WikidataEntity } from './wikidata-api.ts';

export interface TermVariants {
  /** The term as given. */
  term: string;
  language: string;
  /** English name; for drugs the INN-like base name ("metamizole", not "metamizole sodium"). */
  english?: string;
  /** Other names in English and in `language` (synonyms, brand names, salt forms), English first. */
  aliases: string[];
  /** The English subset of `aliases`. */
  englishAliases?: string[];
  codes: CodeRef[];
  wikidataId?: string;
  /** Preferred label per language (`language` and `en`), when Wikidata has one. */
  labels?: Record<string, string>;
  /** Wikipedia article title per language. */
  articles?: Record<string, string>;
}

export interface ResolveOptions extends RemoteOptions {
  /** Language of `term`, default `de`. */
  language?: string;
  /** Known codes of the concept; a `Wikidata` code skips the label search. */
  codes?: CodeRef[];
  /** Helps to disambiguate the label search. */
  type?: ConceptType;
  signal?: AbortSignal;
}

const DRUG_SYSTEMS = new Set(['ATC', 'RxNorm', 'DrugBank']);

export function isDrug(variants: Pick<TermVariants, 'codes'>): boolean {
  return variants.codes.some((c) => DRUG_SYSTEMS.has(c.system));
}

function englishName(entity: WikidataEntity): string | undefined {
  const label = entity.labels['en'];
  const article = entity.articles['en']?.title.replace(/ \([^)]*\)$/, '');
  // Wikidata often labels the salt ("metamizole sodium") while the article carries the INN.
  if (label && article && entity.codes.some((c) => DRUG_SYSTEMS.has(c.system))) {
    if (fold(label).startsWith(`${fold(article)} `)) return article.toLowerCase();
  }
  return label ?? entity.inn['en'] ?? article;
}

export function variantsOf(term: string, language: string, entity: WikidataEntity | null, codes: CodeRef[] = []): TermVariants {
  if (!entity) return { term, language, aliases: [], codes: [...codes] };
  const english = englishName(entity);
  const englishNames = [
    entity.articles['en']?.title.replace(/ \([^)]*\)$/, ''),
    entity.labels['en'],
    entity.inn['en'],
    ...(entity.aliases['en'] ?? []),
  ].filter((name): name is string => !!name);
  const names = [
    ...englishNames,
    entity.labels[language],
    entity.articles[language]?.title.replace(/ \([^)]*\)$/, ''),
    ...(entity.aliases[language] ?? []),
  ].filter((name): name is string => !!name);
  const skip = new Set([fold(term), english ? fold(english) : '']);
  const articles: Record<string, string> = {};
  for (const [lang, article] of Object.entries(entity.articles)) articles[lang] = article.title;
  return {
    term,
    language,
    english,
    aliases: unique(names, fold).filter((name) => !skip.has(fold(name))).slice(0, 40),
    englishAliases: unique(englishNames, fold).filter((name) => !skip.has(fold(name))).slice(0, 20),
    codes: unique([...entity.codes, ...codes, { system: 'Wikidata', code: entity.id }], (c) => `${c.system}|${c.code}`),
    wikidataId: entity.id,
    labels: entity.labels,
    articles,
  };
}

export async function resolveWith(api: WikidataApi, term: string, opts: ResolveOptions = {}): Promise<TermVariants> {
  const language = (opts.language ?? 'de').split('-')[0]!.toLowerCase();
  const cleaned = term.trim();
  const id = wikidataIdOf({ codes: opts.codes });
  if (id) {
    const [entity] = await api.entities([id], [language], opts.signal);
    return variantsOf(cleaned, language, entity ?? null, opts.codes);
  }
  if (!cleaned) return { term: cleaned, language, aliases: [], codes: [...(opts.codes ?? [])] };
  const entity = await api.find(cleaned, { language, type: opts.type, signal: opts.signal });
  return variantsOf(cleaned, language, entity, opts.codes);
}

/**
 * Resolves a term to its English name, aliases and codes. A term Wikidata does not know as a
 * medical concept resolves to `{ term, language, aliases: [], codes }` without `english`.
 * Rejects when Wikidata cannot be reached.
 */
export function resolveTermVariants(term: string, opts: ResolveOptions = {}): Promise<TermVariants> {
  return resolveWith(sharedWikidataApi(opts), term, opts);
}

export type TermResolver = typeof resolveTermVariants;

/** A resolver bound to fixed transport options (fetch, proxy), e.g. to hand to the sources. */
export function createTermResolver(base: RemoteOptions = {}): TermResolver {
  const api = sharedWikidataApi(base);
  return (term, opts = {}) => resolveWith(api, term, opts);
}
