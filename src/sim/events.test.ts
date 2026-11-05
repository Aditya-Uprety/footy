// Kicks through a populated world: collisions, goals, outs, catches, last
// touch, tails and kicker grace (PLAN M3.5, §5.7, §5.8).
import { describe, expect, it } from 'vitest';
import { derivePitch } from '../shared/pitch';
import { DEFAULT_SETTINGS } from '../game/settings';
import { PHYS } from './constants';
import { kickoffSpot } from './kick';
import { detectLines, simulateKick } from './simulate';
import { FRAME_STRIDE, type KickOrigin, type KickResult, type SimEvent, type Team } from './types';
import { buildWorld, type WorldPlayer } from './world';

const pitch = derivePitch(DEFAULT_SETTINGS);
const L2 = pitch.halfLength;
const W2 = pitch.halfWidth;
const r = PHYS.BALL_R;
const DEG = Math.PI / 180;

const pl = (id: number, team: Team, x: number, z: number, gk = false): WorldPlayer => ({ id, team, x, z, gk });
const ghost = (x: number, y: number, z: number): KickOrigin => ({ kind: 'ghost', x, y, z });

interface Shot {
  origin: KickOrigin;
  yaw: number;
  power: number;
  loftDeg?: number;
  curve?: number;
  players?: WorldPlayer[];
  team?: Team;
}

function shoot(s: Shot): KickResult {
  const players = s.players ?? [];
  const kicker = s.origin.kind === 'player' ? s.origin : null;
  const world = buildWorld(pitch, players, kicker);
  const loft = ((s.loftDeg ?? 0) * DEG) / PHYS.LOFT_MAX;
  const team = s.team ?? (s.origin.kind === 'player' ? s.origin.team : 0);
  return simulateKick({ input: { yaw: s.yaw, power: s.power, curve: s.curve ?? 0, loft }, origin: s.origin, team, world });
}

const ofKind = <K extends SimEvent['kind']>(r: KickResult, k: K) =>
  r.events.filter((e): e is Extract<SimEvent, { kind: K }> => e.kind === k);

/** Ball position at recorded frame i. */
const frameAt = (res: KickResult, i: number) => ({
  t: res.frames[i * FRAME_STRIDE]!,
  x: res.frames[i * FRAME_STRIDE + 1]!,
  y: res.frames[i * FRAME_STRIDE + 2]!,
  z: res.frames[i * FRAME_STRIDE + 3]!,
});
const frameIndexAt = (res: KickResult, t: number) => {
  for (let i = 0; i * FRAME_STRIDE < res.frames.length; i++) if (res.frames[i * FRAME_STRIDE] === Math.fround(t)) return i;
  return -1;
};

describe('player collisions (§5.7)', () => {
  it('head-on: the ball bounces straight back at ≈ E_PLAYER × impact speed', () => {
    const res = shoot({ origin: ghost(0, r, 0), yaw: 0, power: 0.3, players: [pl(5, 1, 10, 0)] });
    const hits = ofKind(res, 'player');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ playerId: 5, team: 1 });
    expect(hits[0]!.x).toBeCloseTo(10 - 0.4 - r, 9);
    // Velocity right after the contact, from the contact frame and the next one.
    const i = frameIndexAt(res, hits[0]!.t);
    expect(i).toBeGreaterThan(0);
    const a = frameAt(res, i);
    const b = frameAt(res, i + 1);
    const vAfter = (b.x - a.x) / (b.t - a.t);
    expect(vAfter).toBeLessThan(0);
    expect(-vAfter / hits[0]!.speed).toBeCloseTo(PHYS.E_PLAYER, 1);
    expect(res.outcome).toMatchObject({ kind: 'stop', lastTouch: { team: 1, playerId: 5 }, touches: 1 });
    if (res.outcome.kind === 'stop') {
      expect(res.outcome.x).toBeLessThan(10);
      expect(Math.abs(res.outcome.z)).toBeLessThan(1e-9);
    }
  });

  it('glancing: the ball deflects away from the player center and keeps going', () => {
    const res = shoot({ origin: ghost(0, r, 0), yaw: 0, power: 0.3, players: [pl(5, 1, 10, 0.45)] });
    expect(ofKind(res, 'player')).toHaveLength(1);
    expect(res.outcome.kind).toBe('stop');
    if (res.outcome.kind === 'stop') {
      expect(res.outcome.x).toBeGreaterThan(10);
      expect(res.outcome.z).toBeLessThan(-1);
    }
    // Mirror image: offset the other way, deflects the other way.
    const m = shoot({ origin: ghost(0, r, 0), yaw: 0, power: 0.3, players: [pl(5, 1, 10, -0.45)] });
    if (m.outcome.kind === 'stop' && res.outcome.kind === 'stop') expect(m.outcome.z).toBeCloseTo(-res.outcome.z, 9);
  });

  it('a lob clears a 1.85 m player; a low drive along the same line hits', () => {
    const blocker = [pl(5, 1, 6, 0)];
    const lob = shoot({ origin: ghost(0, r, 0), yaw: 0, power: 0.3, loftDeg: 45, players: blocker });
    expect(ofKind(lob, 'player')).toHaveLength(0);
    const drive = shoot({ origin: ghost(0, r, 0), yaw: 0, power: 0.3, loftDeg: 0, players: blocker });
    expect(ofKind(drive, 'player')).toHaveLength(1);
  });

  it('the last touch follows a deflection off an opponent', () => {
    const res = shoot({ origin: ghost(0, r, 0), yaw: 0, power: 0.6, team: 0, players: [pl(7, 1, 15, 0.45), pl(8, 0, -20, 20)] });
    expect(res.outcome.kind).not.toBe('catch');
    if (res.outcome.kind !== 'catch') expect(res.outcome).toMatchObject({ lastTouch: { team: 1, playerId: 7 }, touches: 1 });
  });
});

describe('goal frame (§5.7)', () => {
  it('a drive at the post rebounds into the field', () => {
    const res = shoot({ origin: ghost(45, r, 3.72), yaw: 0, power: 0.5 });
    const posts = ofKind(res, 'post');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.speed).toBeGreaterThan(5);
    expect(res.outcome.kind).toBe('stop');
    if (res.outcome.kind === 'stop') expect(res.outcome.x).toBeLessThan(L2 - 5);
    expect(res.outcome).toMatchObject({ lastTouch: { team: 0, playerId: null }, touches: 0 });
  });

  it('a ball at bar height hits the crossbar and comes back out', () => {
    const res = shoot({ origin: ghost(50, 2.5, 0), yaw: 0, power: 0.5 });
    const bars = ofKind(res, 'bar');
    expect(bars.length).toBeGreaterThanOrEqual(1);
    expect(bars[0]!.y).toBeGreaterThan(2.44 - 0.17);
    expect(res.outcome.kind).toBe('stop');
  });

  it('records a frame on every contact step', () => {
    const res = shoot({ origin: ghost(45, r, 3.72), yaw: 0, power: 0.5, players: [pl(1, 1, 40, 2.5)] });
    const contacts = res.events.filter((e) => ['ground', 'player', 'post', 'bar', 'net'].includes(e.kind));
    expect(contacts.length).toBeGreaterThan(0);
    for (const e of contacts) expect(frameIndexAt(res, e.t)).toBeGreaterThanOrEqual(0);
  });
});

describe('goals, outs and tails (§5.8)', () => {
  it('a straight shot is a GOAL for the defending team’s goal; the ball stays in the net during the tail', () => {
    for (const power of [0.6, 1]) {
      const res = shoot({ origin: ghost(40, r, 0), yaw: 0, power, loftDeg: power === 1 ? 5 : 0 });
      expect(res.outcome).toEqual({ kind: 'goal', goalOf: 1, lastTouch: { team: 0, playerId: null }, touches: 0 });
      const goal = ofKind(res, 'goal')[0]!;
      expect(goal.goalOf).toBe(1);
      // Tail: visual only, about TAIL_GOAL long, with net contacts marked as tail.
      expect(res.duration).toBeGreaterThan(goal.t);
      expect(res.duration).toBeLessThanOrEqual(goal.t + PHYS.TAIL_GOAL + 1e-9);
      const nets = ofKind(res, 'net');
      expect(nets.length).toBeGreaterThan(0);
      for (const n of nets) expect(n.tail).toBe(true);
      for (let i = frameIndexAt(res, goal.t); i * FRAME_STRIDE < res.frames.length; i++) {
        const f = frameAt(res, i);
        expect(f.x).toBeGreaterThan(L2);
        expect(f.x).toBeLessThan(L2 + 2.06 - r + 0.02);
        expect(Math.abs(f.z)).toBeLessThan(3.72 - r + 0.02);
        expect(f.y).toBeLessThan(2.5 - r + 0.02);
      }
      // The goal is the last rule event: nothing but tail contacts after it.
      const after = res.events.slice(res.events.indexOf(goal) + 1);
      for (const e of after) expect('tail' in e && e.tail).toBe(true);
    }
  });

  it('a shot into Team A’s goal is a goal against A', () => {
    const res = shoot({ origin: ghost(-30, r, 0), yaw: Math.PI, power: 0.8, team: 1 });
    expect(res.outcome).toMatchObject({ kind: 'goal', goalOf: 0, lastTouch: { team: 1, playerId: null } });
  });

  it('own goal: a Team A player shooting into A’s goal (goalOf 0, last touch A)', () => {
    const kicker = pl(4, 0, -40, 0);
    const origin: KickOrigin = { kind: 'player', playerId: 4, team: 0, x: -40, z: 0, gk: false };
    const res = shoot({ origin, yaw: Math.PI, power: 0.6, players: [kicker] });
    expect(res.outcome).toMatchObject({ kind: 'goal', goalOf: 0, lastTouch: { team: 0, playerId: null }, touches: 0 });
  });

  it('a wide shot is OUT over the goal line at the exit z', () => {
    const res = shoot({ origin: ghost(40, r, 10), yaw: 0, power: 0.6 });
    expect(res.outcome).toMatchObject({ kind: 'out', line: 'goal', x: L2, lastTouch: { team: 0, playerId: null } });
    if (res.outcome.kind === 'out') expect(res.outcome.z).toBeCloseTo(10, 6);
    const out = ofKind(res, 'out')[0]!;
    expect(res.duration).toBeLessThanOrEqual(out.t + PHYS.TAIL_OUT + 1e-9);
    expect(ofKind(res, 'stop')).toHaveLength(0);
  });

  it('a shot over the bar is OUT over the goal line, not a goal', () => {
    const res = shoot({ origin: ghost(48, 3.2, 1), yaw: 0, power: 0.5 });
    expect(ofKind(res, 'bar')).toHaveLength(0);
    expect(res.outcome).toMatchObject({ kind: 'out', line: 'goal', x: L2 });
    if (res.outcome.kind === 'out') expect(res.outcome.z).toBeCloseTo(1, 6);
  });

  it('a ball over the touchline is OUT at the exit x (both touchlines, lofted too)', () => {
    const res = shoot({ origin: ghost(5, r, 20), yaw: Math.PI / 2, power: 0.6 });
    expect(res.outcome).toMatchObject({ kind: 'out', line: 'touch', z: W2 });
    if (res.outcome.kind === 'out') expect(res.outcome.x).toBeCloseTo(5, 6);
    const far = shoot({ origin: ghost(-12, r, -20), yaw: -Math.PI / 2, power: 0.8, loftDeg: 30 });
    expect(far.outcome).toMatchObject({ kind: 'out', line: 'touch', z: -W2 });
    if (far.outcome.kind === 'out') expect(far.outcome.x).toBeCloseTo(-12, 6);
  });

  it('detectLines: when both planes are crossed in one step, the earlier crossing wins', () => {
    const lines = buildWorld(pitch, []).lines;
    // Corner: crosses the goal-line plane first (f = 0.25), the touchline plane later (f = 0.75).
    const gx = L2 + r;
    const tz = W2 + r;
    const hitGoalFirst = detectLines(lines, { x: gx - 0.1, y: r, z: tz - 0.3 }, { x: gx + 0.3, y: r, z: tz + 0.1 }, r);
    expect(hitGoalFirst).toMatchObject({ kind: 'out', line: 'goal', x: L2 });
    const hitTouchFirst = detectLines(lines, { x: gx - 0.3, y: r, z: tz - 0.1 }, { x: gx + 0.1, y: r, z: tz + 0.3 }, r);
    expect(hitTouchFirst).toMatchObject({ kind: 'out', line: 'touch', z: W2 });
    expect(detectLines(lines, { x: 0, y: r, z: 0 }, { x: 1, y: r, z: 1 }, r)).toBeNull();
  });

  it('T_MAX ends a populated-world kick as a stop with the last touch so far', () => {
    const world = buildWorld(pitch, [pl(5, 1, 3, 0)]);
    const res = simulateKick({
      input: { yaw: 0, power: 0.5, curve: 0, loft: 0 },
      origin: ghost(0, r, 0),
      team: 0,
      world,
      consts: { ...PHYS, T_MAX: 0.5 },
    });
    expect(res.duration).toBeCloseTo(0.5, 9);
    expect(res.outcome).toMatchObject({ kind: 'stop', lastTouch: { team: 1, playerId: 5 }, touches: 1 });
  });
});

describe('keepers (§2.5.3)', () => {
  it('a ball touching a keeper is a CATCH that ends the simulation at once', () => {
    const res = shoot({ origin: ghost(35, r, 0), yaw: 0, power: 0.5, players: [pl(3, 1, 45, 0, true)] });
    expect(res.outcome).toEqual({ kind: 'catch', keeperId: 3 });
    const last = res.events[res.events.length - 1]!;
    expect(last).toMatchObject({ kind: 'catch', keeperId: 3 });
    expect(last.t).toBe(res.duration);
    expect(ofKind(res, 'player')).toHaveLength(0);
    if (last.kind === 'catch') expect(last.x).toBeCloseTo(45 - 0.9 - r, 1);
  });

  it('the keeper’s wider reach catches a lob that would clear an outfield player', () => {
    const lob = { origin: ghost(0, r, 0), yaw: 0, power: 0.3, loftDeg: 45 };
    expect(shoot({ ...lob, players: [pl(3, 1, 11, 0, false)] }).outcome.kind).not.toBe('catch');
    expect(shoot({ ...lob, players: [pl(3, 1, 11, 0, true)] }).outcome).toEqual({ kind: 'catch', keeperId: 3 });
  });
});

describe('kicker grace (§5.6)', () => {
  it('the kicker isn’t hit by their own kick, but a later rebound can hit them', () => {
    const origin: KickOrigin = { kind: 'player', playerId: 1, team: 0, x: 0, z: 0, gk: false };
    const res = shoot({ origin, yaw: 0, power: 0.4, players: [pl(1, 0, 0, 0), pl(2, 1, 6, 0)] });
    const hits = ofKind(res, 'player').map((e) => e.playerId);
    expect(hits[0]).toBe(2);
    expect(hits).toContain(1);
    expect(res.outcome).toMatchObject({ lastTouch: { team: 0, playerId: 1 } });
    // Every direction works: kicking backwards past nobody touches no one.
    for (let k = 0; k < 8; k++) {
      const solo = shoot({ origin, yaw: k * 45 * DEG, power: 0.2, loftDeg: k * 5, players: [pl(1, 0, 0, 0)] });
      expect(ofKind(solo, 'player')).toHaveLength(0);
    }
  });

  it('a keeper who kicks isn’t caught by their own kick, but catches the rebound', () => {
    const origin: KickOrigin = { kind: 'player', playerId: 1, team: 0, x: -45, z: 0, gk: true };
    const res = shoot({ origin, yaw: 0, power: 0.4, players: [pl(1, 0, -45, 0, true), pl(2, 1, -39, 0)] });
    expect(ofKind(res, 'player').map((e) => e.playerId)).toEqual([2]);
    expect(res.outcome).toEqual({ kind: 'catch', keeperId: 1 });
  });
});

describe('determinism and performance with a full world (§5.11)', () => {
  // A crowded 22-player layout.
  const crowd: WorldPlayer[] = [];
  for (let i = 0; i < 22; i++) {
    const team: Team = i < 11 ? 0 : 1;
    const gk = i === 0 || i === 11;
    const x = gk ? (team === 0 ? -48 : 48) : -40 + ((i * 37) % 80);
    const z = gk ? 0 : -28 + ((i * 23) % 56);
    crowd.push(pl(i, team, x, z, gk));
  }
  const center = { kind: 'ghost' as const, ...kickoffSpot() };

  it('two runs give identical results', () => {
    const a = shoot({ origin: center, yaw: 0.4, power: 0.9, loftDeg: 8, curve: -0.5, players: crowd });
    const b = shoot({ origin: center, yaw: 0.4, power: 0.9, loftDeg: 8, curve: -0.5, players: crowd.map((p) => ({ ...p })) });
    expect(Array.from(b.frames)).toEqual(Array.from(a.frames));
    expect(b.events).toEqual(a.events);
    expect(b.outcome).toEqual(a.outcome);
  });

  it('100 kicks into 22 players run fast (< 10 ms each on average)', () => {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 100; i++) shoot({ origin: center, yaw: i * 0.37, power: 1, curve: (i % 3) - 1, players: crowd });
    const msEach = Number(process.hrtime.bigint() - t0) / 1e6 / 100;
    expect(msEach).toBeLessThan(10);
  });
});
