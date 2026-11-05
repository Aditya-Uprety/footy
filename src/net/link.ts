// Connection layer above a Transport (PLAN §8.3 join, §8.5 heartbeat, M9.4).
//
// HostLink owns the room: it answers each incoming guest's `hello` with
// `welcome` or `reject` (full / version / ended), keeps seat 1 (optionally
// reserved for a resume token after a drop), pings, measures RTT and notices
// silence. GuestLink does the guest half: hello → welcome/reject, ping/pong,
// silence → lost. Game messages (state, kick, intent, aim, denied) pass
// through untouched; M10's HostSession / GuestSession build on these.
import {
  msg,
  parseGuestMessage,
  parseHostMessage,
  peekHelloProto,
  PROTOCOL_VERSION,
  type GuestMessage,
  type HostMessage,
  type RejectReason,
} from './protocol';
import type { Listener, NetError, Transport } from './transport';

/** Ping interval (§8.5: every 2 s). */
export const PING_MS = 2000;
/** No traffic for this long ⇒ the link is lost (§8.5: 8 s). */
export const SILENCE_MS = 8000;
/** A connection that hasn't said hello by then is dropped. */
export const HELLO_TIMEOUT_MS = 10_000;
/** How long the host keeps seat 1 for a dropped guest's resume token (§8.5), once a match is on. */
export const RESERVE_MS = 120_000;
/** Lets a reject/bye flush before the transport closes. */
export const CLOSE_DELAY_MS = 300;

export interface LinkClock {
  now(): number;
}

const defaultClock: LinkClock = { now: () => performance.now() };

function randomToken(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function closeSoon(t: Transport): void {
  setTimeout(() => t.close(), CLOSE_DELAY_MS);
}

// ---------------------------------------------------------------- host

export interface GuestInfo {
  name: string;
  /** Round-trip time of the last ping, ms (null until measured). */
  rtt: number | null;
  connected: boolean;
}

export type HostLinkEvent =
  /** A guest took seat 1 (resume: same token as the guest that dropped). */
  | { kind: 'join'; name: string; resume: boolean }
  | { kind: 'rtt'; rtt: number }
  /** The guest dropped (closed, or silent for SILENCE_MS). The seat may stay reserved. */
  | { kind: 'left'; why: 'closed' | 'silent' }
  /** Someone was turned away. */
  | { kind: 'rejected'; reason: RejectReason };

export interface HostLinkOptions {
  name: string;
  clock?: LinkClock;
  /** Seat reservation after a drop, ms (0 = free the seat at once: the lobby before a match). */
  reserveMs?: number;
  /** For tests. */
  token?: () => string;
}

interface Seat1 {
  t: Transport | null;
  name: string;
  token: string;
  rtt: number | null;
  lastSeen: number;
  droppedAt: number | null;
}

export class HostLink {
  private readonly clock: LinkClock;
  private readonly token: () => string;
  private readonly cbs = new Set<(e: HostLinkEvent) => void>();
  private readonly msgCbs = new Set<(m: GuestMessage) => void>();
  private readonly pending = new Set<Transport>();
  private readonly offs: (() => void)[] = [];
  private seat: Seat1 | null = null;
  private timer: ReturnType<typeof setInterval>;
  private ended = false;
  private closed = false;
  name: string;
  reserveMs: number;

  constructor(
    private readonly listener: Listener,
    opts: HostLinkOptions,
  ) {
    this.name = opts.name;
    this.clock = opts.clock ?? defaultClock;
    this.reserveMs = opts.reserveMs ?? 0;
    this.token = opts.token ?? randomToken;
    this.offs.push(listener.onConnection((t) => this.accept(t)));
    this.timer = setInterval(() => this.tick(), PING_MS);
  }

  /** The guest in seat 1 (connected, or dropped but reserved), or null. */
  get guest(): GuestInfo | null {
    const s = this.seat;
    return s ? { name: s.name, rtt: s.rtt, connected: s.t !== null } : null;
  }

  get connected(): boolean {
    return this.seat?.t != null;
  }

  on(cb: (e: HostLinkEvent) => void): () => void {
    this.cbs.add(cb);
    return () => this.cbs.delete(cb);
  }

  /** Game messages from the guest (hello, ping and pong are handled here). */
  onMessage(cb: (m: GuestMessage) => void): () => void {
    this.msgCbs.add(cb);
    return () => this.msgCbs.delete(cb);
  }

  /** Sends to the connected guest; dropped if none. */
  send(m: HostMessage): void {
    this.seat?.t?.send(m);
  }

  /** After this, new guests get `reject{ended}` (a finished match nobody can join). */
  setEnded(ended: boolean): void {
    this.ended = ended;
  }

  /** Says bye to the guest and closes the room. */
  close(reason = 'host left'): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    for (const off of this.offs) off();
    const t = this.seat?.t;
    if (t) {
      t.send(msg('bye', { reason }));
    }
    for (const p of this.pending) p.close();
    this.pending.clear();
    this.seat = null;
    const listener = this.listener;
    setTimeout(() => listener.close(), CLOSE_DELAY_MS);
    this.cbs.clear();
    this.msgCbs.clear();
  }

  private emit(e: HostLinkEvent): void {
    for (const cb of [...this.cbs]) cb(e);
  }

  private accept(t: Transport): void {
    if (this.closed) {
      t.close();
      return;
    }
    this.pending.add(t);
    const since = this.clock.now();
    const offMsg = t.onMessage((raw) => this.fromTransport(t, raw));
    const offStatus = t.onStatus((s) => {
      if (s.kind !== 'closed' && s.kind !== 'error') return;
      offMsg();
      offStatus();
      this.pending.delete(t);
      if (this.seat?.t === t) this.drop('closed');
    });
    // Drop connections that never say hello.
    const check = setInterval(() => {
      if (!this.pending.has(t)) clearInterval(check);
      else if (this.clock.now() - since >= HELLO_TIMEOUT_MS || this.closed) {
        clearInterval(check);
        this.pending.delete(t);
        t.close();
      }
    }, 1000);
  }

  private fromTransport(t: Transport, raw: unknown): void {
    if (this.pending.has(t)) {
      this.hello(t, raw);
      return;
    }
    const s = this.seat;
    if (!s || s.t !== t) return;
    const m = parseGuestMessage(raw);
    if (!m) return;
    s.lastSeen = this.clock.now();
    switch (m.t) {
      case 'hello':
        return;
      case 'bye':
        this.drop('closed');
        return;
      case 'ping':
        t.send(msg('pong', { ts: m.ts }));
        return;
      case 'pong': {
        const rtt = Math.max(0, Math.round(this.clock.now() - m.ts));
        s.rtt = rtt;
        this.emit({ kind: 'rtt', rtt });
        return;
      }
      default:
        for (const cb of [...this.msgCbs]) cb(m);
    }
  }

  private hello(t: Transport, raw: unknown): void {
    const proto = peekHelloProto(raw);
    if (proto === null) return; // only hello counts before the handshake
    this.pending.delete(t);
    const reject = (reason: RejectReason): void => {
      t.send(msg('reject', { reason }));
      closeSoon(t);
      this.emit({ kind: 'rejected', reason });
    };
    const m = parseGuestMessage(raw);
    if (proto !== PROTOCOL_VERSION || !m || m.t !== 'hello') return reject('version');
    if (this.ended) return reject('ended');
    const now = this.clock.now();
    const s = this.seat;
    const resume = s !== null && s.t === null && m.resume !== undefined && m.resume === s.token;
    if (s && !resume) {
      const reserved = s.t !== null || (s.droppedAt !== null && now - s.droppedAt < this.reserveMs);
      if (reserved) return reject('full');
    }
    const token = resume && s ? s.token : this.token();
    const name = m.name.trim().slice(0, 32);
    this.seat = { t, name, token, rtt: null, lastSeen: now, droppedAt: null };
    t.send(msg('welcome', { seat: 1, resume: token, proto: PROTOCOL_VERSION, name: this.name }));
    this.emit({ kind: 'join', name, resume });
    this.ping();
  }

  private drop(why: 'closed' | 'silent'): void {
    const s = this.seat;
    if (!s || !s.t) return;
    const t = s.t;
    s.t = null;
    s.rtt = null;
    s.droppedAt = this.clock.now();
    if (this.reserveMs <= 0) this.seat = null;
    if (why === 'silent') t.close();
    this.emit({ kind: 'left', why });
  }

  private ping(): void {
    this.seat?.t?.send(msg('ping', { ts: this.clock.now() }));
  }

  private tick(): void {
    const s = this.seat;
    if (!s) return;
    const now = this.clock.now();
    if (s.t) {
      if (now - s.lastSeen >= SILENCE_MS) this.drop('silent');
      else this.ping();
    } else if (s.droppedAt !== null && now - s.droppedAt >= this.reserveMs) {
      this.seat = null;
    }
  }
}

// ---------------------------------------------------------------- guest

export type GuestLinkStatus =
  /** Opening the transport and waiting for welcome. */
  | { kind: 'connecting' }
  | { kind: 'connected'; rtt: number | null; hostName: string }
  | { kind: 'rejected'; reason: RejectReason }
  /** No traffic for SILENCE_MS, or the transport dropped without a bye. */
  | { kind: 'lost' }
  /** The host said bye. */
  | { kind: 'ended'; reason: string }
  /** Closed locally. */
  | { kind: 'closed' }
  /** The transport failed to open (room not found, network, …). */
  | { kind: 'error'; error: NetError };

export interface GuestLinkOptions {
  name: string;
  /** The resume token from a previous welcome in this room (§8.5). */
  resume?: string;
  clock?: LinkClock;
}

export class GuestLink {
  private readonly clock: LinkClock;
  private readonly cbs = new Set<(s: GuestLinkStatus) => void>();
  private readonly msgCbs = new Set<(m: HostMessage) => void>();
  private readonly offs: (() => void)[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSeen: number;
  private _status: GuestLinkStatus = { kind: 'connecting' };
  /** The token to resume with after a drop (set by welcome). */
  token: string | null;
  hostName = '';
  rtt: number | null = null;

  constructor(
    private readonly t: Transport,
    private readonly opts: GuestLinkOptions,
  ) {
    this.clock = opts.clock ?? defaultClock;
    this.token = opts.resume ?? null;
    this.lastSeen = this.clock.now();
    this.offs.push(
      t.onMessage((raw) => this.receive(raw)),
      t.onStatus((s) => {
        if (s.kind === 'open') this.sayHello();
        else if (s.kind === 'error') this.end(this._status.kind === 'connecting' ? { kind: 'error', error: s.error } : { kind: 'lost' });
        else if (s.kind === 'closed') this.end(s.reason === 'local' ? { kind: 'closed' } : { kind: 'lost' });
      }),
    );
    if (t.state === 'open') this.sayHello();
    else if (t.state === 'closed') queueMicrotask(() => this.end({ kind: 'lost' }));
  }

  get status(): GuestLinkStatus {
    return this._status;
  }

  get connected(): boolean {
    return this._status.kind === 'connected';
  }

  onStatus(cb: (s: GuestLinkStatus) => void): () => void {
    this.cbs.add(cb);
    return () => this.cbs.delete(cb);
  }

  /** Game messages from the host (welcome, reject, ping, pong and bye are handled here). */
  onMessage(cb: (m: HostMessage) => void): () => void {
    this.msgCbs.add(cb);
    return () => this.msgCbs.delete(cb);
  }

  send(m: GuestMessage): void {
    if (this.connected) this.t.send(m);
  }

  /** Says bye (if connected) and closes. */
  close(reason = 'left'): void {
    if (this.connected) this.t.send(msg('bye', { reason }));
    this.end({ kind: 'closed' });
  }

  private set(s: GuestLinkStatus): void {
    this._status = s;
    for (const cb of [...this.cbs]) cb(s);
  }

  private sayHello(): void {
    if (this._status.kind !== 'connecting') return;
    this.lastSeen = this.clock.now();
    this.t.send(msg('hello', { name: this.opts.name, proto: PROTOCOL_VERSION, ...(this.token ? { resume: this.token } : {}) }));
    this.timer ??= setInterval(() => this.tick(), PING_MS);
  }

  private receive(raw: unknown): void {
    const m = parseHostMessage(raw);
    if (!m) return;
    this.lastSeen = this.clock.now();
    const st = this._status.kind;
    if (st !== 'connecting' && st !== 'connected') return;
    switch (m.t) {
      case 'welcome':
        this.token = m.resume;
        this.hostName = m.name ?? '';
        this.set({ kind: 'connected', rtt: this.rtt, hostName: this.hostName });
        this.ping();
        return;
      case 'reject':
        this.end({ kind: 'rejected', reason: m.reason });
        return;
      case 'bye':
        this.end({ kind: 'ended', reason: m.reason });
        return;
      case 'ping':
        this.t.send(msg('pong', { ts: m.ts }));
        return;
      case 'pong':
        this.rtt = Math.max(0, Math.round(this.clock.now() - m.ts));
        if (st === 'connected') this.set({ kind: 'connected', rtt: this.rtt, hostName: this.hostName });
        return;
      default:
        if (st === 'connected') for (const cb of [...this.msgCbs]) cb(m);
    }
  }

  private ping(): void {
    this.t.send(msg('ping', { ts: this.clock.now() }));
  }

  private tick(): void {
    const st = this._status.kind;
    if (st !== 'connecting' && st !== 'connected') return;
    if (this.clock.now() - this.lastSeen >= SILENCE_MS) this.end({ kind: 'lost' });
    else if (st === 'connected') this.ping();
  }

  private end(s: Exclude<GuestLinkStatus, { kind: 'connecting' } | { kind: 'connected' }>): void {
    const st = this._status.kind;
    if (st !== 'connecting' && st !== 'connected') return;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const off of this.offs) off();
    this.set(s);
    if (s.kind === 'rejected' || s.kind === 'ended' || s.kind === 'closed') closeSoon(this.t);
    else this.t.close();
    this.cbs.clear();
    this.msgCbs.clear();
  }
}
