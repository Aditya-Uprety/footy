// Possession after a stop (PLAN M3.4, §2.5.6).
import { describe, expect, it } from 'vitest';
import { closestPlayer, TIE_DIST, type PositionedPlayer } from './possession';

const p = (id: number, team: 0 | 1, x: number, z: number): PositionedPlayer => ({ id, team, x, z });

describe('closestPlayer (§2.5.6)', () => {
  it('returns the player closest in 2D, either team', () => {
    const players = [p(0, 0, 10, 0), p(1, 1, 0, 4), p(2, 0, -2, -2)];
    expect(closestPlayer(players, 0, 0, 0)?.id).toBe(2);
    expect(closestPlayer(players, 1, 3, 0)?.id).toBe(1);
  });

  it('an exact tie goes to the team that did not take the kick', () => {
    const players = [p(0, 0, 5, 0), p(1, 1, -5, 0)];
    expect(closestPlayer(players, 0, 0, 0)?.id).toBe(1);
    expect(closestPlayer(players, 0, 0, 1)?.id).toBe(0);
  });

  it('a near tie within 0.01 m also goes to the non-kicking team', () => {
    const players = [p(0, 0, 5, 0), p(1, 1, -5 - TIE_DIST * 0.9, 0)];
    expect(closestPlayer(players, 0, 0, 0)?.id).toBe(1);
    const apart = [p(0, 0, 5, 0), p(1, 1, -5 - TIE_DIST * 1.5, 0)];
    expect(closestPlayer(apart, 0, 0, 0)?.id).toBe(0);
  });

  it('if still tied, the lower player id wins', () => {
    expect(closestPlayer([p(7, 1, 3, 0), p(4, 1, 0, 3), p(2, 0, -3, 0)], 0, 0, 0)?.id).toBe(4);
    expect(closestPlayer([p(7, 0, 3, 0), p(4, 0, 0, 3)], 0, 0, 0)?.id).toBe(4);
  });

  it('returns null with no players', () => {
    expect(closestPlayer([], 0, 0, 0)).toBeNull();
  });
});
