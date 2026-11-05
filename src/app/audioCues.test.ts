import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../sim/types';
import { cuesFor, MIN_IMPACT_SPEED, NEAR_MISS_Z, powerOfSpeed, WHISTLE_SOUND } from './audioCues';

const at = { t: 1, x: 0, y: 0, z: 0 };

describe('event → sound cues (M14.1)', () => {
  it('kicks scale with power: louder and sharper', () => {
    const soft = cuesFor({ kind: 'kick', t: 0, speed: 3 })[0]!;
    const hard = cuesFor({ kind: 'kick', t: 0, speed: 32 })[0]!;
    expect(soft.sound).toBe('kick');
    expect(hard.gain).toBeGreaterThan(soft.gain);
    expect(hard.rate).toBeGreaterThan(soft.rate);
    expect(hard.gain).toBeLessThanOrEqual(1);
    expect(soft.gain).toBeGreaterThan(0.2);
    expect(powerOfSpeed(0)).toBe(0);
    expect(powerOfSpeed(99)).toBe(1);
  });

  it('bounces and thuds scale with impact speed and ignore the settling rattle', () => {
    expect(cuesFor({ kind: 'ground', ...at, speed: MIN_IMPACT_SPEED - 0.1 })).toEqual([]);
    const a = cuesFor({ kind: 'ground', ...at, speed: 3 })[0]!;
    const b = cuesFor({ kind: 'ground', ...at, speed: 12 })[0]!;
    expect(a.sound).toBe('bounce');
    expect(b.gain).toBeGreaterThan(a.gain);
    const tail = cuesFor({ kind: 'ground', ...at, speed: 12, tail: true })[0]!;
    expect(tail.gain).toBeLessThan(b.gain);
    const t = cuesFor({ kind: 'player', ...at, speed: 10, playerId: 3, team: 0 });
    expect(t.map((c) => c.sound)).toEqual(['thud']);
    expect(cuesFor({ kind: 'player', ...at, speed: 0.2, playerId: 3, team: 0 })).toEqual([]);
  });

  it('post and bar clang and draw a groan; frame hits in the tail are silent', () => {
    expect(cuesFor({ kind: 'post', ...at, speed: 15 }).map((c) => c.sound)).toEqual(['post', 'groan']);
    expect(cuesFor({ kind: 'bar', ...at, speed: 15 }).map((c) => c.sound)).toEqual(['bar', 'groan']);
    expect(cuesFor({ kind: 'post', ...at, speed: 15, tail: true })).toEqual([]);
  });

  it('net swish and goal roar; no whistle or sound on stop', () => {
    expect(cuesFor({ kind: 'net', ...at, speed: 8 }).map((c) => c.sound)).toEqual(['net']);
    expect(cuesFor({ kind: 'net', ...at, speed: 0.3 })).toEqual([]);
    const goal = cuesFor({ kind: 'goal', t: 2, goalOf: 1 });
    expect(goal).toEqual([{ sound: 'roar', gain: 1, rate: 1 }]);
    expect(cuesFor({ kind: 'stop', t: 9, x: 0, z: 0 })).toEqual([]);
  });

  it('a save is a glove clap with a small cheer', () => {
    const c = cuesFor({ kind: 'catch', t: 1, keeperId: 1, x: 0, y: 1, z: 0 });
    expect(c.map((q) => q.sound)).toEqual(['catch', 'roar']);
    expect(c[1]!.gain).toBeLessThan(0.5);
  });

  it('only a close goal-line exit groans', () => {
    const out = (line: 'touch' | 'goal', z: number): SimEvent => ({ kind: 'out', t: 1, line, x: 52.5, z });
    expect(cuesFor(out('goal', NEAR_MISS_Z - 1)).map((c) => c.sound)).toEqual(['groan']);
    expect(cuesFor(out('goal', -(NEAR_MISS_Z - 1))).map((c) => c.sound)).toEqual(['groan']);
    expect(cuesFor(out('goal', NEAR_MISS_Z + 10))).toEqual([]);
    expect(cuesFor(out('touch', 34))).toEqual([]);
  });

  it('every gain is within 0..1 and every rate is sane', () => {
    const events: SimEvent[] = [
      { kind: 'kick', t: 0, speed: 100 },
      { kind: 'ground', ...at, speed: 500 },
      { kind: 'player', ...at, speed: 500, playerId: 1, team: 1 },
      { kind: 'post', ...at, speed: 500 },
      { kind: 'net', ...at, speed: 500 },
    ];
    for (const ev of events) for (const c of cuesFor(ev)) {
      expect(c.gain).toBeGreaterThan(0);
      expect(c.gain).toBeLessThanOrEqual(1);
      expect(c.rate).toBeGreaterThan(0.5);
      expect(c.rate).toBeLessThan(1.5);
    }
  });

  it('whistles map to the three whistle sounds', () => {
    expect(WHISTLE_SOUND).toEqual({ kickoff: 'whistle1', half: 'whistle2', full: 'whistle3' });
  });
});
