import { describe, expect, it } from 'vitest';
import type { Annotation } from '../core/types.ts';
import { resolveOverlaps } from './overlap.ts';

const ann = (from: number, to: number, extra: Partial<Annotation> = {}): Annotation => ({
  from,
  to,
  text: 'x'.repeat(to - from),
  conceptId: `c:${from}-${to}`,
  label: 'x',
  type: 'finding',
  source: 'a',
  ...extra,
});

describe('resolveOverlaps', () => {
  it('returns a sorted, non-overlapping list', () => {
    const out = resolveOverlaps([[ann(20, 25), ann(0, 5)], [ann(10, 15)]]);
    expect(out.map((a) => a.from)).toEqual([0, 10, 20]);
  });

  it('prefers the longer span', () => {
    const out = resolveOverlaps([[ann(0, 7)], [ann(0, 23, { source: 'b' })], [ann(8, 15)]]);
    expect(out).toHaveLength(1);
    expect(out[0]!.to).toBe(23);
  });

  it('prefers higher confidence, then the earlier list, for equal spans', () => {
    expect(resolveOverlaps([[ann(0, 5, { confidence: 0.4, source: 'a' })], [ann(0, 5, { confidence: 0.9, source: 'b' })]])[0]!.source).toBe('b');
    expect(resolveOverlaps([[ann(0, 5, { source: 'a' })], [ann(0, 5, { source: 'b' })]])[0]!.source).toBe('a');
  });

  it('keeps adjacent spans and drops invalid ones', () => {
    const out = resolveOverlaps([[ann(0, 5), ann(5, 9), ann(4, 4), ann(-1, 3), ann(50, 60), { ...ann(1, 2), from: Number.NaN }]], 20);
    expect(out.map((a) => [a.from, a.to])).toEqual([
      [0, 5],
      [5, 9],
    ]);
  });

  it('handles a few thousand annotations', () => {
    const many = Array.from({ length: 4000 }, (_, i) => ann(i * 10, i * 10 + 6));
    const overlapping = Array.from({ length: 4000 }, (_, i) => ann(i * 10 + 3, i * 10 + 8, { source: 'b' }));
    const out = resolveOverlaps([many, overlapping]);
    expect(out).toHaveLength(4000);
    expect(out.every((a) => a.source === 'a')).toBe(true);
  });
});
