// Stadium layout (M12.3): the stands, crowd, boards and towers stay outside the
// playing area and inside sensible limits for every pitch size.
import { describe, expect, it } from 'vitest';
import { derivePitch } from '../shared/pitch';
import { APRON } from './pitch';
import {
  BOARD_GAP,
  BOARD_H,
  BOARD_T,
  STAND_GAP,
  boardSpec,
  buildBoardGeometry,
  buildStandGeometry,
  crowdPlacements,
  ringPoints,
  standProfile,
  standSpec,
  stadiumReach,
  towerPlacements,
} from './stadium';

const SIZES = [
  { pitchLength: 105, pitchWidth: 68 },
  { pitchLength: 90, pitchWidth: 60 },
  { pitchLength: 120, pitchWidth: 90 },
];

/** Distance from (x, z) to the pitch rectangle (0 inside). */
function outside(hl: number, hw: number, x: number, z: number): number {
  return Math.hypot(Math.max(Math.abs(x) - hl, 0), Math.max(Math.abs(z) - hw, 0));
}

describe('standProfile', () => {
  const p = standProfile();

  it('climbs from the front wall to the back and never goes backwards except the back wall', () => {
    expect(p.segs[0]!.o0).toBe(0);
    for (const s of p.segs) {
      if (s.kind !== 'back') expect(s.o1).toBeGreaterThanOrEqual(s.o0);
      expect(s.h0).toBeGreaterThanOrEqual(0);
      expect(s.h1).toBeGreaterThanOrEqual(0);
    }
    const last = p.segs[p.segs.length - 1]!;
    expect(last.kind).toBe('back');
    expect(last.h1).toBeCloseTo(0, 9);
  });

  it('seat rows get higher and farther out, tier by tier', () => {
    for (let i = 1; i < p.rows.length; i++) {
      expect(p.rows[i]!.o).toBeGreaterThan(p.rows[i - 1]!.o);
      expect(p.rows[i]!.h).toBeGreaterThan(p.rows[i - 1]!.h);
    }
    expect(new Set(p.rows.map((r) => r.tier))).toEqual(new Set([0, 1]));
  });

  it('stays a manageable size (camera rigs sit above it)', () => {
    expect(p.height).toBeLessThan(16);
    expect(p.depth).toBeLessThan(30);
  });
});

describe.each(SIZES)('stadium for $pitchLength × $pitchWidth', (size) => {
  const pitch = derivePitch(size);
  const hl = pitch.halfLength;
  const hw = pitch.halfWidth;

  it('rings share a sample layout and are closed', () => {
    const a = ringPoints(standSpec(pitch), 0);
    const b = ringPoints(standSpec(pitch), 12);
    expect(a.length).toBe(b.length);
    expect(a[0]).toEqual(a[a.length - 1]);
  });

  it('the stand front wall is at least STAND_GAP from every line', () => {
    for (const p of ringPoints(standSpec(pitch), 0)) {
      expect(outside(hl, hw, p.x, p.z)).toBeGreaterThanOrEqual(STAND_GAP - 1e-6);
    }
  });

  it('every stand vertex is outside the playing area', () => {
    const pos = buildStandGeometry(pitch).getAttribute('position');
    expect(pos.count % 3).toBe(0);
    let minOut = Infinity;
    for (let i = 0; i < pos.count; i++) minOut = Math.min(minOut, outside(hl, hw, pos.getX(i), pos.getZ(i)));
    expect(minOut).toBeGreaterThanOrEqual(STAND_GAP - 1e-6);
  });

  it('boards hug the lines inside the apron', () => {
    const { geometry, tiles, length } = buildBoardGeometry(pitch);
    expect(tiles).toBeGreaterThanOrEqual(1);
    expect(length).toBeGreaterThan(2 * (pitch.length + pitch.width));
    const pos = geometry.getAttribute('position');
    let min = Infinity;
    let max = 0;
    let maxY = 0;
    for (let i = 0; i < pos.count; i++) {
      const d = outside(hl, hw, pos.getX(i), pos.getZ(i));
      min = Math.min(min, d);
      max = Math.max(max, d);
      maxY = Math.max(maxY, pos.getY(i));
    }
    expect(min).toBeGreaterThanOrEqual(BOARD_GAP - 1e-6);
    expect(max).toBeLessThan(APRON);
    expect(maxY).toBeCloseTo(BOARD_H, 5);
    expect(BOARD_T).toBeLessThan(0.5);
    // The board ring is inside the stands.
    for (const p of ringPoints(boardSpec(pitch), BOARD_T)) {
      expect(outside(hl, hw, p.x, p.z)).toBeLessThan(STAND_GAP);
    }
  });

  it('board UVs tile a whole number of times around the ring', () => {
    const { geometry, tiles } = buildBoardGeometry(pitch);
    const uv = geometry.getAttribute('uv');
    let maxU = 0;
    for (let i = 0; i < uv.count; i++) {
      expect(Number.isFinite(uv.getX(i))).toBe(true);
      maxU = Math.max(maxU, uv.getX(i));
    }
    expect(maxU).toBeCloseTo(tiles, 6);
  });

  it('the crowd is deterministic, outside the play area and faces the pitch', () => {
    const a = crowdPlacements(pitch, 5);
    const b = crowdPlacements(pitch, 5);
    expect(a.count).toBe(b.count);
    expect(Array.from(a.x.slice(0, 50))).toEqual(Array.from(b.x.slice(0, 50)));
    expect(a.count).toBeGreaterThan(8000);
    expect(a.count).toBeLessThan(40000);
    const top = standProfile().height;
    for (let i = 0; i < a.count; i += 7) {
      expect(outside(hl, hw, a.x[i]!, a.z[i]!)).toBeGreaterThanOrEqual(STAND_GAP);
      expect(a.y[i]!).toBeGreaterThan(0);
      expect(a.y[i]!).toBeLessThan(top);
      // Facing: the quad's +z axis after yaw is (sin, cos); it must point toward the center.
      const fx = Math.sin(a.yaw[i]!);
      const fz = Math.cos(a.yaw[i]!);
      expect(fx * -a.x[i]! + fz * -a.z[i]!).toBeGreaterThan(0);
    }
  });

  it('density thins the crowd', () => {
    const full = crowdPlacements(pitch, 1, 1).count;
    const half = crowdPlacements(pitch, 1, 0.5).count;
    expect(half).toBeLessThan(full * 0.6);
    expect(half).toBeGreaterThan(full * 0.4);
  });

  it('four floodlight towers stand behind the bowl, facing the pitch', () => {
    const towers = towerPlacements(pitch);
    expect(towers).toHaveLength(4);
    expect(new Set(towers.map((t) => `${Math.sign(t.x)},${Math.sign(t.z)}`)).size).toBe(4);
    for (const t of towers) {
      expect(outside(hl, hw, t.x, t.z)).toBeGreaterThan(stadiumReach() - 6);
      expect(Math.sin(t.yaw) * -t.x + Math.cos(t.yaw) * -t.z).toBeGreaterThan(0);
    }
  });
});
