import { describe, expect, it } from 'vitest';
import { PHYS } from './constants';
import { kickoffSpot } from './kick';
import { frameCount, simulateKick } from './simulate';
import { FRAME_STRIDE, type KickInput, type KickOrigin } from './types';

const center: KickOrigin = { kind: 'ghost', ...kickoffSpot() };
const run = (input: KickInput, turnId = 7) => simulateKick({ input, origin: center, team: 1, turnId });

describe('simulateKick: loop, frames, events (PLAN §5.9)', () => {
  const r = run({ yaw: 0.3, power: 0.8, curve: 0.4, loft: 0.4 });

  it('records [t, x, y, z] frames starting at the kick, in time order', () => {
    expect(r.frames.length % FRAME_STRIDE).toBe(0);
    expect(Array.from(r.frames.slice(0, 4))).toEqual([0, r.start.x, Math.fround(r.start.y), r.start.z]);
    for (let i = FRAME_STRIDE; i < r.frames.length; i += FRAME_STRIDE) {
      expect(r.frames[i]!).toBeGreaterThan(r.frames[i - FRAME_STRIDE]!);
    }
    // About one frame per FRAME_EVERY steps, plus contact frames.
    const regular = Math.floor(r.duration / (PHYS.DT * PHYS.FRAME_EVERY));
    const contacts = r.events.filter((e) => e.kind === 'ground').length;
    expect(frameCount(r)).toBeGreaterThanOrEqual(regular);
    expect(frameCount(r)).toBeLessThanOrEqual(regular + contacts + 2);
  });

  it('records a frame on every contact step and on the last step', () => {
    const times = new Set<number>();
    for (let i = 0; i < r.frames.length; i += FRAME_STRIDE) times.add(r.frames[i]!);
    for (const e of r.events) if (e.kind === 'ground') expect(times.has(Math.fround(e.t))).toBe(true);
    expect(r.frames[r.frames.length - FRAME_STRIDE]).toBe(Math.fround(r.duration));
  });

  it('emits kick first, ground contacts in order, stop last', () => {
    expect(r.events[0]).toEqual({ kind: 'kick', t: 0, speed: expect.closeTo(3 + 0.8 * 29, 9) });
    const last = r.events[r.events.length - 1]!;
    expect(last.kind).toBe('stop');
    expect(last.t).toBe(r.duration);
    const grounds = r.events.filter((e) => e.kind === 'ground');
    expect(grounds.length).toBeGreaterThan(1);
    for (let i = 1; i < r.events.length; i++) expect(r.events[i]!.t).toBeGreaterThanOrEqual(r.events[i - 1]!.t);
  });

  it('ends as a stop owned by the kicking team with no touches', () => {
    expect(r.turnId).toBe(7);
    expect(r.outcome).toMatchObject({ kind: 'stop', lastTouch: { team: 1, playerId: null }, touches: 0 });
    const stop = r.events[r.events.length - 1]!;
    if (r.outcome.kind === 'stop' && stop.kind === 'stop') {
      expect(stop.x).toBe(r.outcome.x);
      expect(stop.z).toBe(r.outcome.z);
    }
  });

  it('returns the capped input and the initial spin', () => {
    const t = simulateKick({ input: { yaw: 0, power: 0.9, curve: 1, loft: 0.2 }, origin: center, team: 0, caps: { throwIn: true } });
    expect(t.input).toEqual({ yaw: 0, power: PHYS.THROW_POWER_CAP, curve: 0, loft: 0.2 });
    expect(t.spin0.y === 0).toBe(true);
    expect(r.spin0.y).toBeCloseTo(-0.4 * PHYS.W_MAX, 12);
  });
});
