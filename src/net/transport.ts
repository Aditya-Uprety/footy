// Transport interface + LoopbackTransport (PLAN §8.1).
//
// A Transport is one reliable, ordered message pipe between host and guest.
// Game and session code only see this interface, so PeerJS (net/peer.ts), the
// in-memory loopback used by tests, or a later WebSocket relay are swappable.
// Messages are plain JSON values; receivers validate them (net/protocol.ts).

export type NetErrorCode =
  /** The guest's room code has no host behind it. */
  | 'room-not-found'
  /** The host's room code is in use (the host picks another). */
  | 'code-taken'
  /** Signaling server or ICE trouble: no route to the other side. */
  | 'network'
  /** The browser lacks WebRTC. */
  | 'browser'
  /** Connecting took too long. */
  | 'timeout'
  | 'unknown';

export interface NetError {
  code: NetErrorCode;
  message: string;
}

export type TransportStatus =
  | { kind: 'connecting' }
  | { kind: 'open' }
  /** Closed by either side (or the link dropped). Final. */
  | { kind: 'closed'; reason?: string }
  /** Failed to open, or failed while open. Final. */
  | { kind: 'error'; error: NetError };

export type TransportState = TransportStatus['kind'];

export interface Transport {
  readonly state: TransportState;
  /** Sends a JSON value. Dropped silently unless the transport is open. */
  send(msg: unknown): void;
  onMessage(cb: (msg: unknown) => void): () => void;
  onStatus(cb: (s: TransportStatus) => void): () => void;
  close(): void;
}

/** The host's side of a room: hands out one Transport per incoming guest. */
export interface Listener {
  onConnection(cb: (t: Transport) => void): () => void;
  close(): void;
}

/** Readable texts for the lobby (PLAN M9.2). */
export function netErrorText(code: NetErrorCode): string {
  switch (code) {
    case 'room-not-found':
      return 'Room not found. Check the code, or ask the host for a new link.';
    case 'code-taken':
      return 'That room code is already in use.';
    case 'network':
      return 'Network problem: could not reach the other player or the connection server. Check your connection and try again.';
    case 'browser':
      return 'This browser does not support WebRTC peer connections. Try a recent Chrome, Firefox, Edge or Safari.';
    case 'timeout':
      return 'Connecting took too long. Try again; if it keeps failing, one of the networks may block peer-to-peer connections.';
    default:
      return 'Something went wrong with the connection.';
  }
}

/** Shared listener/status plumbing for Transport implementations. */
export abstract class BaseTransport implements Transport {
  private readonly msgCbs = new Set<(msg: unknown) => void>();
  private readonly statusCbs = new Set<(s: TransportStatus) => void>();
  private _state: TransportState;

  protected constructor(initial: TransportState) {
    this._state = initial;
  }

  get state(): TransportState {
    return this._state;
  }

  abstract send(msg: unknown): void;
  abstract close(): void;

  onMessage(cb: (msg: unknown) => void): () => void {
    this.msgCbs.add(cb);
    return () => this.msgCbs.delete(cb);
  }

  onStatus(cb: (s: TransportStatus) => void): () => void {
    this.statusCbs.add(cb);
    return () => this.statusCbs.delete(cb);
  }

  protected get final(): boolean {
    return this._state === 'closed' || this._state === 'error';
  }

  /** Moves to a new status; ignored once closed or errored. */
  protected setStatus(s: TransportStatus): void {
    if (this.final || s.kind === this._state) return;
    this._state = s.kind;
    for (const cb of [...this.statusCbs]) cb(s);
    if (this.final) this.msgCbs.clear();
  }

  protected deliver(msg: unknown): void {
    if (this._state !== 'open') return;
    for (const cb of [...this.msgCbs]) cb(msg);
  }
}

// ---------------------------------------------------------------- loopback

export interface LoopbackOptions {
  /** One-way delay in ms (0 = next microtask). */
  latencyMs?: number;
}

/**
 * One end of an in-memory pair. Messages go through a JSON round trip (like
 * PeerJS 'json' serialization) and arrive asynchronously, in order.
 */
export class LoopbackTransport extends BaseTransport {
  peer: LoopbackTransport | null = null;
  private severed = false;

  constructor(
    initial: TransportState,
    private readonly latencyMs: number,
  ) {
    super(initial);
  }

  send(msg: unknown): void {
    if (this.state !== 'open' || this.severed) return;
    const peer = this.peer;
    if (!peer) return;
    const wire = JSON.stringify(msg);
    later(this.latencyMs, () => {
      if (!this.severed && !peer.severed) peer.deliver(JSON.parse(wire));
    });
  }

  close(): void {
    if (this.final) return;
    this.setStatus({ kind: 'closed', reason: 'local' });
    const peer = this.peer;
    if (peer && !this.severed) later(this.latencyMs, () => peer.remoteClosed());
  }

  /** Test helper: the link goes silent in both directions without any close event (cable pulled). */
  sever(): void {
    this.severed = true;
    if (this.peer) this.peer.severed = true;
  }

  /** @internal */
  open(): void {
    this.setStatus({ kind: 'open' });
  }

  /** @internal */
  fail(error: NetError): void {
    this.setStatus({ kind: 'error', error });
  }

  private remoteClosed(): void {
    this.setStatus({ kind: 'closed', reason: 'remote' });
  }
}

function later(ms: number, fn: () => void): void {
  if (ms > 0) setTimeout(fn, ms);
  else queueMicrotask(fn);
}

/** Two connected, already-open ends. */
export function createLoopbackPair(opts: LoopbackOptions = {}): [LoopbackTransport, LoopbackTransport] {
  const ms = opts.latencyMs ?? 0;
  const a = new LoopbackTransport('open', ms);
  const b = new LoopbackTransport('open', ms);
  a.peer = b;
  b.peer = a;
  return [a, b];
}

/**
 * An in-memory "signaling server": hosts listen on a room code, guests connect
 * to it. Mirrors the PeerJS flow (async open, room-not-found, code-taken) so
 * the handshake can be tested without a network.
 */
export class LoopbackHub {
  private readonly rooms = new Map<string, LoopbackListener>();

  constructor(private readonly opts: LoopbackOptions = {}) {}

  /** Throws a NetError-shaped error with code 'code-taken' if the code is in use. */
  listen(code: string): Listener {
    if (this.rooms.has(code)) throw Object.assign(new Error('code taken'), { code: 'code-taken' as const });
    const l = new LoopbackListener(() => this.rooms.delete(code));
    this.rooms.set(code, l);
    return l;
  }

  connect(code: string): LoopbackTransport {
    const ms = this.opts.latencyMs ?? 0;
    const guest = new LoopbackTransport('connecting', ms);
    later(ms, () => {
      const room = this.rooms.get(code);
      if (!room) {
        guest.fail({ code: 'room-not-found', message: netErrorText('room-not-found') });
        return;
      }
      const host = new LoopbackTransport('open', ms);
      host.peer = guest;
      guest.peer = host;
      room.accept(host);
      guest.open();
    });
    return guest;
  }
}

class LoopbackListener implements Listener {
  private readonly cbs = new Set<(t: Transport) => void>();
  private readonly conns = new Set<LoopbackTransport>();
  private closed = false;

  constructor(private readonly onClose: () => void) {}

  onConnection(cb: (t: Transport) => void): () => void {
    this.cbs.add(cb);
    return () => this.cbs.delete(cb);
  }

  accept(t: LoopbackTransport): void {
    if (this.closed) return;
    this.conns.add(t);
    for (const cb of [...this.cbs]) cb(t);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const c of this.conns) c.close();
    this.onClose();
  }
}
