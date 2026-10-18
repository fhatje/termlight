import type { Annotation } from '../core/types.ts';

function overlapsAccepted(sorted: Annotation[], a: Annotation): boolean {
  // `sorted` is non-overlapping and ordered by `from`: only the neighbours of the insertion
  // point can collide.
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]!.from < a.from) lo = mid + 1;
    else hi = mid;
  }
  const next = sorted[lo];
  const prev = sorted[lo - 1];
  return (next !== undefined && next.from < a.to) || (prev !== undefined && prev.to > a.from);
}

/**
 * Flattens the results of several recognizers into a sorted, non-overlapping list (mark
 * decorations of different concepts must not nest). Longer spans win ("Arteria carotis interna"
 * over "Arteria"), then higher confidence, then the earlier list.
 */
export function resolveOverlaps(lists: readonly (readonly Annotation[])[], docLength = Infinity): Annotation[] {
  const candidates: { a: Annotation; order: number }[] = [];
  let order = 0;
  for (const list of lists) {
    for (const a of list) {
      if (Number.isFinite(a.from) && Number.isFinite(a.to) && a.from >= 0 && a.to > a.from && a.to <= docLength) {
        candidates.push({ a, order: order++ });
      }
    }
  }
  candidates.sort(
    (x, y) =>
      y.a.to - y.a.from - (x.a.to - x.a.from) ||
      (y.a.confidence ?? 1) - (x.a.confidence ?? 1) ||
      x.order - y.order,
  );
  const accepted: Annotation[] = [];
  for (const { a } of candidates) {
    if (overlapsAccepted(accepted, a)) continue;
    let i = accepted.length;
    while (i > 0 && accepted[i - 1]!.from > a.from) i--;
    accepted.splice(i, 0, a);
  }
  return accepted;
}
