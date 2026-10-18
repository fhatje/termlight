import type { Annotation } from '../types.ts';

/**
 * Reduces several annotation lists to one sorted list without overlaps.
 *
 * Policy (the same one the matcher applies internally): the longer span wins; on equal length the
 * list that comes first in `lists` wins (lists are ordered by priority); then the earlier span.
 */
export function resolveOverlaps(lists: readonly (readonly Annotation[])[]): Annotation[] {
  const items: { a: Annotation; rank: number }[] = [];
  let end = 0;
  lists.forEach((list, rank) => {
    for (const a of list) {
      if (!(a.to > a.from) || a.from < 0) continue;
      items.push({ a, rank });
      if (a.to > end) end = a.to;
    }
  });
  items.sort(
    (x, y) =>
      y.a.to - y.a.from - (x.a.to - x.a.from) ||
      x.rank - y.rank ||
      x.a.from - y.a.from ||
      (y.a.confidence ?? 0) - (x.a.confidence ?? 0),
  );
  const taken = new Uint8Array(end);
  const out: Annotation[] = [];
  for (const { a } of items) {
    // Accepted spans are at least as long as `a`, so one that overlaps `a` covers an end point of it.
    if (taken[a.from] === 1 || taken[a.to - 1] === 1) continue;
    taken.fill(1, a.from, a.to);
    out.push(a);
  }
  return out.sort((x, y) => x.from - y.from);
}
