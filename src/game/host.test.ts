import { describe, expect, it } from 'vitest';
import { createRng } from '../shared/rng';
import { DRAFT_SCHEDULE } from './draft';
import { defaultYaw, GUARD_GRACE_MS, GUARD_SLIDERS, HostCore, type KickEvent } from './host';
import { activeSeat, seatOfTeam } from './rules';
import { defaultSettings, type Settings } from './settings';
import { draftedMatch } from './testUtil';
import type { GameState, Intent, Seat } from './types';

function clock() {
  const c = { t: 1000, now: () => c.t };
  return c;
}

function host(settings: Partial<Settings> = {}, seed = 1, state?: GameState) {
  const c = clock();
  const core = new HostCore({ settings: { ...defaultSettings(), ...settings }, names: ['Ann', 'Bob'], seed, now: c.now, ...(state ? { state } : {}) });
  const states: GameState[] = [];
  const kicks: KickEvent[] = [];
  core.onState((s) => states.push(s));
  core.onKick((k) => kicks.push(k));
  return { core, c, states, kicks };
}

/** Toss (winner takes A) and a full random draft through intents. */
function draftVia(core: HostCore): void {
  const w = core.state.toss.winner;
  expect(core.handle(w, { type: 'tossChoice', role: 'A' })).toEqual({ ok: true });
  for (let pick = 0; pick < DRAFT_SCHEDULE.length; pick++) {
    const seat = activeSeat(core.state)!;
    const intent = core.randomPickFor(seat)!;
    expect(core.handle(seat, intent)).toEqual({ ok: true });
  }
}

const other = (s: Seat): Seat => (s === 0 ? 1 : 0);
const kickIntent = (turnId: number, power = 0.5): Intent => ({ type: 'kick', turnId, input: { yaw: 0, power, curve: 0, loft: 0 }, auto: false });

describe('HostCore intent validation (§8.6)', () => {
  it('toss: only the winner', () => {
    const { core, states } = host();
    const w = core.state.toss.winner;
    expect(core.handle(other(w), { type: 'tossChoice', role: 'A' })).toMatchObject({ ok: false, reason: /toss winner/ });
    expect(core.handle(w, { type: 'tossChoice', role: 'C' as 'A' })).toMatchObject({ ok: false, reason: 'Unknown role' });
    expect(states).toHaveLength(0);
    expect(core.handle(w, { type: 'tossChoice', role: 'B' })).toEqual({ ok: true });
    expect(states).toHaveLength(1);
    expect(core.state.toss.teamOfSeat![w]).toBe(1);
  });

  it('placement: wrong seat, stale pick, malformed and illegal spots are refused', () => {
    const { core } = host();
    core.handle(core.state.toss.winner, { type: 'tossChoice', role: 'A' });
    const a = seatOfTeam(core.state, 0)!;
    const good = core.randomPickFor(a)!;
    expect(core.randomPickFor(other(a))).toBeNull();
    expect(core.handle(other(a), good)).toMatchObject({ ok: false, reason: 'Not your pick' });
    expect(core.handle(a, { ...good, pick: 3 } as Intent)).toMatchObject({ ok: false, reason: 'Stale pick' });
    expect(core.handle(a, { type: 'place', pick: 0, spots: [{ x: 'a' as unknown as number, z: 0, gk: false }] })).toMatchObject({ ok: false, reason: 'Malformed spots' });
    const bad = core.handle(a, { type: 'place', pick: 0, spots: [{ x: 3, z: 0, gk: false }] });
    expect(bad).toMatchObject({ ok: false, reason: 'Inside the center circle' });
    expect(bad.ok === false && bad.violations?.[0]?.code).toBe('centerCircle');
    expect(core.state.pick).toBe(0);
    expect(core.handle(a, good)).toEqual({ ok: true });
    expect(core.state.pick).toBe(1);
  });

  it('kick: wrong seat, stale turn, malformed input are refused; a kick fires onKick only', () => {
    const { core, states, kicks } = host();
    draftVia(core);
    const n = states.length;
    const a = activeSeat(core.state)!;
    expect(core.state.possession?.team).toBe(0);
    expect(a).toBe(seatOfTeam(core.state, 0));
    expect(core.handle(other(a), kickIntent(1))).toMatchObject({ ok: false, reason: 'Not your kick' });
    expect(core.handle(a, kickIntent(2))).toMatchObject({ ok: false, reason: 'Stale turn' });
    expect(core.handle(a, { type: 'kick', turnId: 1, input: { yaw: Number.NaN, power: 1, curve: 0, loft: 0 }, auto: false })).toMatchObject({ ok: false, reason: 'Malformed kick input' });
    expect(core.handle(a, { type: 'nope' } as unknown as Intent)).toMatchObject({ ok: false, reason: 'Unknown intent' });
    expect(core.handle(a, null as unknown as Intent)).toMatchObject({ ok: false, reason: 'Malformed intent' });
    expect(kicks).toHaveLength(0);

    expect(core.handle(a, { type: 'kick', turnId: 1, input: { yaw: 0, power: 7, curve: -9, loft: 0 }, auto: true })).toEqual({ ok: true });
    expect(kicks).toHaveLength(1);
    expect(kicks[0]!).toMatchObject({ seat: a, auto: true, guard: false });
    expect(kicks[0]!.result.input).toMatchObject({ power: 1, curve: -1 });
    expect(kicks[0]!.next).toBe(core.state);
    expect(states.length).toBe(n);
    // The same turn can't be kicked twice.
    expect(core.handle(a, kickIntent(1))).toMatchObject({ ok: false });
  });

  it('rematch: only at full-time, both seats', () => {
    const { core } = host({ kicksPerMatch: 10 });
    draftVia(core);
    expect(core.handle(0, { type: 'rematch' })).toMatchObject({ ok: false, reason: /not over/ });
    while (core.state.phase === 'play') core.handle(activeSeat(core.state)!, kickIntent(core.state.turnId, 0.3));
    expect(core.state.phase).toBe('fulltime');
    expect(core.handle(1, { type: 'rematch' })).toEqual({ ok: true });
    expect(core.handle(1, { type: 'rematch' })).toMatchObject({ ok: false });
    expect(core.handle(0, { type: 'rematch' })).toEqual({ ok: true });
    expect(core.state.phase).toBe('toss');
  });
});

describe('HostCore guards (§8.4)', () => {
  it('auto-kicks after shotTimer + previous playback + 15 s with the last streamed yaw and neutral sliders', () => {
    const { core, c, kicks } = host({ shotTimerSec: 20 });
    draftVia(core);
    const start = c.t;
    expect(core.deadline()).toBe(start + 20_000 + GUARD_GRACE_MS);
    const a = activeSeat(core.state)!;
    core.noteAim(other(a), 2.5); // ignored: not the kicker
    core.noteAim(a, 1.25);
    expect(core.tick(start + 34_999)).toBe(false);
    c.t = start + 35_000;
    expect(core.tick(c.t)).toBe(true);
    expect(kicks).toHaveLength(1);
    expect(kicks[0]!).toMatchObject({ auto: true, guard: true, seat: a });
    expect(kicks[0]!.result.input).toEqual({ yaw: 1.25, ...GUARD_SLIDERS });

    // Next turn: the clock restarted at the kick and the previous playback time is added.
    const dur = kicks[0]!.result.duration * 1000;
    expect(core.deadline()).toBe(c.t + 20_000 + dur + GUARD_GRACE_MS);
    // No streamed yaw this turn → toward the opponent's goal.
    const yaw = defaultYaw(core.state);
    c.t = core.deadline()!;
    core.tick(c.t);
    expect(kicks[1]!.result.input.yaw).toBeCloseTo(yaw, 12);
  });

  it('no shot guard with the shot timer off', () => {
    const { core } = host({ shotTimerSec: 0 });
    draftVia(core);
    expect(core.deadline()).toBeNull();
    expect(core.tick(1e12)).toBe(false);
  });

  it('placement guard (timer on) fills the pick with random legal spots', () => {
    const { core, c, states } = host({ placementTimerSec: 30 });
    expect(core.deadline()).toBeNull(); // toss: no guard
    core.handle(core.state.toss.winner, { type: 'tossChoice', role: 'A' });
    expect(core.deadline()).toBe(c.t + 30_000 + GUARD_GRACE_MS);
    expect(core.tick(c.t + 44_000)).toBe(false);
    expect(core.tick(c.t + 45_000)).toBe(true);
    expect(core.state.pick).toBe(1);
    expect(core.state.players).toHaveLength(1);
    expect(states.at(-1)).toBe(core.state);
    expect(host().core.deadline()).toBeNull();
  });

  it('resumes from a saved state', () => {
    const s = draftedMatch(8);
    const { core } = host({}, 2, s);
    expect(core.state).toBe(s);
    expect(core.handle(activeSeat(s)!, kickIntent(s.turnId))).toEqual({ ok: true });
  });
});

describe('scripted full match through HostCore (M6.6)', () => {
  it('40 kicks from toss to full-time: half-time swap, consistent score, monotonic rev', () => {
    const { core, kicks, states } = host({}, 2026);
    draftVia(core);
    expect(core.state.phase).toBe('play');
    const rng = createRng(77);
    let lastRev = core.state.rev;
    let goals: [number, number] = [0, 0];
    let sawHalfTime = false;
    while (core.state.phase === 'play') {
      const s = core.state;
      const seat = activeSeat(s)!;
      // Aim roughly at goal with random sliders.
      const input = { yaw: defaultYaw(s) + rng.range(-0.35, 0.35), power: rng.range(0.3, 1), curve: rng.range(-1, 1), loft: rng.range(0, 0.6) };
      expect(core.handle(seat, { type: 'kick', turnId: s.turnId, input, auto: false })).toEqual({ ok: true });
      const ev = kicks.at(-1)!;
      expect(ev.result.turnId).toBe(s.turnId);
      expect(ev.next.kicksTaken).toBe(s.kicksTaken + 1);
      expect(ev.next.rev).toBeGreaterThan(lastRev);
      lastRev = ev.next.rev;
      const o = ev.result.outcome;
      if (o.kind === 'goal' && !ev.next.last?.disallowed) goals[o.goalOf === 0 ? 1 : 0]++;
      if (ev.next.kicksTaken === 20) {
        sawHalfTime = true;
        expect(ev.next.half).toBe(2);
        expect(ev.next.possession).toMatchObject({ team: 1, restart: 'kickoff' });
      }
      if (ev.next.phase === 'play') expect(ev.next.turnId).toBe(s.turnId + 1);
    }
    const end = core.state;
    expect(sawHalfTime).toBe(true);
    expect(end.phase).toBe('fulltime');
    expect(end.kicksTaken).toBe(40);
    expect(kicks).toHaveLength(40);
    expect(end.score).toEqual(goals);
    expect(states.every((s) => s.phase !== 'play' || s.kicksTaken === 0)).toBe(true);
    const outcomes = kicks.map((k) => k.result.outcome.kind);
    const awarded = kicks.map((k) => k.next.last!.awarded);
    console.log(
      `Scripted match (seed 2026): ${end.seatNames[0]} vs ${end.seatNames[1]} — Team A ${end.score[0]} : ${end.score[1]} Team B after ${end.kicksTaken} kicks.`,
      `Outcomes: ${['goal', 'out', 'catch', 'stop'].map((k) => `${k} ${outcomes.filter((x) => x === k).length}`).join(', ')}.`,
      `Restarts: ${[...new Set(awarded)].join(', ')}.`,
    );
  });

  it('a 10-kick match (M13.3 setting) has half-time after 5 and full-time after 10', () => {
    const { core, kicks } = host({ kicksPerMatch: 10 }, 99);
    draftVia(core);
    const rng = createRng(5);
    const halves: number[] = [];
    while (core.state.phase === 'play') {
      const s = core.state;
      const input = { yaw: defaultYaw(s) + rng.range(-0.3, 0.3), power: rng.range(0.3, 1), curve: 0, loft: rng.range(0, 0.5) };
      expect(core.handle(activeSeat(s)!, { type: 'kick', turnId: s.turnId, input, auto: false })).toEqual({ ok: true });
      const next = kicks.at(-1)!.next;
      if (next.half === 2 && halves.length === 0) halves.push(next.kicksTaken);
    }
    expect(halves).toEqual([5]);
    expect(core.state.phase).toBe('fulltime');
    expect(core.state.kicksTaken).toBe(10);
    expect(kicks).toHaveLength(10);
  });
});
