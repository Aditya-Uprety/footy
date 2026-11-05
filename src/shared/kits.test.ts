import { afterEach, describe, expect, it } from 'vitest';
import { activeKitPair, hexString, KIT_PAIRS, kitOf, sanitizeKitPair, setActiveKitPair } from './kits';

/** Relative luminance (sRGB), for a contrast check that does not depend on hue. */
function lum(c: number): number {
  const f = (v: number): number => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f((c >> 16) & 255) + 0.7152 * f((c >> 8) & 255) + 0.0722 * f(c & 255);
}
const contrast = (a: number, b: number): number => {
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
  return (hi + 0.05) / (lo + 0.05);
};

afterEach(() => setActiveKitPair(0));

describe('kit pairs', () => {
  it('the first pair is the classic red / blue with yellow / green keepers (§2.1.3)', () => {
    expect(KIT_PAIRS[0]!.teams[0]).toEqual({ name: 'Red', outfield: 0xd8352f, gk: 0xf0cf2a });
    expect(KIT_PAIRS[0]!.teams[1]).toEqual({ name: 'Blue', outfield: 0x2c63d6, gk: 0x34b35a });
  });

  it('team names are distinct; every pair but the classic default also differs strongly in lightness', () => {
    // The classic red / blue is the plan's default (§2.1.3) and nearly equal in lightness;
    // the other pairs are the colorblind-safe choices and must differ in lightness as well as hue.
    KIT_PAIRS.forEach((pair, i) => {
      const [a, b] = pair.teams;
      expect(a.name).not.toBe(b.name);
      if (i > 0) expect(contrast(a.outfield, b.outfield)).toBeGreaterThan(2.5);
    });
  });

  it('no keeper kit matches any outfield kit of the same pair', () => {
    for (const pair of KIT_PAIRS) {
      const outfield = pair.teams.map((t) => t.outfield);
      for (const t of pair.teams) expect(outfield).not.toContain(t.gk);
      expect(pair.teams[0].gk).not.toBe(pair.teams[1].gk);
    }
  });

  it('sanitizes the index and switches the active kit', () => {
    expect(sanitizeKitPair(1)).toBe(1);
    for (const bad of [-1, 1.5, KIT_PAIRS.length, NaN, 'a', undefined, null]) expect(sanitizeKitPair(bad)).toBe(0);
    setActiveKitPair(2);
    expect(activeKitPair()).toBe(2);
    expect(kitOf(1).name).toBe(KIT_PAIRS[2]!.teams[1].name);
    setActiveKitPair(77);
    expect(activeKitPair()).toBe(0);
  });

  it('hexString pads', () => {
    expect(hexString(0x0f8f87)).toBe('#0f8f87');
    expect(hexString(0x000001)).toBe('#000001');
  });
});
