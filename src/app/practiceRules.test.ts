// Practice rules (M5.5): seeded legal layout and the next kicker.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../game/settings';
import { derivePitch, rectContains, rectDistance } from '../shared/pitch';
import { createRng } from '../shared/rng';
import { HITBOX } from '../sim/constants';
import type { Touch } from '../sim/types';
import { nextPracticeTurn, practiceLayout, yawTowardGoal } from './practiceRules';

const pitch = derivePitch(DEFAULT_SETTINGS);
const S = DEFAULT_SETTINGS;

describe('practice layout', () => {
  for (const seed of [1, 2, 3, 99, 12345, 4000000000]) {
    it(`seed ${seed}: 2 × 11 players following the spot rules`, () => {
      const ps = practiceLayout(pitch, S, createRng(seed));
      expect(ps).toHaveLength(22);
      expect(ps.map((p) => p.id)).toEqual(Array.from({ length: 22 }, (_, i) => i + 1));
      for (const team of [0, 1] as const) {
        const mine = ps.filter((p) => p.team === team);
        expect(mine).toHaveLength(11);
        const gks = mine.filter((p) => p.gk);
        expect(gks).toHaveLength(1);
        expect(gks[0]!.shirt).toBe(1);
        expect(rectContains(pitch.ends[team].penaltyArea, gks[0]!.x, gks[0]!.z)).toBe(true);
        expect(mine.map((p) => p.shirt).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      }
      for (const p of ps) {
        expect(rectContains(pitch.placementBounds, p.x, p.z)).toBe(true);
        const R = p.gk ? HITBOX.GK.R : HITBOX.OUTFIELD.R;
        expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(pitch.centerCircleR + R - 0.01);
        if (!p.gk) expect(rectDistance(pitch.ends[p.team === 0 ? 1 : 0].penaltyArea, p.x, p.z)).toBeGreaterThanOrEqual(R); // M17
        for (const q of ps) {
          if (q === p) continue;
          const d = Math.hypot(p.x - q.x, p.z - q.z);
          expect(d).toBeGreaterThanOrEqual((q.team === p.team ? S.minTeammateDist : S.minOpponentDist) - 0.02);
        }
      }
    });
  }

  it('is deterministic for a seed', () => {
    expect(practiceLayout(pitch, S, createRng(5))).toEqual(practiceLayout(pitch, S, createRng(5)));
    expect(practiceLayout(pitch, S, createRng(5))).not.toEqual(practiceLayout(pitch, S, createRng(6)));
  });
});

describe('next practice turn', () => {
  const ps = practiceLayout(pitch, S, createRng(11));
  const touch = (team: 0 | 1): Touch => ({ team, playerId: null });

  it('after a stop the closest player gets the ball, aiming at the goal they attack', () => {
    const target = ps.find((p) => p.team === 1 && !p.gk)!;
    const t = nextPracticeTurn(pitch, ps, 0, { kind: 'stop', x: target.x + 0.5, z: target.z, lastTouch: touch(0), touches: 0 });
    expect(t.origin).toMatchObject({ kind: 'player', playerId: target.id });
    expect(t.team).toBe(1);
    expect(t.yaw).toBeCloseTo(yawTowardGoal(pitch, 1, target.x, target.z), 12);
    expect(Math.cos(t.yaw)).toBeLessThan(0); // B attacks −x
  });

  it('a catch gives the keeper the ball', () => {
    const gk = ps.find((p) => p.team === 0 && p.gk)!;
    const t = nextPracticeTurn(pitch, ps, 1, { kind: 'catch', keeperId: gk.id });
    expect(t.origin).toMatchObject({ kind: 'player', playerId: gk.id, gk: true });
    expect(t.reason).toBe('catch');
  });

  it('goals and outs reset to a center kickoff', () => {
    const g = nextPracticeTurn(pitch, ps, 0, { kind: 'goal', goalOf: 1, z: 0, lastTouch: touch(0), touches: 0 });
    expect(g.origin).toMatchObject({ kind: 'ghost', x: 0, z: 0 });
    expect(g.team).toBe(1); // conceding team kicks off
    expect(Math.cos(g.yaw)).toBeCloseTo(-1, 12);
    const o = nextPracticeTurn(pitch, ps, 0, { kind: 'out', line: 'touch', x: 3, z: 34, lastTouch: touch(1), touches: 1 });
    expect(o.team).toBe(0);
    expect(o.origin.kind).toBe('ghost');
    expect(o.yaw).toBeCloseTo(0, 12);
  });
});
