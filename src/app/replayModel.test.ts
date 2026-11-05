import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../game/settings';
import { derivePitch } from '../shared/pitch';
import { simulateKick } from '../sim/simulate';
import { goalSideOf, nextReplayCam, REPLAY_CAMS, REPLAY_SPEED_LABEL, REPLAY_SPEEDS, snapReplaySpeed, wantsGoalReplay } from './replayModel';

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

describe('automatic goal replay (M15.2)', () => {
  const goal = { outcome: { kind: 'goal' }, disallowed: false };
  it('is wanted after a counted goal in play', () => {
    expect(wantsGoalReplay({ half: 1 }, { phase: 'play', half: 1, last: goal })).toBe(true);
    expect(wantsGoalReplay({ half: 2 }, { phase: 'play', half: 2, last: goal })).toBe(true);
  });
  it('is not wanted for other outcomes, a disallowed throw-in goal, half-time or full-time', () => {
    expect(wantsGoalReplay({ half: 1 }, { phase: 'play', half: 1, last: { outcome: { kind: 'out' } } })).toBe(false);
    expect(wantsGoalReplay({ half: 1 }, { phase: 'play', half: 1, last: { ...goal, disallowed: true } })).toBe(false);
    expect(wantsGoalReplay({ half: 1 }, { phase: 'play', half: 2, last: goal })).toBe(false);
    expect(wantsGoalReplay({ half: 2 }, { phase: 'fulltime', half: 2, last: goal })).toBe(false);
    expect(wantsGoalReplay({ half: 1 }, { phase: 'play', half: 1, last: null })).toBe(false);
  });
});
