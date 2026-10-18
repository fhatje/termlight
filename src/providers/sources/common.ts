import type { ResearchSource } from '../../core/types.ts';
import { createTermResolver } from '../lookup/resolve.ts';
import type { TermResolver } from '../lookup/resolve.ts';
import { ProviderError } from '../shared/http.ts';
import type { RemoteOptions } from '../shared/http.ts';
import { fold, unique } from '../shared/text.ts';
import { createQueryAnalyzer } from './query.ts';
import type { AnalyzedTerm, QueryAnalysis, QueryAnalyzer } from './query.ts';

export interface SourceOptions extends RemoteOptions {
  /**
   * Term bridge (German term → English name, codes); defaults to the Wikidata based
   * `resolveTermVariants`. It is called internally and cached per question.
   */
  resolve?: TermResolver;
  /** Shared query analysis; `defaultSources` passes one so all sources resolve a question once. */
  analyzer?: QueryAnalyzer;
}

/** A `ResearchSource` that also tells the integrator whether browsers need a proxy. */
export interface RemoteResearchSource extends ResearchSource {
  readonly locality: 'remote';
  readonly needsProxy: boolean;
}

export function analyzerOf(opts: SourceOptions): QueryAnalyzer {
  return opts.analyzer ?? createQueryAnalyzer(opts.resolve ?? createTermResolver(opts));
}

/**
 * A source in another language than the question depends on the term bridge. If the bridge was
 * unreachable, searching with untranslated terms would look like "no results" – fail instead.
 */
export function requireBridge(analysis: QueryAnalysis, provider: string, languages: string[]): void {
  if (analysis.resolveError && !languages.includes(analysis.language)) {
    throw new ProviderError(provider, `could not translate the search terms (${analysis.resolveError.message})`, {
      cause: analysis.resolveError,
    });
  }
}

/**
 * Substances to look up in a drug database: resolved drugs, plus terms the bridge does not know at
 * all (they may be drug names missing in Wikidata). Known non-drugs ("Niereninsuffizienz") are skipped.
 */
export function drugCandidates(analysis: QueryAnalysis, max = 2): AnalyzedTerm[] {
  const unknown = analysis.terms.filter((t) => !t.drug && !t.variants.wikidataId);
  return (analysis.drugs.length ? analysis.drugs : unknown).slice(0, max);
}

function quote(name: string): string {
  return `"${name.replace(/["()[\]]/g, ' ').trim()}"`;
}

/** English names of a term for a literature query: the INN plus a few real synonyms. */
export function literatureNames(term: AnalyzedTerm, max = 3): string[] {
  const usable = (term.variants.englishAliases ?? []).filter((a) => /^[\p{L}][\p{L} -]{3,40}$/u.test(a));
  return unique([term.english, ...usable], fold).slice(0, max);
}

/** `("a"<field> OR "b"<field>)` for every term, joined with AND, followed by the topic expressions. */
export function booleanQuery(terms: AnalyzedTerm[], topics: string[], field: (quoted: string) => string): string {
  const parts = terms.map((term) => `(${literatureNames(term).map((name) => field(quote(name))).join(' OR ')})`);
  return [...parts, ...topics].join(' AND ');
}

export function isoLanguage(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const map: Record<string, string> = { eng: 'en', ger: 'de', deu: 'de', fre: 'fr', fra: 'fr', spa: 'es', ita: 'it' };
  const c = code.toLowerCase();
  return map[c] ?? (c.length === 2 ? c : undefined);
}
