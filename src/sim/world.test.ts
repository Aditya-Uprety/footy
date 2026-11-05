// buildWorld geometry (PLAN M3.1, §5.2).
import { describe, expect, it } from 'vitest';
import { derivePitch } from '../shared/pitch';
import { DEFAULT_SETTINGS } from '../game/settings';
import { FRAME_R, FRAME_TOP, HITBOX } from './constants';
import { buildWorld, type WorldPlayer } from './world';

const pitch = derivePitch(DEFAULT_SETTINGS);
const L2 = DEFAULT_SETTINGS.pitchLength / 2;
const W2 = DEFAULT_SETTINGS.pitchWidth / 2;
const players: WorldPlayer[] = [
  { id: 0, team: 0, x: -10, z: 5, gk: false },
  { id: 1, team: 1, x: 48, z: 0, gk: true },
];

describe('buildWorld (§5.2)', () => {
  const w = buildWorld(pitch, players, { kind: 'player', playerId: 0 });

  it('makes one hitbox per player with the outfield / GK shapes', () => {
    expect(w.hitboxes).toHaveLength(2);
    expect(w.hitboxes[0]).toMatchObject({ id: 0, team: 0, gk: false, x: -10, z: 5, ...HITBOX.OUTFIELD });
    expect(w.hitboxes[1]).toMatchObject({ id: 1, team: 1, gk: true, x: 48, z: 0, ...HITBOX.GK });
    expect(HITBOX.OUTFIELD.HC + HITBOX.OUTFIELD.R).toBeCloseTo(1.85, 12);
    expect(HITBOX.GK.HC + HITBOX.GK.R).toBeCloseTo(2.3, 12);
  });

  it('records the kicker id (null for a ghost taker or no kicker)', () => {
    expect(w.kickerId).toBe(0);
    expect(buildWorld(pitch, players, { kind: 'ghost' }).kickerId).toBeNull();
    expect(buildWorld(pitch, players).kickerId).toBeNull();
  });

  it('places posts and crossbar so the inner edges are 3.66 and the bar underside 2.44', () => {
    expect(w.frame).toHaveLength(6);
    for (const cap of w.frame) {
      expect(cap.r).toBe(FRAME_R);
      const side = cap.goalOf === 0 ? -1 : 1;
      expect(cap.a.x).toBeCloseTo(side * (L2 + 0.06), 12);
      if (cap.kind === 'post') {
        expect(Math.abs(cap.a.z) - FRAME_R).toBeCloseTo(3.66, 12);
        expect(cap.a.y).toBe(0);
        expect(cap.ab).toEqual({ x: 0, y: FRAME_TOP, z: 0 });
      } else {
        expect(cap.a.y - FRAME_R).toBeCloseTo(2.44, 12);
        expect(cap.ab.z).toBeCloseTo(2 * 3.72, 12);
      }
    }
    expect(w.frame.filter((f) => f.kind === 'bar')).toHaveLength(2);
  });

  it('places the nets: back at ±(L/2 + 2.06), sides at z = ±3.72 from the line, roof at 2.50', () => {
    expect(w.nets).toHaveLength(8);
    for (const n of w.nets) {
      const side = n.goalOf === 0 ? -1 : 1;
      if (n.name === 'back') {
        expect(n.o.x).toBeCloseTo(side * (L2 + 2.06), 12);
        expect(n.U).toBeCloseTo(3.72, 12);
        expect(n.V).toBeCloseTo(1.25, 12);
      } else {
        // From the goal line to the back net.
        expect(n.o.x - n.U * side).toBeCloseTo(side * L2, 12);
        expect(n.o.x + n.U * side).toBeCloseTo(side * (L2 + 2.06), 12);
        if (n.name === 'roof') expect(n.o.y).toBeCloseTo(2.5, 12);
        else expect(Math.abs(n.o.z)).toBeCloseTo(3.72, 12);
      }
      // Orthonormal frame.
      const d = (a: typeof n.m, b: typeof n.m) => a.x * b.x + a.y * b.y + a.z * b.z;
      expect(d(n.m, n.u)).toBe(0);
      expect(d(n.m, n.w)).toBe(0);
      expect(d(n.u, n.w)).toBe(0);
    }
  });

  it('takes the rule lines from the pitch (outer edges)', () => {
    expect(w.lines).toEqual({ halfLength: L2, halfWidth: W2, goalHalfWidth: 3.66, goalHeight: 2.44 });
    const small = buildWorld(derivePitch({ pitchLength: 90, pitchWidth: 60 }), []);
    expect(small.lines.halfLength).toBe(45);
    expect(small.frame[0]!.a.x).toBeCloseTo(-45.06, 12);
  });
});
