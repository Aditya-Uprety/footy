// Playback (M4.3, §5.9): frame interpolation, event firing, time-warp, catch snap.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../game/settings';
import { derivePitch } from '../shared/pitch';
import { PHYS } from '../sim/constants';
import { simulateKick } from '../sim/simulate';
import { FRAME_STRIDE, type KickOrigin, type KickResult, type SimEvent, type Vec3 } from '../sim/types';
import { buildWorld, type WorldPlayer } from '../sim/world';
import {
  FAST_FORWARD_RATE,
  KickPlayback,
  SLOW_ROLL_RATE,
  frameSegment,
  keeperHands,
  sampleFrames,
  sampleVelocity,
} from './playback';

const pitch = derivePitch(DEFAULT_SETTINGS);
const r = PHYS.BALL_R;
const ghost = (x: number, z: number): KickOrigin => ({ kind: 'ghost', x, y: r, z });

function kick(power: number, opts: { loft?: number; yaw?: number; players?: WorldPlayer[]; origin?: KickOrigin } = {}): KickResult {
  const world = buildWorld(pitch, opts.players ?? [], null);
  return simulateKick({
    input: { yaw: opts.yaw ?? 0, power, curve: 0, loft: opts.loft ?? 0 },
    origin: opts.origin ?? ghost(0, 0),
    team: 0,
    world,
  });
}

const v3 = (): Vec3 => ({ x: 0, y: 0, z: 0 });

describe('frame sampling', () => {
  const frames = new Float32Array([0, 0, 1, 0, 1, 10, 1, 0, 3, 10, 1, 20]);

  it('finds the segment containing t (clamped)', () => {
    expect(frameSegment(frames, -1)).toBe(0);
    expect(frameSegment(frames, 0.5)).toBe(0);
    expect(frameSegment(frames, 1)).toBe(1);
    expect(frameSegment(frames, 2.9)).toBe(1);
    expect(frameSegment(frames, 99)).toBe(1);
  });

  it('lerps between frames and clamps at the ends', () => {
    expect(sampleFrames(frames, 0.5, v3())).toEqual({ x: 5, y: 1, z: 0 });
    expect(sampleFrames(frames, 2, v3())).toEqual({ x: 10, y: 1, z: 10 });
    expect(sampleFrames(frames, -5, v3())).toEqual({ x: 0, y: 1, z: 0 });
    expect(sampleFrames(frames, 50, v3())).toEqual({ x: 10, y: 1, z: 20 });
    expect(sampleVelocity(frames, 0.5, v3())).toEqual({ x: 10, y: 0, z: 0 });
    expect(sampleVelocity(frames, 2, v3())).toEqual({ x: 0, y: 0, z: 10 });
  });

  it('hits every recorded frame exactly at its time', () => {
    const res = kick(0.6, { loft: 0.4 });
    const p = v3();
    for (let i = 0; i * FRAME_STRIDE < res.frames.length; i += 7) {
      const o = i * FRAME_STRIDE;
      sampleFrames(res.frames, res.frames[o]!, p);
      expect(p.x).toBe(res.frames[o + 1]);
      expect(p.y).toBe(res.frames[o + 2]);
      expect(p.z).toBe(res.frames[o + 3]);
    }
  });
});

describe('KickPlayback', () => {
  it('fires every event once, in order, then onEnd once', () => {
    const res = kick(0.5, { players: [{ id: 3, team: 1, x: 12, z: 0, gk: false }] });
    const seen: SimEvent[] = [];
    let ends = 0;
    const pb = new KickPlayback(res, { onEvent: (e) => seen.push(e), onEnd: () => ends++ });
    for (let i = 0; i < 10_000 && !pb.done; i++) pb.update(1 / 60);
    pb.update(1 / 60);
    expect(pb.done).toBe(true);
    expect(ends).toBe(1);
    expect(seen).toEqual(res.events);
    expect(seen.some((e) => e.kind === 'player')).toBe(true);
    expect(pb.t).toBe(res.duration);
  });

  it('a single huge step still fires everything and ends at the last frame', () => {
    const res = kick(1, { loft: 0.3 });
    const seen: SimEvent[] = [];
    const pb = new KickPlayback(res, { onEvent: (e) => seen.push(e) });
    pb.update(1000);
    expect(seen).toEqual(res.events);
    const last = (res.frames.length / FRAME_STRIDE - 1) * FRAME_STRIDE;
    expect(pb.pos).toEqual({ x: res.frames[last + 1], y: res.frames[last + 2], z: res.frames[last + 3] });
  });

  it('events fire when playback time passes their t, not before', () => {
    const res = kick(0.5, { loft: 0.5 });
    const ground = res.events.find((e) => e.kind === 'ground')!;
    const seen: SimEvent[] = [];
    const pb = new KickPlayback(res, { onEvent: (e) => seen.push(e), autoSlowRolls: false });
    pb.update(ground.t - 0.01);
    expect(seen.map((e) => e.kind)).toEqual(['kick']);
    pb.update(0.02);
    expect(seen.map((e) => e.kind)).toEqual(['kick', 'ground']);
  });

  it('time-warp: F = 3×; auto 2× only while rolling slower than 2 m/s', () => {
    const res = kick(0.25); // a ground pass that slows to a stop
    const pb = new KickPlayback(res);
    pb.update(0.1);
    expect(pb.rolling).toBe(true);
    expect(pb.rate).toBe(1); // still fast
    pb.update(0.1, { fastForward: true });
    expect(pb.rate).toBe(FAST_FORWARD_RATE);
    while (!pb.done && pb.speed >= 2) pb.update(1 / 60);
    pb.update(1 / 60);
    expect(pb.rate).toBe(SLOW_ROLL_RATE);

    const off = new KickPlayback(res, { autoSlowRolls: false });
    off.seek(pb.t);
    off.update(1 / 60);
    expect(off.rate).toBe(1);
  });

  it('auto-speed never applies in the air', () => {
    const res = kick(0.15, { loft: 1 }); // slow, high chip
    const pb = new KickPlayback(res);
    pb.update(0.2);
    expect(pb.pos.y).toBeGreaterThan(r + 0.1);
    pb.update(0.01);
    expect(pb.rate).toBe(1);
  });

  it('replay: seek(0) plays the same path and events again', () => {
    const res = kick(0.7, { loft: 0.2 });
    const run = (pb: KickPlayback) => {
      const path: number[] = [];
      for (let i = 0; i < 5000 && !pb.done; i++) {
        pb.update(1 / 60);
        path.push(pb.pos.x, pb.pos.y, pb.pos.z);
      }
      return path;
    };
    let count = 0;
    const pb = new KickPlayback(res, { onEvent: () => count++, autoSlowRolls: false });
    const a = run(pb);
    pb.seek(0);
    const b = run(pb);
    expect(b).toEqual(a);
    expect(count).toBe(2 * res.events.length);
  });

  it('a catch snaps the ball into the keeper’s hands', () => {
    const gk: WorldPlayer = { id: 9, team: 1, x: 15, z: 0, gk: true };
    const res = kick(0.5, { players: [gk] });
    expect(res.outcome.kind).toBe('catch');
    const pb = new KickPlayback(res, { keeperAt: (id) => (id === 9 ? gk : null) });
    pb.update(100);
    for (let i = 0; i < 30; i++) pb.update(1 / 60);
    const hands = keeperHands(gk, res.events.at(-1) as Vec3);
    expect(pb.pos.x).toBeCloseTo(hands.x, 9);
    expect(pb.pos.y).toBeCloseTo(hands.y, 9);
    expect(pb.pos.z).toBeCloseTo(hands.z, 9);
    // In front of the keeper, toward the kicker, inside the hitbox reach.
    expect(pb.pos.x).toBeLessThan(gk.x);
    expect(Math.hypot(pb.pos.x - gk.x, pb.pos.z - gk.z)).toBeLessThan(0.9);
  });

  it('drives a ball view: rolls on the ground, spins in the air', () => {
    const calls: string[] = [];
    let rolled = 0;
    const ball = {
      setPosition: () => calls.push('pos'),
      roll: (dx: number, dz: number) => {
        rolled += Math.hypot(dx, dz);
        calls.push('roll');
      },
      spin: () => calls.push('spin'),
    } as unknown as Parameters<KickPlayback['applyTo']>[0];

    const ground = new KickPlayback(kick(0.3));
    for (let i = 0; i < 30; i++) ground.applyTo(ball, ground.update(1 / 60));
    expect(calls).toContain('roll');
    expect(calls).not.toContain('spin');
    expect(rolled).toBeCloseTo(ground.pos.x, 6); // straight pass from x = 0

    calls.length = 0;
    const air = new KickPlayback(
      simulateKick({ input: { yaw: 0, power: 0.8, curve: 1, loft: 0.5 }, origin: ghost(0, 0), team: 0 }),
    );
    air.applyTo(ball, air.update(0.2));
    expect(calls).toEqual(['pos', 'spin']);
  });
});

describe('replay of a stored kick (M15.A)', () => {
  const players: WorldPlayer[] = [{ id: 1, team: 1, x: 18, z: 0, gk: false }];
  const result = kick(0.9, { loft: 0.3, yaw: 0, players });

  function run(realDt: number, rate: number): { path: Vec3[]; events: string[]; times: number[] } {
    const path: Vec3[] = [];
    const times: number[] = [];
    const events: string[] = [];
    const pb = new KickPlayback(result, { onEvent: (e) => events.push(e.kind) });
    let guard = 0;
    while (pb.t < pb.duration && guard++ < 100000) {
      pb.update(realDt * (rate === 1 ? 1 : rate));
      path.push({ ...pb.pos });
      times.push(pb.t);
    }
    return { path, events, times };
  }

  it('a second playback of the same result retraces the ball exactly, event for event', () => {
    const a = run(1 / 60, 1);
    const b = run(1 / 60, 1);
    expect(b.path).toEqual(a.path);
    expect(b.events).toEqual(a.events);
    expect(a.events[0]).toBe('kick');
  });

  it('playback does not depend on the step size (so slow motion hits the same points)', () => {
    const full = new KickPlayback(result);
    const slow = new KickPlayback(result);
    const p = v3();
    for (let i = 0; i < 40; i++) {
      full.update(0.1);
      slow.update(0.05);
      slow.update(0.05);
      expect(slow.t).toBeCloseTo(full.t, 9);
      expect(slow.pos.x).toBeCloseTo(full.pos.x, 9);
      expect(slow.pos.y).toBeCloseTo(full.pos.y, 9);
      expect(slow.pos.z).toBeCloseTo(full.pos.z, 9);
      sampleFrames(result.frames, full.t, p);
      expect(full.pos.x).toBeCloseTo(p.x, 6);
    }
  });
});
