/**
 * Shared fetch helper of all open-API adapters (concept lookups and research sources).
 *
 * The module runs in the browser, so every adapter declares whether its API sends CORS headers.
 * APIs without CORS are only reachable through a proxy you run yourself: pass `proxy` (see `proxyVia`) and
 * requests to those hosts are rewritten to `/api/proxy?url=<encoded>`. In Node (tools, tests) no
 * proxy is needed.
 */

/** Options accepted by every adapter factory. */
export interface RemoteOptions {
  /** Defaults to the global `fetch`, resolved per request. */
  fetch?: typeof fetch;
  /** Rewrites an absolute API URL to the URL of your own proxy. Applied to hosts without CORS only. */
  proxy?: (url: string) => string;
  /** Route every request through `proxy`, including hosts that do send CORS headers. */
  proxyAll?: boolean;
  /** Per request, default 12 s. */
  timeoutMs?: number;
  /** In-memory response cache, default 10 min. `0` disables it. */
  cacheTtlMs?: number;
  /**
   * Lifetime of the persistent response cache (browser Cache Storage), default 7 days. Terms in
   * reports repeat, so over time most lookups are answered from here and never reach the API.
   * `0` disables it.
   */
  persistTtlMs?: number;
  /** Minimum pause between two requests to the same host, default 1 s. Raised per API if it asks for more. */
  minIntervalMs?: number;
}

/** `proxyVia()` → `(url) => '/api/proxy?url=' + encodeURIComponent(url)`. */
export function proxyVia(endpoint = '/api/proxy'): (url: string) => string {
  return (url) => `${endpoint}${endpoint.includes('?') ? '&' : '?'}url=${encodeURIComponent(url)}`;
}

/** Every failure of a remote adapter: network, timeout, HTTP status, unexpected payload. */
export class ProviderError extends Error {
  readonly provider: string;
  readonly status?: number;
  readonly url?: string;

  constructor(provider: string, message: string, info: { status?: number; url?: string; cause?: unknown } = {}) {
    super(`${provider}: ${message}`, info.cause === undefined ? undefined : { cause: info.cause });
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = info.status;
    this.url = info.url;
  }
}

export interface ClientConfig {
  /** Used as prefix of error messages. */
  provider: string;
  /** `true` when the API sends no `Access-Control-Allow-Origin` (verified with curl). */
  needsProxy: boolean;
  /** Politeness delay between two requests to the same host. */
  minIntervalMs?: number;
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Resolve to `null` on these statuses instead of rejecting (APIs that answer "no hit" with 404). */
  nullOn?: number[];
  headers?: Record<string, string>;
  /** JSON body; switches the request to POST and bypasses the cache. */
  body?: unknown;
  timeoutMs?: number;
}

export interface HttpClient {
  json<T = unknown>(url: string, opts?: RequestOptions): Promise<T | null>;
  text(url: string, opts?: RequestOptions): Promise<string | null>;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_CACHE_TTL_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 300;
const DEFAULT_PERSIST_TTL_MS = 7 * 24 * 60 * 60_000;
const DEFAULT_MIN_INTERVAL_MS = 1000;
const PERSIST_CACHE_NAME = 'termlight-http-v1';
const STORED_AT_HEADER = 'x-termlight-stored-at';
const MAX_RETRIES = 2;
const RETRY_STATUS = new Set([429, 503]);

/**
 * Wikimedia and NCBI throttle clients without a descriptive User-Agent. Browsers send their own
 * (and must not be given one: it would force a CORS preflight); Node needs it set explicitly.
 */
const NODE_HEADERS: Record<string, string> =
  typeof document === 'undefined' && typeof navigator !== 'undefined' && /^node/i.test(navigator.userAgent ?? '')
    ? { 'User-Agent': 'termlight/0.1 (+https://github.com/fhatje/termlight)' }
    : {};

/** Next free request slot per host, shared by all clients so parallel adapters stay polite. */
const hostSlots = new Map<string, number>();

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

/** Lets a caller abandon a shared (cached) request without cancelling it for other callers. */
export function raceSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSlot(host: string, minIntervalMs: number): Promise<void> {
  if (minIntervalMs <= 0) return;
  const now = Date.now();
  const slot = Math.max(now, hostSlots.get(host) ?? 0);
  hostSlots.set(host, slot + minIntervalMs);
  if (slot > now) await sleep(slot - now);
}

/** Cache Storage exists in browsers on secure origins (and localhost) only; everywhere else this is a no-op. */
async function openPersistentCache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(PERSIST_CACHE_NAME);
  } catch {
    return null;
  }
}

async function readPersisted(url: string, ttlMs: number): Promise<string | null> {
  const store = await openPersistentCache();
  if (!store) return null;
  try {
    const hit = await store.match(url);
    if (!hit) return null;
    const storedAt = Number(hit.headers.get(STORED_AT_HEADER));
    if (!Number.isFinite(storedAt) || Date.now() - storedAt > ttlMs) {
      void store.delete(url);
      return null;
    }
    return await hit.text();
  } catch {
    return null;
  }
}

async function persist(url: string, body: string): Promise<void> {
  const store = await openPersistentCache();
  if (!store) return;
  try {
    await store.put(url, new Response(body, { headers: { [STORED_AT_HEADER]: String(Date.now()) } }));
  } catch {
    // Quota exceeded or storage blocked: the cache is an optimisation, never a requirement.
  }
}

/** Empties the persistent response cache of all adapters. */
export async function clearResponseCache(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') await caches.delete(PERSIST_CACHE_NAME);
  } catch {
    // nothing to clear
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function createHttpClient(config: ClientConfig, opts: RemoteOptions = {}): HttpClient {
  const ttl = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const persistTtl = opts.persistTtlMs ?? DEFAULT_PERSIST_TTL_MS;
  const minInterval = Math.max(config.minIntervalMs ?? 0, opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS);
  const cache = new Map<string, { expires: number; body: Promise<string | null> }>();

  async function load(url: string, req: RequestOptions): Promise<string | null> {
    const host = hostOf(url);
    const persistable = persistTtl > 0 && req.body === undefined;
    if (persistable) {
      const stored = await readPersisted(url, persistTtl);
      if (stored !== null) return stored;
    }
    await waitForSlot(host, minInterval);

    const doFetch = opts.fetch ?? globalThis.fetch;
    const target = opts.proxy && (config.needsProxy || opts.proxyAll) ? opts.proxy(url) : url;
    const timeoutMs = req.timeoutMs ?? opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const init: RequestInit = { signal: controller.signal, headers: { ...NODE_HEADERS, ...req.headers } };
    if (req.body !== undefined) {
      init.method = 'POST';
      init.body = JSON.stringify(req.body);
      init.headers = { ...NODE_HEADERS, 'Content-Type': 'application/json', ...req.headers };
    }

    try {
      let response: Response;
      try {
        response = await doFetch(target, init);
        // Shared public APIs throttle bursts; one or two short retries usually get through.
        for (let attempt = 1; attempt <= MAX_RETRIES && RETRY_STATUS.has(response.status); attempt++) {
          const retryAfter = Number(response.headers?.get?.('retry-after'));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 8000) : 2000 * attempt;
          await sleep(wait);
          // The retry takes a regular slot, so it also pushes back whatever is queued behind it.
          await waitForSlot(host, minInterval);
          response = await doFetch(target, init);
        }
      } catch (cause) {
        if (controller.signal.aborted) {
          throw new ProviderError(config.provider, `no response from ${host} within ${timeoutMs} ms`, { url, cause });
        }
        const hint = config.needsProxy && !opts.proxy ? ' (this API sends no CORS headers; in browsers it needs a proxy)' : '';
        throw new ProviderError(config.provider, `request to ${host} failed${hint}`, { url, cause });
      }
      if (req.nullOn?.includes(response.status)) return null;
      if (!response.ok) {
        throw new ProviderError(config.provider, `${host} answered HTTP ${response.status}`, { url, status: response.status });
      }
      try {
        const body = await response.text();
        if (persistable) void persist(url, body);
        return body;
      } catch (cause) {
        throw new ProviderError(config.provider, `reading the response of ${host} failed`, { url, cause });
      }
    } finally {
      clearTimeout(timer);
    }
  }

  function text(url: string, req: RequestOptions = {}): Promise<string | null> {
    const cacheable = ttl > 0 && req.body === undefined;
    if (!cacheable) return raceSignal(load(url, req), req.signal);

    const now = Date.now();
    const hit = cache.get(url);
    if (hit && hit.expires > now) return raceSignal(hit.body, req.signal);

    // The request itself is detached from the caller's signal: other callers may share it.
    const body = load(url, req);
    cache.set(url, { expires: now + ttl, body });
    body.catch(() => {
      if (cache.get(url)?.body === body) cache.delete(url);
    });
    if (cache.size > MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return raceSignal(body, req.signal);
  }

  async function json<T>(url: string, req: RequestOptions = {}): Promise<T | null> {
    const body = await text(url, req);
    if (body === null) return null;
    try {
      return JSON.parse(body) as T;
    } catch (cause) {
      throw new ProviderError(config.provider, `${hostOf(url)} did not answer with JSON`, { url, cause });
    }
  }

  return { json, text };
}

/** Builds a query string; `undefined` values are skipped. */
export function qs(params: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.join('&');
}
