import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../game/settings';
import { derivePitch } from '../shared/pitch';
import { simulateKick } from '../sim/simulate';
import { goalSideOf, nextReplayCam, REPLAY_CAMS, REPLAY_SPEED_LABEL, REPLAY_SPEEDS, snapReplaySpeed } from './replayModel';

const pitch = derivePitch(DEFAULT_SETTINGS);
const ghost = { kind: 'ghost' as const, x: 0, y: 0.11, z: 0 };

describe('replay model (M15.1)', () => {
  it('cycles chase → broadcast → behind goal → chase', () => {
    expect(REPLAY_CAMS).toEqual(['chase', 'broadcast', 'goal']);
    expect(nextReplayCam('chase')).toBe('broadcast');
    expect(nextReplayCam('broadcast')).toBe('goal');
    expect(nextReplayCam('goal')).toBe('chase');
  });

  it('offers real time and two slow-motion speeds, and snaps to them', () => {
    expect(REPLAY_SPEEDS).toEqual([1, 0.5, 0.25]);
    expect(REPLAY_SPEEDS.map(REPLAY_SPEED_LABEL)).toEqual(['1×', '½×', '¼×']);
    expect(snapReplaySpeed(0.3)).toBe(0.25);
    expect(snapReplaySpeed(0.9)).toBe(1);
    expect(snapReplaySpeed(0.6)).toBe(0.5);
  });

  it('the behind-goal camera goes to the end where the kick finished', () => {
    const toPlus = simulateKick({ input: { yaw: 0, power: 1, curve: 0, loft: 0 }, origin: ghost, team: 0 });
    const toMinus = simulateKick({ input: { yaw: Math.PI, power: 1, curve: 0, loft: 0 }, origin: ghost, team: 0 });
    expect(goalSideOf(toPlus)).toBe(1);
    expect(goalSideOf(toMinus)).toBe(-1);
    // A weak kick that ends within a metre of the halfway line goes by its direction.
    const soft = simulateKick({ input: { yaw: Math.PI, power: 0, curve: 0, loft: 0 }, origin: ghost, team: 0 });
    expect(Math.abs(soft.frames[soft.frames.length - 3]!)).toBeGreaterThan(0);
    expect(goalSideOf(soft)).toBe(-1);
    expect(pitch.halfLength).toBeGreaterThan(50);
  });
});
