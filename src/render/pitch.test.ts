// Markings geometry (M1.2): symmetric, inside the field, correct radii.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../game/settings';
import { derivePitch, LAW1 } from '../shared/pitch';
import { buildMarkings, stripeEdges } from './pitch';

const key = (x: number, z: number): string => `${x.toFixed(3)},${z.toFixed(3)}`;
const fix0 = (v: number): number => (Math.abs(v) < 5e-4 ? 0 : v);

function vertices(xz: Float32Array): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < xz.length; i += 2) out.push({ x: xz[i]!, z: xz[i + 1]! });
  return out;
}

const SIZES = [
  { pitchLength: DEFAULT_SETTINGS.pitchLength, pitchWidth: DEFAULT_SETTINGS.pitchWidth },
  { pitchLength: 90, pitchWidth: 60 },
  { pitchLength: 120, pitchWidth: 90 },
];

describe('buildMarkings', () => {
  for (const size of SIZES) {
    const pitch = derivePitch(size);
    const verts = vertices(buildMarkings(pitch));

    it(`${size.pitchLength}×${size.pitchWidth}: whole triangles only`, () => {
      expect(verts.length % 3).toBe(0);
      expect(verts.length).toBeGreaterThan(100);
    });

    it(`${size.pitchLength}×${size.pitchWidth}: stays inside the field and reaches its outer edges`, () => {
      const eps = 1e-4;
      let xMin = Infinity;
      let xMax = -Infinity;
      let zMin = Infinity;
      let zMax = -Infinity;
      for (const v of verts) {
        xMin = Math.min(xMin, v.x);
        xMax = Math.max(xMax, v.x);
        zMin = Math.min(zMin, v.z);
        zMax = Math.max(zMax, v.z);
      }
      expect(xMin).toBeCloseTo(-pitch.halfLength, 4);
      expect(xMax).toBeCloseTo(pitch.halfLength, 4);
      expect(zMin).toBeCloseTo(-pitch.halfWidth, 4);
      expect(zMax).toBeCloseTo(pitch.halfWidth, 4);
      for (const v of verts) {
        expect(Math.abs(v.x)).toBeLessThanOrEqual(pitch.halfLength + eps);
        expect(Math.abs(v.z)).toBeLessThanOrEqual(pitch.halfWidth + eps);
      }
    });

    it(`${size.pitchLength}×${size.pitchWidth}: mirror-symmetric about both axes`, () => {
      const set = new Set(verts.map((v) => key(fix0(v.x), fix0(v.z))));
      for (const v of verts) {
        expect(set.has(key(fix0(-v.x), fix0(v.z)))).toBe(true);
        expect(set.has(key(fix0(v.x), fix0(-v.z)))).toBe(true);
      }
    });

    it(`${size.pitchLength}×${size.pitchWidth}: every triangle faces up (+y)`, () => {
      for (let i = 0; i < verts.length; i += 3) {
        const a = verts[i]!;
        const b = verts[i + 1]!;
        const c = verts[i + 2]!;
        // y of (b - a) × (c - a) with 3D vectors (x, 0, z).
        const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
        expect(ny).toBeGreaterThan(0);
      }
    });
  }

  const pitch = derivePitch(DEFAULT_SETTINGS);
  const verts = vertices(buildMarkings(pitch));

  it('center circle: outer edge at 9.15 m, inner edge one line width in', () => {
    const near = verts.filter((v) => Math.abs(Math.hypot(v.x, v.z) - LAW1.CENTER_CIRCLE_R) < 1e-3);
    const inner = verts.filter((v) => Math.abs(Math.hypot(v.x, v.z) - (LAW1.CENTER_CIRCLE_R - LAW1.LINE_WIDTH)) < 1e-3);
    expect(near.length).toBeGreaterThan(100);
    expect(inner.length).toBeGreaterThan(100);
    // Nothing of the circle beyond its outer edge (other than lines crossing it).
    const ring = verts.filter((v) => Math.hypot(v.x, v.z) > 1 && Math.hypot(v.x, v.z) < 15 && Math.abs(v.x) > 0.1);
    for (const v of ring) expect(Math.hypot(v.x, v.z)).toBeLessThanOrEqual(LAW1.CENTER_CIRCLE_R + 1e-4);
  });

  it('penalty arcs lie outside the penalty areas (beyond the inner edge of the box line)', () => {
    for (const end of pitch.ends) {
      const inward = -end.side;
      const frontX = end.goalLineX + inward * LAW1.PENALTY_AREA_DEPTH;
      const arcVerts = verts.filter((v) => {
        const d = Math.hypot(v.x - end.penaltyMark.x, v.z - end.penaltyMark.z);
        return d > LAW1.PENALTY_ARC_R - LAW1.LINE_WIDTH - 1e-3 && d < LAW1.PENALTY_ARC_R + 1e-3;
      });
      expect(arcVerts.length).toBeGreaterThan(20);
      for (const v of arcVerts) {
        // Signed distance from the box front edge toward the center; the arc may only
        // dip into the front line strip itself (≤ one line width), never deeper.
        expect((v.x - frontX) * inward).toBeGreaterThan(-LAW1.LINE_WIDTH);
      }
    }
  });

  it('penalty marks and the center spot are drawn', () => {
    for (const p of [pitch.centerSpot, ...pitch.ends.map((e) => e.penaltyMark)]) {
      expect(verts.some((v) => Math.hypot(v.x - p.x, v.z - p.z) < 1e-6)).toBe(true);
    }
    expect(Math.abs(pitch.ends[0].penaltyMark.x - pitch.ends[0].goalLineX)).toBeCloseTo(11, 6);
  });
});

describe('stripeEdges', () => {
  it('is symmetric about the halfway line and spans the field', () => {
    for (const size of SIZES) {
      const pitch = derivePitch(size);
      const e = stripeEdges(pitch);
      expect(e[0]).toBeCloseTo(-pitch.halfLength, 9);
      expect(e[e.length - 1]).toBeCloseTo(pitch.halfLength, 9);
      expect((e.length - 1) % 2).toBe(0);
      for (let i = 0; i < e.length; i++) expect(e[i]! + e[e.length - 1 - i]!).toBeCloseTo(0, 9);
    }
  });
});
