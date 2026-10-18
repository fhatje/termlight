/** Tiny HTTP layer for the pack builder: on-disk cache, polite retries, one request at a time. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Wikimedia asks for a contact in the User-Agent; set MEDTEXT_CONTACT (mail or URL) to provide one.
export const USER_AGENT = `medtext-editor-packbuilder/0.1 (${process.env.MEDTEXT_CONTACT || 'terminology pack build, low volume'}) node/${process.versions.node}`;
export const CACHE_DIR = fileURLToPath(new URL('../.cache/', import.meta.url));
const WDQS = 'https://query.wikidata.org/sparql';

export interface HttpOptions {
  /** Ignore cached responses. */
  refresh?: boolean;
  /** Never touch the network; fail when something is not cached. */
  offline?: boolean;
  log?(message: string): void;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function cachePath(kind: string, key: string): string {
  mkdirSync(CACHE_DIR, { recursive: true });
  return `${CACHE_DIR}${kind}-${createHash('sha1').update(key).digest('hex').slice(0, 20)}.txt`;
}

async function request(url: string, init: RequestInit, options: HttpOptions): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await sleep(2000 * 2 ** attempt);
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(90_000) });
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get('retry-after'));
        lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
        options.log?.(`  ${lastError instanceof Error ? lastError.message : ''}, retrying`);
        if (retryAfter > 0) await sleep(Math.min(retryAfter, 120) * 1000);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${(await response.text()).slice(0, 300)}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (error instanceof Error && /^HTTP 4/.test(error.message)) throw error;
      options.log?.(`  ${error instanceof Error ? error.message : String(error)}, retrying`);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function cachedGet(url: string, options: HttpOptions = {}): Promise<string> {
  const file = cachePath('get', url);
  if (!options.refresh && existsSync(file)) return readFileSync(file, 'utf8');
  if (options.offline) throw new Error(`not cached (offline): ${url}`);
  const body = await request(url, { headers: { 'User-Agent': USER_AGENT } }, options);
  writeFileSync(file, body);
  return body;
}

export type SparqlRow = Record<string, string>;

/** Runs a SELECT against the Wikidata Query Service and returns plain string bindings. */
export async function sparql(query: string, options: HttpOptions = {}): Promise<SparqlRow[]> {
  const file = cachePath('wdqs', query);
  let body: string;
  if (!options.refresh && existsSync(file)) {
    body = readFileSync(file, 'utf8');
  } else {
    if (options.offline) throw new Error('SPARQL result not cached (offline)');
    body = await request(
      WDQS,
      {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/sparql-results+json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'query=' + encodeURIComponent(query),
      },
      options,
    );
    // A timeout arrives as HTTP 200 with a Java stack trace appended to truncated JSON.
    JSON.parse(body);
    writeFileSync(file, body);
    await sleep(500);
  }
  const json = JSON.parse(body) as { results: { bindings: Record<string, { value: string }>[] } };
  return json.results.bindings.map((binding) => {
    const row: SparqlRow = {};
    for (const [key, cell] of Object.entries(binding)) row[key] = cell.value;
    return row;
  });
}
