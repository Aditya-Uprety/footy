import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuestLink, HELLO_TIMEOUT_MS, HostLink, PING_MS, SILENCE_MS, type GuestLinkStatus, type HostLinkEvent } from './link';
import { sanitizeSettings, type Settings } from '../game/settings';
import { msg, type GuestMessage, type HostMessage } from './protocol';
import { LoopbackHub, type LoopbackTransport, type Transport } from './transport';

const clock = { now: () => Date.now() };
const step = async (ms = 0): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

let n = 0;
function setup(opts: { reserveMs?: number } = {}) {
  const hub = new LoopbackHub();
  const code = `ROOM${n++}`;
  const room = hub.listen(code);
  const hostTransports: Transport[] = [];
  room.onConnection((t) => hostTransports.push(t));
  const host = new HostLink(room, { name: 'Ann', clock, reserveMs: opts.reserveMs ?? 0, token: () => `tok${n++}` });
  const hostEvents: HostLinkEvent[] = [];
  host.on((e) => hostEvents.push(e));
  const hostMsgs: GuestMessage[] = [];
  host.onMessage((m) => hostMsgs.push(m));
  const join = (name = 'Bob', resume?: string) => {
    const t = hub.connect(code);
    const link = new GuestLink(t, { name, clock, ...(resume ? { resume } : {}) });
    const statuses: GuestLinkStatus[] = [];
    link.onStatus((s) => statuses.push(s));
    const msgs: HostMessage[] = [];
    link.onMessage((m) => msgs.push(m));
    return { t, link, statuses, msgs, last: () => statuses[statuses.length - 1] };
  };
  return { hub, code, room, host, hostEvents, hostMsgs, hostTransports, join };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('handshake over LoopbackTransport', () => {
  it('hello → welcome: both sides connected, host name and token delivered', async () => {
    const { host, hostEvents, join } = setup();
    const g = join('Bob');
    await step();
    expect(g.last()).toMatchObject({ kind: 'connected', hostName: 'Ann' });
    expect(g.statuses[0]).toEqual({ kind: 'connected', rtt: null, hostName: 'Ann' });
    expect(g.link.token).toMatch(/^tok/);
    expect(hostEvents[0]).toEqual({ kind: 'join', name: 'Bob', resume: false });
    expect(host.guest).toMatchObject({ name: 'Bob', connected: true });
  });

  it('measures RTT both ways with ping/pong', async () => {
    const { host, join } = setup();
    const g = join();
    await step();
    await step(PING_MS);
    expect(g.link.rtt).not.toBeNull();
    expect(host.guest?.rtt).not.toBeNull();
    expect(g.last()).toMatchObject({ kind: 'connected' });
  });

  it('passes game messages through and keeps handshake traffic out', async () => {
    const { host, hostMsgs, join } = setup();
    const g = join();
    await step();
    g.link.send(msg('intent', { intent: { type: 'rematch' } }));
    g.link.send(msg('aim', { turnId: 1, yaw: 0.25 }));
    host.send(msg('aim', { turnId: 1, yaw: -1 }));
    await step(PING_MS * 2);
    expect(hostMsgs).toEqual([msg('intent', { intent: { type: 'rematch' } }), msg('aim', { turnId: 1, yaw: 0.25 })]);
    expect(g.msgs).toEqual([msg('aim', { turnId: 1, yaw: -1 })]);
  });

  it('drops malformed messages from the guest', async () => {
    const { hostMsgs, join } = setup();
    const g = join();
    await step();
    g.t.send({ v: 1, t: 'intent', intent: { type: 'kick' } });
    g.t.send('garbage');
    await step();
    expect(hostMsgs).toEqual([]);
  });

  it('a second guest gets reject{full}', async () => {
    const { hostEvents, join } = setup();
    const a = join('A');
    await step();
    const b = join('B');
    await step();
    expect(a.last()?.kind).toBe('connected');
    expect(b.last()).toEqual({ kind: 'rejected', reason: 'full' });
    expect(hostEvents).toContainEqual({ kind: 'rejected', reason: 'full' });
    await step(1000);
    expect(b.t.state).toBe('closed');
  });

  it('version mismatch → reject{version}', async () => {
    const { hub, code, hostEvents } = setup();
    const t = hub.connect(code);
    const got: unknown[] = [];
    t.onMessage((m) => got.push(m));
    t.onStatus((s) => {
      if (s.kind === 'open') t.send({ v: 2, t: 'hello', name: 'Future', proto: 2 });
    });
    await step();
    expect(got).toEqual([{ v: 1, t: 'reject', reason: 'version' }]);
    expect(hostEvents).toEqual([{ kind: 'rejected', reason: 'version' }]);
    await step(1000);
    expect(t.state).toBe('closed');
  });

  it('a finished match rejects newcomers with reject{ended}', async () => {
    const { host, join } = setup();
    host.setEnded(true);
    const g = join();
    await step();
    expect(g.last()).toEqual({ kind: 'rejected', reason: 'ended' });
  });

  it('a connection that never says hello is dropped', async () => {
    const { hub, code } = setup();
    const t = hub.connect(code);
    await step();
    expect(t.state).toBe('open');
    await step(HELLO_TIMEOUT_MS + 1000);
    expect(t.state).toBe('closed');
  });

  it('room not found surfaces as an error status', async () => {
    const hub = new LoopbackHub();
    const link = new GuestLink(hub.connect('NOPE1'), { name: 'Bob', clock });
    await step();
    expect(link.status).toMatchObject({ kind: 'error', error: { code: 'room-not-found' } });
  });
});

describe('heartbeat and leaving', () => {
  it('guest bye → host sees "left" at once and the seat frees', async () => {
    const { host, hostEvents, join } = setup();
    const a = join('A');
    await step();
    a.link.close();
    await step();
    expect(hostEvents.at(-1)).toEqual({ kind: 'left', why: 'closed' });
    expect(host.guest).toBeNull();
    const b = join('B');
    await step();
    expect(b.last()?.kind).toBe('connected');
  });

  it('host close → guest sees "ended" (bye)', async () => {
    const { host, join } = setup();
    const g = join();
    await step();
    host.close('host left');
    await step();
    expect(g.last()).toEqual({ kind: 'ended', reason: 'host left' });
  });

  it('a silent link is lost on both sides after SILENCE_MS (no close event)', async () => {
    const { hostEvents, join } = setup();
    const g = join();
    await step();
    (g.t as LoopbackTransport).sever();
    await step(SILENCE_MS - PING_MS);
    expect(g.last()?.kind).toBe('connected');
    expect(hostEvents.some((e) => e.kind === 'left')).toBe(false);
    await step(PING_MS * 2);
    expect(g.last()).toEqual({ kind: 'lost' });
    expect(hostEvents).toContainEqual({ kind: 'left', why: 'silent' });
  });

  it('a steady link never goes silent', async () => {
    const { hostEvents, join } = setup();
    const g = join();
    await step();
    await step(SILENCE_MS * 5);
    expect(g.last()?.kind).toBe('connected');
    expect(hostEvents.filter((e) => e.kind === 'left')).toEqual([]);
  });

  it('transport closed without bye → guest "lost"', async () => {
    const { hostTransports, join } = setup();
    const g = join();
    await step();
    hostTransports[0]!.close();
    await step();
    expect(g.last()).toEqual({ kind: 'lost' });
  });
});

describe('seat reservation and resume (§8.5)', () => {
  it('with a reservation, only the dropped guest’s token gets seat 1 back', async () => {
    const { host, hostEvents, join } = setup({ reserveMs: 120_000 });
    const a = join('A');
    await step();
    const token = a.link.token!;
    (a.t as LoopbackTransport).sever();
    await step(SILENCE_MS + PING_MS);
    expect(host.guest).toMatchObject({ name: 'A', connected: false });

    const stranger = join('X');
    await step();
    expect(stranger.last()).toEqual({ kind: 'rejected', reason: 'full' });

    const back = join('A', token);
    await step();
    expect(back.last()?.kind).toBe('connected');
    expect(back.link.token).toBe(token);
    expect(hostEvents).toContainEqual({ kind: 'join', name: 'A', resume: true });
  });

  it('the reservation expires', async () => {
    const { host, join } = setup({ reserveMs: 30_000 });
    const a = join('A');
    await step();
    a.link.close();
    await step(31_000);
    expect(host.guest).toBeNull();
    const b = join('B');
    await step();
    expect(b.last()?.kind).toBe('connected');
  });

  it('without a reservation (lobby), anyone can take the free seat', async () => {
    const { join } = setup({ reserveMs: 0 });
    const a = join('A');
    await step();
    (a.t as LoopbackTransport).sever();
    await step(SILENCE_MS + PING_MS);
    const b = join('B');
    await step();
    expect(b.last()).toMatchObject({ kind: 'connected' });
  });
});

describe('lobby settings sync (M13.3)', () => {
  const custom = sanitizeSettings({ kicksPerMatch: 10, shotTimerSec: 0, pitchLength: 100 });

  it('a guest that joins gets the host settings with the welcome', async () => {
    const { host, join } = setup();
    host.setSettings(custom);
    const g = join();
    const seen: Settings[] = [];
    g.link.onSettings((s) => seen.push(s));
    await step();
    expect(g.link.settings).toEqual(custom);
    expect(g.msgs).toEqual([]); // settings never reach the game-message listeners
  });

  it('changes before the match reach a connected guest at once', async () => {
    const { host, join } = setup();
    const g = join();
    const seen: Settings[] = [];
    g.link.onSettings((s) => seen.push(s));
    await step();
    expect(g.link.settings).toBeNull();
    host.setSettings(custom);
    host.setSettings({ ...custom, kicksPerMatch: 20 });
    await step();
    expect(seen.map((s) => s.kicksPerMatch)).toEqual([10, 20]);
    expect(g.link.settings?.kicksPerMatch).toBe(20);
  });

  it('a malformed settings message is dropped', async () => {
    const { hostTransports, join } = setup();
    const g = join();
    const seen: Settings[] = [];
    g.link.onSettings((s) => seen.push(s));
    await step();
    hostTransports[0]!.send({ v: 1, t: 'settings', settings: { kicksPerMatch: 'many' } });
    await step();
    expect(seen).toEqual([]);
  });
});
