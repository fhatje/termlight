import type { TermPack } from '../../core/types.ts';

export type PackSource = string | TermPack;

const cache = new Map<string, Promise<TermPack>>();

/** Absolute form of a pack URL, so that a worker (whose base is its own script) fetches the same file. */
export function resolvePackUrl(url: string): string {
  const base = (globalThis as { location?: { href?: string } }).location?.href;
  try {
    return base ? new URL(url, base).href : url;
  } catch {
    return url;
  }
}

function assertPack(value: unknown, origin: string): TermPack {
  const pack = value as Partial<TermPack> | null;
  if (!pack || typeof pack.id !== 'string' || !Array.isArray(pack.concepts)) {
    throw new Error(`Kein gültiges Terminologie-Paket: ${origin}`);
  }
  return pack as TermPack;
}

/**
 * Fetches a pack once per URL; recognizer and lookup share the result. Not tied to a caller's
 * AbortSignal on purpose: an aborted keystroke must not poison the shared download.
 */
export function loadPack(source: PackSource): Promise<TermPack> {
  if (typeof source !== 'string') return Promise.resolve(assertPack(source, 'inline'));
  const url = resolvePackUrl(source);
  let pending = cache.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`Paket ${url} konnte nicht geladen werden (HTTP ${response.status})`);
        return response.json();
      })
      .then((json) => assertPack(json, url));
    cache.set(url, pending);
    pending.catch(() => cache.delete(url));
  }
  return pending;
}

/** Loads all packs; a pack that fails is skipped (and reported) as long as another one loads. */
export async function loadPacks(sources: readonly PackSource[]): Promise<{ packs: TermPack[]; failed: string[] }> {
  const settled = await Promise.allSettled(sources.map((s) => loadPack(s)));
  const packs: TermPack[] = [];
  const failed: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') packs.push(result.value);
    else failed.push(`${typeof sources[index] === 'string' ? sources[index] : 'inline'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
  });
  if (packs.length === 0 && failed.length > 0) throw new Error(failed.join('; '));
  return { packs, failed };
}

export function abortError(message = 'Aborted'): Error {
  if (typeof DOMException !== 'undefined') return new DOMException(message, 'AbortError');
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}
