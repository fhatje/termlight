import type { Annotation } from '../../core/types.ts';
import { resolveOverlaps } from '../../core/matcher/index.ts';

/**
 * Merges the results of several active recognizers into one sorted list without overlaps.
 * Same policy as inside the matcher: longer span wins, then the list that comes first in `lists`
 * (order your recognizers by priority), then the earlier span.
 */
export function mergeAnnotations(lists: Annotation[][]): Annotation[] {
  return resolveOverlaps(lists);
}
