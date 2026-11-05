// PURE. Seeded PRNG (mulberry32): fast, 32-bit state, good enough for
// layouts, coin tosses and auto-placement. Same seed → same sequence.
// (Written in M5.5 for the practice layout; M6.1 builds on it.)

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** The internal state, to resume a sequence. */
  readonly state: number;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (n) => Math.floor(next() * n),
    get state() {
      return a;
    },
  };
}
