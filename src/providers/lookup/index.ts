/**
 * Concept lookups against open medical APIs (hover card) and the cross-language term bridge.
 * All of them are `locality: 'remote'` and send nothing but the concept label / codes.
 *
 * Browser access (verified with curl, 2026-10): every API used here sends CORS headers, so no
 * lookup needs a proxy (`needsProxy: false` on each provider).
 */
export { createWikidataLookup } from './wikidata.ts';
export { createRxNavLookup } from './rxnav.ts';
export { createOpenFdaLookup } from './openfda.ts';
export type { OpenFdaLookupOptions } from './openfda.ts';
export { createMeshLookup } from './mesh.ts';
export { createOlsLookup } from './ols.ts';
export { createStaticLookup } from './static.ts';
export type { LookupFile, StaticLookupOptions } from './static.ts';
export { resolveTermVariants, createTermResolver, isDrug } from './resolve.ts';
export type { TermVariants, TermResolver, ResolveOptions } from './resolve.ts';
export type { LookupOptions, RemoteConceptLookup } from './common.ts';
export { proxyVia, ProviderError, clearResponseCache } from '../shared/http.ts';
export type { RemoteOptions } from '../shared/http.ts';
export { PROXY_ALLOWED_HOSTS, PROXY_REQUIRED_HOSTS, API_ACCESS } from '../shared/access.ts';

import type { RemoteConceptLookup, LookupOptions } from './common.ts';
import { createTermResolver } from './resolve.ts';
import { createMeshLookup } from './mesh.ts';
import { createOlsLookup } from './ols.ts';
import { createOpenFdaLookup } from './openfda.ts';
import { createRxNavLookup } from './rxnav.ts';
import { createWikidataLookup } from './wikidata.ts';

/** All lookups in recommended order, sharing one term resolver (and its cache). */
export function defaultLookups(opts: LookupOptions = {}): RemoteConceptLookup[] {
  const shared = { ...opts, resolve: opts.resolve ?? createTermResolver(opts) };
  return [
    createWikidataLookup(shared),
    createRxNavLookup(shared),
    createOpenFdaLookup(shared),
    createMeshLookup(shared),
    createOlsLookup(shared),
  ];
}
