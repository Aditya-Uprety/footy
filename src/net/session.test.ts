import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeSeat } from '../game/rules';
import { defaultSettings, type Settings } from '../game/settings';
import type { GameState, Seat } from '../game/types';
import type { Denial, Session, SessionAim, SessionKick } from '../app/session';
import { GuestSession } from './guestSession';
import { HostSession } from './hostSession';
import { GuestLink, HostLink, RESERVE_MS, SILENCE_MS, type GuestLinkStatus } from './link';
import { msg } from './protocol';
import { LoopbackHub } from './transport';

const clock = { now: () => Date.now() };
const step = async (ms = 0): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

let n = 0;
async function setup(o: { settings?: Partial<Settings>; seed?: number; now?: () => number } = {}) {
  const hub = new LoopbackHub();
  const code = `SESS${n++}`;
  const room = hub.listen(code);
  const hostLink = new HostLink(room, { name: 'Ann', clock });
  const t = hub.connect(code);
  const guestLink = new GuestLink(t, { name: 'Bob', clock });
  await step();
  const guest = new GuestSession(guestLink, { seed: 99 });
  const host = new HostSession({
    link: hostLink,
    settings: { ...defaultSettings(), ...o.settings },
    names: ['Ann', 'Bob'],
    seed: o.seed ?? 7,
    tickMs: 0,
    ...(o.now ? { now: o.now } : {}),
  });
  await step();
  const log = (s: Session) => {
    const kicks: SessionKick[] = [];
    const denied: Denial[] = [];
    const aims: SessionAim[] = [];
    const states: GameState[] = [];
    s.onKick((k) => kicks.push(k));
    s.onDenied((d) => denied.push(d));
    s.onAim((a) => aims.push(a));
    s.onState((st) => states.push(st));
    return { kicks, denied, aims, states };
  };
  return { hub, code, hostLink, guestLink, t, host, guest, h: log(host), g: log(guest) };
}

/** The session that plays `seat`. */
const of = (x: { host: HostSession; guest: GuestSession }, seat: Seat): Session => (seat === 0 ? x.host : x.guest);

/** Toss (winner takes A) and a random draft, each pick sent by its own side. */
async function draft(x: Awaited<ReturnType<typeof setup>>): Promise<void> {
  const w = x.host.state.toss.winner;
  of(x, w).send(w, { type: 'tossChoice', role: 'A' });
  await step();
  while (x.host.state.phase === 'placement') {
    const seat = activeSeat(x.host.state)!;
    const s = of(x, seat);
    s.send(seat, s.randomPick(seat)!);
    await step();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('HostSession + GuestSession over LoopbackTransport', () => {
  it('the guest gets the toss snapshot when the match starts', async () => {
    const x = await setup();
    expect(x.guest.ready).toBe(true);
    expect(x.guest.state).toEqual(x.host.state);
    expect(x.guest.state.phase).toBe('toss');
    expect(x.host.localSeats).toEqual([0]);
    expect(x.guest.localSeats).toEqual([1]);
  });

  it('toss and draft: each side sends only its own picks; both end with the same state', async () => {
    const x = await setup();
    await draft(x);
    expect(x.host.state.phase).toBe('play');
    expect(x.host.state.players).toHaveLength(22);
    expect(x.guest.state).toEqual(x.host.state);
    expect(x.h.denied).toEqual([]);
    expect(x.g.denied).toEqual([]);
  });

  it('the guest refuses intents that are not its turn, locally', async () => {
    const x = await setup();
    const loser: Seat = x.host.state.toss.winner === 0 ? 1 : 0;
    if (loser === 1) {
      x.guest.send(1, { type: 'tossChoice', role: 'B' });
      expect(x.g.denied.at(-1)).toMatchObject({ intentType: 'tossChoice', reason: 'Not your choice' });
    }
    await draft(x);
    const s = x.guest.state;
    if (activeSeat(s) !== 1) {
      x.guest.send(1, { type: 'kick', turnId: s.turnId, input: { yaw: 0, power: 0.5, curve: 0, loft: 0 }, auto: false });
      expect(x.g.denied.at(-1)).toMatchObject({ intentType: 'kick', reason: 'Not your kick' });
    }
    x.guest.send(0, { type: 'rematch' }); // not our seat: ignored
    await step();
    expect(x.host.state.rev).toBe(s.rev);
  });

  it('host refusals reach the guest as denied', async () => {
    const x = await setup();
    await draft(x);
    // Bypass the guest's own gate: a stale kick straight over the link.
    x.guestLink.send(msg('intent', { intent: { type: 'kick', turnId: 999, input: { yaw: 0, power: 0.5, curve: 0, loft: 0 }, auto: false } }));
    await step();
    expect(x.g.denied.at(-1)).toMatchObject({ seat: 1, intentType: 'kick', reason: 'Stale turn' });
  });

  it('a kick reaches both sides with identical frames and the same next state', async () => {
    const x = await setup();
    await draft(x);
    for (let i = 0; i < 4; i++) {
      const s = x.host.state;
      const seat = activeSeat(s)!;
      of(x, seat).send(seat, { type: 'kick', turnId: s.turnId, input: { yaw: 0.1 * i, power: 0.6, curve: 0.3, loft: 0.1 }, auto: false });
      await step();
      const hk = x.h.kicks.at(-1)!;
      const gk = x.g.kicks.at(-1)!;
      expect(gk.seat).toBe(seat);
      expect(hk.seat).toBe(seat);
      expect([...gk.result.frames]).toEqual([...hk.result.frames]);
      expect(gk.result.events).toEqual(hk.result.events);
      expect(gk.next).toEqual(hk.next);
      expect(x.guest.state).toEqual(x.host.state);
    }
    expect(x.g.kicks).toHaveLength(4);
    // A kick is not followed by a state snapshot of the same change.
    expect(x.g.states.filter((st) => st.phase === 'play' && st.kicksTaken > 0)).toEqual([]);
  });

  it('aim streams both ways only from the seat that is aiming; the guard kicks with the streamed yaw', async () => {
    let now = 0;
    const x = await setup({ now: () => now, settings: { shotTimerSec: 10 } });
    await draft(x);
    const s = x.host.state;
    const seat = activeSeat(s)!;
    const other: Seat = seat === 0 ? 1 : 0;
    of(x, other).aim(other, s.turnId, 2); // not aiming: dropped
    of(x, seat).aim(seat, s.turnId, 1.25);
    await step();
    const recv = seat === 0 ? x.g.aims : x.h.aims;
    expect(recv).toEqual([{ seat, turnId: s.turnId, yaw: 1.25 }]);
    expect((seat === 0 ? x.h : x.g).aims).toEqual([]);
    now = 10_000 + 15_000;
    expect(x.host.core.tick(now)).toBe(true);
    await step();
    expect(x.g.kicks.at(-1)!.result.input.yaw).toBeCloseTo(1.25, 6);
  });

  it('a guest that rejoins gets the current state', async () => {
    const x = await setup();
    await draft(x);
    x.guestLink.close();
    await step(500);
    const t2 = x.hub.connect(x.code);
    const link2 = new GuestLink(t2, { name: 'Bob', clock });
    const g2 = new GuestSession(link2);
    await step();
    expect(g2.ready).toBe(true);
    expect(g2.state).toEqual(x.host.state);
  });

  it('placement guard: a silent seat gets a random legal pick after placementTimer + 15 s, on both screens', async () => {
    let now = 0;
    const x = await setup({ now: () => now, settings: { placementTimerSec: 20 } });
    const w = x.host.state.toss.winner;
    of(x, w).send(w, { type: 'tossChoice', role: 'A' });
    await step();
    expect(x.host.state.phase).toBe('placement');
    const pick = x.host.state.pick;
    now = 20_000 + 15_000 - 1;
    expect(x.host.core.tick(now)).toBe(false);
    now += 1;
    expect(x.host.core.tick(now)).toBe(true);
    await step();
    expect(x.host.state.pick).toBe(pick + 1);
    expect(x.guest.state).toEqual(x.host.state);
  });

  it('shot timer off ⇒ no guard', async () => {
    let now = 0;
    const x = await setup({ now: () => now, settings: { shotTimerSec: 0 } });
    await draft(x);
    now = 10 * 60_000;
    expect(x.host.core.tick(now)).toBe(false);
  });

  it('resume: a dropped guest comes back with its token to the same seat and state; strangers are turned away meanwhile', async () => {
    const x = await setup();
    x.hostLink.reserveMs = RESERVE_MS;
    await draft(x);
    const s = x.host.state;
    const seat = activeSeat(s)!;
    of(x, seat).send(seat, { type: 'kick', turnId: s.turnId, input: { yaw: 0.2, power: 0.5, curve: 0, loft: 0 }, auto: false });
    await step();
    const token = x.guestLink.token!;
    (x.t as unknown as { sever(): void }).sever();
    await step(SILENCE_MS + 2000);
    expect(x.guestLink.status.kind).toBe('lost');
    expect(x.hostLink.guest).toMatchObject({ connected: false });
    // Meanwhile the host kicks (if it's its turn): the guest misses that kick.
    const s2 = x.host.state;
    if (activeSeat(s2) === 0) {
      x.host.send(0, { type: 'kick', turnId: s2.turnId, input: { yaw: -0.3, power: 0.4, curve: 0, loft: 0 }, auto: false });
    }
    // A stranger can't take the reserved seat.
    const stranger = new GuestLink(x.hub.connect(x.code), { name: 'Eve', clock });
    const ss: GuestLinkStatus[] = [];
    stranger.onStatus((st) => ss.push(st));
    await step();
    expect(ss.at(-1)).toEqual({ kind: 'rejected', reason: 'full' });
    // The same session continues on a new link.
    const link2 = new GuestLink(x.hub.connect(x.code), { name: 'Bob', clock, resume: token });
    x.guest.attach(link2);
    await step();
    expect(link2.status.kind).toBe('connected');
    expect(link2.token).toBe(token);
    expect(x.guest.state).toEqual(x.host.state);
    // And it can still play its turns.
    const s3 = x.host.state;
    const seat3 = activeSeat(s3)!;
    of(x, seat3).send(seat3, { type: 'kick', turnId: s3.turnId, input: { yaw: 0, power: 0.5, curve: 0, loft: 0 }, auto: false });
    await step();
    expect(x.guest.state).toEqual(x.host.state);
    expect(x.host.state.kicksTaken).toBeGreaterThan(s3.kicksTaken);
  });

  it('after the reservation expires a new guest may take the seat', async () => {
    const x = await setup();
    x.hostLink.reserveMs = RESERVE_MS;
    await draft(x);
    (x.t as unknown as { sever(): void }).sever();
    await step(SILENCE_MS + RESERVE_MS + 4000);
    const g2 = new GuestSession(new GuestLink(x.hub.connect(x.code), { name: 'Cy', clock }));
    await step();
    expect(g2.link.status.kind).toBe('connected');
    expect(g2.state).toEqual(x.host.state);
  });

  it('online rematch: full-time, both vote (one from each side) → a new toss on both screens', async () => {
    const x = await setup({ settings: { kicksPerMatch: 10 } });
    await draft(x);
    while (x.host.state.phase === 'play') {
      const s = x.host.state;
      const seat = activeSeat(s)!;
      of(x, seat).send(seat, { type: 'kick', turnId: s.turnId, input: { yaw: s.turnId, power: 0.7, curve: 0, loft: 0.1 }, auto: false });
      await step();
    }
    expect(x.host.state.phase).toBe('fulltime');
    expect(x.guest.state).toEqual(x.host.state);
    x.guest.send(1, { type: 'rematch' });
    await step();
    expect(x.host.state.rematchVotes).toEqual([false, true]);
    expect(x.guest.state.rematchVotes).toEqual([false, true]);
    x.host.send(0, { type: 'rematch' });
    await step();
    expect(x.host.state.phase).toBe('toss');
    expect(x.host.state.players).toEqual([]);
    expect(x.guest.state).toEqual(x.host.state);
  });
});
