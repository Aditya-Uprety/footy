// Lab event-log wording (M4.5): the acceptance checks read these strings.
import { describe, expect, it } from 'vitest';
import { describeEvent } from './lab';

describe('lab event log', () => {
  it('formats each event kind', () => {
    const c = { t: 1, x: 0, y: 0.11, z: 0, speed: 12.345 };
    expect(describeEvent({ kind: 'kick', t: 0, speed: 20.44 })).toBe('kick 20.4 m/s');
    expect(describeEvent({ kind: 'player', playerId: 3, team: 1, ...c })).toBe('player #3 (B) 12.3 m/s');
    expect(describeEvent({ kind: 'post', ...c })).toBe('post 12.3 m/s');
    expect(describeEvent({ kind: 'net', ...c, tail: true })).toBe('net 12.3 m/s (tail)');
    expect(describeEvent({ kind: 'goal', t: 2, goalOf: 0 })).toBe("GOAL into A's goal");
    expect(describeEvent({ kind: 'out', t: 2, line: 'touch', x: 12.345, z: 34 })).toBe('OUT touch x=12.35');
    expect(describeEvent({ kind: 'out', t: 2, line: 'goal', x: 52.5, z: -0.001 })).toBe('OUT goal z=0.00');
    expect(describeEvent({ kind: 'catch', t: 2, keeperId: 7, x: 0, y: 1, z: 0 })).toBe('CATCH #7');
    expect(describeEvent({ kind: 'stop', t: 2, x: 1, z: -2 })).toBe('stop at (1.00, -2.00)');
  });
});
