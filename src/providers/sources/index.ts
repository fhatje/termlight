/**
 * Research sources: open medical APIs that return documents with section-level passages for the
 * research pipeline. All are `locality: 'remote'` and send only the question's search terms.
 *
 * Browser access (verified with curl, 2026-10) – see `needsProxy` on each source:
 *   swissmedicinfo  no CORS → proxy required
 *   medlineplus     no CORS → proxy required
 *   openfda-label, europepmc, pubmed, wikipedia-*: CORS, direct
 */
export { createSwissmedicInfoSource, parseFachinformation } from './swissmedicinfo.ts';
export type { SwissmedicInfoSourceOptions } from './swissmedicinfo.ts';
export { createOpenFdaLabelSource } from './openfda-label.ts';
export type { OpenFdaLabelSourceOptions } from './openfda-label.ts';
export { createEuropePmcSource } from './europepmc.ts';
export type { EuropePmcSourceOptions } from './europepmc.ts';
export { createPubMedSource } from './pubmed.ts';
export type { PubMedSourceOptions } from './pubmed.ts';
export { createWikipediaSource } from './wikipedia.ts';
export type { WikipediaSourceOptions } from './wikipedia.ts';
export { createMedlinePlusSource } from './medlineplus.ts';
export { createHttpSource } from './http-source.ts';
export type { HttpSourceOptions } from './http-source.ts';
export { createQueryAnalyzer, detectTopics, extractTerms, rankPassages } from './query.ts';
export type { QueryAnalysis, QueryAnalyzer, AnalyzedTerm, Topic } from './query.ts';
export type { SourceOptions, RemoteResearchSource } from './common.ts';
export { proxyVia, ProviderError, clearResponseCache } from '../shared/http.ts';
export type { RemoteOptions } from '../shared/http.ts';
export { PROXY_ALLOWED_HOSTS, PROXY_REQUIRED_HOSTS, API_ACCESS } from '../shared/access.ts';

import { createTermResolver } from '../lookup/resolve.ts';
import type { RemoteResearchSource, SourceOptions } from './common.ts';
import { createEuropePmcSource } from './europepmc.ts';
import { createMedlinePlusSource } from './medlineplus.ts';
import { createOpenFdaLabelSource } from './openfda-label.ts';
import { createPubMedSource } from './pubmed.ts';
import { createQueryAnalyzer } from './query.ts';
import { createSwissmedicInfoSource } from './swissmedicinfo.ts';
import { createWikipediaSource } from './wikipedia.ts';

export interface DefaultSourcesOptions extends SourceOptions {
  /** Edition of the Wikipedia source, default `de`. */
  language?: string;
  /**
   * Also include PubMed and MedlinePlus. Off by default: PubMed returns largely the same
   * records as Europe PMC, MedlinePlus is written for patients.
   */
  all?: boolean;
  /** Optional openFDA / NCBI API keys (higher rate limits only). */
  openFdaApiKey?: string;
  ncbiApiKey?: string;
  email?: string;
}

/**
 * Recommended sources in priority order: authority-approved German product information first,
 * then the US label, literature, and Wikipedia last. All share one term resolver and one query
 * analysis, so a question is translated once.
 */
export function defaultSources(opts: DefaultSourcesOptions = {}): RemoteResearchSource[] {
  const resolve = opts.resolve ?? createTermResolver(opts);
  const shared: SourceOptions = { ...opts, resolve, analyzer: opts.analyzer ?? createQueryAnalyzer(resolve) };
  const sources = [
    createSwissmedicInfoSource(shared),
    createOpenFdaLabelSource({ ...shared, apiKey: opts.openFdaApiKey }),
    createEuropePmcSource({ ...shared, email: opts.email }),
    ...(opts.all ? [createPubMedSource({ ...shared, apiKey: opts.ncbiApiKey, email: opts.email })] : []),
    createWikipediaSource({ ...shared, language: opts.language ?? 'de' }),
    ...(opts.all ? [createMedlinePlusSource(shared)] : []),
  ];
  return sources;
}
