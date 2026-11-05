import { describe, expect, it } from 'vitest';
import { createRng } from './rng';

describe('mulberry32', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const xs = Array.from({ length: 1000 }, () => a.next());
    expect(Array.from({ length: 1000 }, () => b.next())).toEqual(xs);
    expect(c.next()).not.toBe(xs[0]);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
  });

  it('int and range stay in bounds and cover them', () => {
    const r = createRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const n = r.int(6);
      expect(Number.isInteger(n) && n >= 0 && n < 6).toBe(true);
      seen.add(n);
      const v = r.range(-3, 5);
      expect(v >= -3 && v < 5).toBe(true);
    }
    expect(seen.size).toBe(6);
  });
});
