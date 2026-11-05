// M10.6: a whole online match through HostSession + GuestSession over a
// LoopbackTransport with latency: toss, draft, 40 kicks with half-time and
// full-time, aim streaming, one guest drop + resume. Both sides must end with
// identical state, and every snapshot / kick the guest saw must equal the
// host's at the same revision.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeSeat } from '../game/rules';
import { defaultSettings } from '../game/settings';
import type { GameState, Seat } from '../game/types';
import { createRng } from '../shared/rng';
import type { Session, SessionKick } from '../app/session';
import { GuestSession } from './guestSession';
import { HostSession } from './hostSession';
import { GuestLink, HostLink, RESERVE_MS, SILENCE_MS } from './link';
import { LoopbackHub, type LoopbackTransport } from './transport';

const clock = { now: () => Date.now() };
const LATENCY = 25;
const step = async (ms = LATENCY * 3): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('networked full match (LoopbackTransport, 25 ms each way)', () => {
  it('plays toss → draft → 40 kicks → full-time with identical state on both sides', async () => {
    const hub = new LoopbackHub({ latencyMs: LATENCY });
    const room = hub.listen('MATCH');
    const hostLink = new HostLink(room, { name: 'Ann', clock, reserveMs: RESERVE_MS });
    let guestT = hub.connect('MATCH') as LoopbackTransport;
    let guestLink = new GuestLink(guestT, { name: 'Bob', clock });
    await step();
    const guest = new GuestSession(guestLink, { seed: 5 });
    const host = new HostSession({ link: hostLink, settings: defaultSettings(), names: ['Ann', 'Bob'], seed: 2026, tickMs: 0 });
    await step();

    // Everything each side saw, by revision.
    const hostSeen = new Map<number, GameState>();
    const guestSeen = new Map<number, GameState>();
    const hostKicks: SessionKick[] = [];
    const guestKicks: SessionKick[] = [];
    host.onState((s) => hostSeen.set(s.rev, s));
    guest.onState((s) => guestSeen.set(s.rev, s));
    host.onKick((k) => (hostKicks.push(k), hostSeen.set(k.next.rev, k.next)));
    guest.onKick((k) => (guestKicks.push(k), guestSeen.set(k.next.rev, k.next)));
    const guestAims: number[] = [];
    const hostAims: number[] = [];
    host.onAim((a) => hostAims.push(a.turnId));
    guest.onAim((a) => guestAims.push(a.turnId));
    guest.onDenied((d) => {
      throw new Error(`guest denied: ${d.reason}`);
    });
    host.onDenied((d) => {
      throw new Error(`host denied: ${d.reason}`);
    });

    const of = (seat: Seat): Session => (seat === 0 ? host : guest);
    const r = createRng(77);
    const rng = (): number => r.next();

    // Toss.
    const w = host.state.toss.winner;
    of(w).send(w, { type: 'tossChoice', role: rng() < 0.5 ? 'A' : 'B' });
    await step();
    // Draft: each pick from its own side.
    while (host.state.phase === 'placement') {
      const seat = activeSeat(host.state)!;
      expect(of(seat).state.pick).toBe(host.state.pick);
      of(seat).send(seat, of(seat).randomPick(seat)!);
      await step();
    }
    expect(host.state.players).toHaveLength(22);

    let halfSeen = false;
    let dropped = false;
    while (host.state.phase === 'play') {
      const s = host.state;
      const seat = activeSeat(s)!;
      // The kicker's view is the same snapshot.
      expect(of(seat).state).toEqual(s);
      // Aim a little (streamed to the other side), then kick.
      const yaw = (rng() - 0.5) * 2 * Math.PI;
      of(seat).aim(seat, s.turnId, yaw * 0.5);
      of(seat).aim(seat, s.turnId, yaw);
      await step();
      of(seat).send(seat, {
        type: 'kick',
        turnId: s.turnId,
        input: { yaw, power: 0.3 + rng() * 0.7, curve: rng() * 2 - 1, loft: rng() * 0.6 },
        auto: false,
      });
      await step();
      expect(host.state.kicksTaken).toBe(s.kicksTaken + 1);
      if (host.state.half === 2) halfSeen = true;

      // Once, mid-way through the second half: the guest's connection drops silently and resumes.
      if (!dropped && host.state.kicksTaken === 27) {
        dropped = true;
        const token = guestLink.token!;
        guestT.sever();
        await step(SILENCE_MS + 2500);
        expect(hostLink.guest?.connected).toBe(false);
        // The host plays on if it's its turn (the guest misses that kick).
        const sd = host.state;
        if (activeSeat(sd) === 0) {
          host.send(0, { type: 'kick', turnId: sd.turnId, input: { yaw: 0.5, power: 0.6, curve: 0, loft: 0.1 }, auto: false });
          await step();
        }
        guestT = hub.connect('MATCH') as LoopbackTransport;
        guestLink = new GuestLink(guestT, { name: 'Bob', clock, resume: token });
        guest.attach(guestLink);
        await step();
        expect(guestLink.status.kind).toBe('connected');
        expect(guest.state).toEqual(host.state);
      }
    }

    expect(dropped).toBe(true);
    expect(halfSeen).toBe(true);
    expect(host.state.phase).toBe('fulltime');
    expect(host.state.kicksTaken).toBe(40);
    expect(guest.state).toEqual(host.state);
    expect(JSON.stringify(guest.state)).toBe(JSON.stringify(host.state));

    // Every revision the guest saw matches the host's.
    for (const [rev, gs] of guestSeen) expect(gs, `rev ${rev}`).toEqual(hostSeen.get(rev));
    // Every kick the guest played back is the host's, frame for frame (the guest missed at most one).
    expect(guestKicks.length).toBeGreaterThanOrEqual(39);
    for (const gk of guestKicks) {
      const hk = hostKicks.find((k) => k.result.turnId === gk.result.turnId)!;
      expect(gk.seat).toBe(hk.seat);
      expect([...gk.result.frames]).toEqual([...hk.result.frames]);
      expect(gk.result.events).toEqual(hk.result.events);
      expect(gk.next).toEqual(hk.next);
    }
    // Aims went both ways, only for the other side's turns.
    expect(hostAims.length).toBeGreaterThan(0);
    expect(guestAims.length).toBeGreaterThan(0);

    const [a, b] = host.state.score;
    console.info(`networked match: ${host.state.seatNames[0]} vs ${host.state.seatNames[1]}, teams ${JSON.stringify(host.state.toss.teamOfSeat)}, score A ${a} : ${b} B, kicks ${host.state.kicksTaken}, guest kicks seen ${guestKicks.length}`);
    host.dispose();
    guest.dispose();
    hostLink.close();
  });
});
