/**
 * Which hosts the adapters call and whether a browser can reach them directly.
 * CORS status was verified with `curl -sI -H 'Origin: http://localhost:5273'` (2026-10).
 */

export interface ApiAccess {
  hosts: string[];
  /** `true` = no `Access-Control-Allow-Origin`; browsers must go through a proxy of your own. */
  needsProxy: boolean;
  /** Politeness delay between requests to the same host. */
  minIntervalMs: number;
}

export const API_ACCESS = {
  wikidata: { hosts: ['www.wikidata.org'], needsProxy: false, minIntervalMs: 50 },
  wikipedia: { hosts: ['de.wikipedia.org', 'en.wikipedia.org'], needsProxy: false, minIntervalMs: 50 },
  rxnav: { hosts: ['rxnav.nlm.nih.gov'], needsProxy: false, minIntervalMs: 60 },
  openfda: { hosts: ['api.fda.gov'], needsProxy: false, minIntervalMs: 250 },
  mesh: { hosts: ['id.nlm.nih.gov'], needsProxy: false, minIntervalMs: 100 },
  ols: { hosts: ['www.ebi.ac.uk'], needsProxy: false, minIntervalMs: 100 },
  europepmc: { hosts: ['www.ebi.ac.uk'], needsProxy: false, minIntervalMs: 100 },
  // NCBI allows 3 requests/s without an API key.
  pubmed: { hosts: ['eutils.ncbi.nlm.nih.gov'], needsProxy: false, minIntervalMs: 350 },
  swissmedicinfo: { hosts: ['www.swissmedicinfo.ch', 'swissmedicinfo-pro.ch'], needsProxy: true, minIntervalMs: 200 },
  medlineplus: { hosts: ['wsearch.nlm.nih.gov'], needsProxy: true, minIntervalMs: 700 },
} as const satisfies Record<string, ApiAccess>;

export type ApiId = keyof typeof API_ACCESS;

/** Every hostname the adapters may call; a proxy of your own should allow exactly these and nothing else. */
export const PROXY_ALLOWED_HOSTS: string[] = [
  ...new Set(Object.values(API_ACCESS).flatMap((api) => api.hosts as readonly string[])),
];

/** Hosts that only work through the proxy in a browser. */
export const PROXY_REQUIRED_HOSTS: string[] = [
  ...new Set(
    Object.values(API_ACCESS)
      .filter((api) => api.needsProxy)
      .flatMap((api) => api.hosts as readonly string[]),
  ),
];
