// PeerJS transport, room codes, ICE config, error mapping (PLAN §8.1, M9.2).
//
// The host registers the peer id `footy-v1-<CODE>` on the PeerJS signaling
// server (the free cloud one, or VITE_PEER_* for a self-hosted PeerServer) and
// accepts DataConnections; the guest gets a random id and connects to it.
// PeerJS is loaded lazily, so hot-seat and practice never download it.
import type { DataConnection, Peer, PeerOptions } from 'peerjs';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../app/router';
import { BaseTransport, netErrorText, type Listener, type NetError, type NetErrorCode, type Transport } from './transport';

export const PEER_ID_PREFIX = 'footy-v1-';

/** Guest: give up if the data channel isn't open after this long. */
export const CONNECT_TIMEOUT_MS = 20_000;
/** Host: how many fresh codes to try when one is taken. */
export const MAX_CODE_TRIES = 6;

export function peerIdForCode(code: string): string {
  return `${PEER_ID_PREFIX}${code}`;
}

/** A random 5-character room code from the §8.1 alphabet. */
export function randomRoomCode(random: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) s += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)];
  return s;
}

/** Maps a PeerJS error type (PeerErrorType) to what the lobby shows. */
export function mapPeerError(type: string | undefined): NetErrorCode {
  switch (type) {
    case 'peer-unavailable':
      return 'room-not-found';
    case 'unavailable-id':
      return 'code-taken';
    case 'browser-incompatible':
      return 'browser';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
    case 'ssl-unavailable':
    case 'disconnected':
    case 'webrtc':
    case 'negotiation-failed':
    case 'connection-closed':
      return 'network';
    default:
      return 'unknown';
  }
}

/** A NetError; the raw PeerJS detail is appended only where the plain text is vague. */
export function netError(code: NetErrorCode, detail?: string): NetError {
  const vague = code === 'network' || code === 'unknown';
  return { code, message: detail && vague ? `${netErrorText(code)} (${detail})` : netErrorText(code) };
}

/** The env vars read by `peerOptions` (Vite exposes VITE_* on import.meta.env). */
export interface PeerEnv {
  VITE_TURN_URLS?: string;
  VITE_TURN_USERNAME?: string;
  VITE_TURN_CREDENTIAL?: string;
  VITE_PEER_HOST?: string;
  VITE_PEER_PORT?: string;
  VITE_PEER_PATH?: string;
  VITE_PEER_SECURE?: string;
}

/** Two public STUN servers, plus an optional TURN server from env (§8.1). */
export function iceServers(env: PeerEnv): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
  const turn = (env.VITE_TURN_URLS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (turn.length > 0) {
    servers.push({
      urls: turn,
      ...(env.VITE_TURN_USERNAME ? { username: env.VITE_TURN_USERNAME } : {}),
      ...(env.VITE_TURN_CREDENTIAL ? { credential: env.VITE_TURN_CREDENTIAL } : {}),
    });
  }
  return servers;
}

/** PeerJS options: ICE servers, and a self-hosted PeerServer if VITE_PEER_HOST is set. */
export function peerOptions(env: PeerEnv): Partial<PeerOptions> {
  const opts: Partial<PeerOptions> = { config: { iceServers: iceServers(env) }, debug: 0 }; // errors reach the UI through our own mapping; PeerJS would also log expected ones (room not found while retrying)
  if (env.VITE_PEER_HOST) {
    opts.host = env.VITE_PEER_HOST;
    const port = Number(env.VITE_PEER_PORT);
    if (Number.isFinite(port) && port > 0) opts.port = port;
    if (env.VITE_PEER_PATH) opts.path = env.VITE_PEER_PATH;
    if (env.VITE_PEER_SECURE !== undefined) opts.secure = env.VITE_PEER_SECURE !== 'false' && env.VITE_PEER_SECURE !== '0';
  }
  return opts;
}

function envOptions(): Partial<PeerOptions> {
  return peerOptions(import.meta.env as PeerEnv);
}

type PeerCtor = typeof Peer;
let peerCtor: Promise<PeerCtor> | null = null;

function loadPeer(): Promise<PeerCtor> {
  if (!peerCtor) {
    peerCtor = import('peerjs').then((m) => m.Peer);
    peerCtor.catch(() => (peerCtor = null));
  }
  return peerCtor;
}

function errType(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'type' in err ? String((err as { type: unknown }).type) : undefined;
}

// ---------------------------------------------------------------- transport

/** One DataConnection as a Transport. */
export class PeerTransport extends BaseTransport {
  private conn: DataConnection | null = null;
  /** Runs when this transport ends (the guest destroys its own Peer). */
  private cleanup: (() => void) | null = null;

  constructor(conn: DataConnection | null = null, cleanup: (() => void) | null = null) {
    super(conn?.open ? 'open' : 'connecting');
    this.cleanup = cleanup;
    if (conn) this.attach(conn);
  }

  /** @internal */
  attach(conn: DataConnection): void {
    this.conn = conn;
    conn.on('open', () => this.setStatus({ kind: 'open' }));
    conn.on('data', (d) => this.deliver(d));
    conn.on('close', () => this.end({ kind: 'closed', reason: 'remote' }));
    conn.on('error', (e) => this.end({ kind: 'error', error: netError(mapPeerError(errType(e)), errType(e)) }));
    if (conn.open) this.setStatus({ kind: 'open' });
  }

  send(msg: unknown): void {
    if (this.state !== 'open' || !this.conn) return;
    // The DataConnection went away before its 'close' event reached us: PeerJS
    // would only log an error, so end the transport here instead.
    if (!this.conn.open) {
      this.end({ kind: 'closed', reason: 'remote' });
      return;
    }
    try {
      void this.conn.send(msg);
    } catch (e) {
      this.end({ kind: 'error', error: netError('network', String(e)) });
    }
  }

  close(): void {
    this.end({ kind: 'closed', reason: 'local' });
  }

  /** @internal */
  fail(error: NetError): void {
    this.end({ kind: 'error', error });
  }

  private end(s: { kind: 'closed'; reason?: string } | { kind: 'error'; error: NetError }): void {
    if (this.final) return;
    this.setStatus(s);
    const c = this.conn;
    this.conn = null;
    try {
      // flush sends a close message, which PeerJS logs as an error on a dead connection.
      if (c?.open) c.close({ flush: true });
      else c?.close();
    } catch {
      /* already gone */
    }
    const fn = this.cleanup;
    this.cleanup = null;
    fn?.();
  }
}

// ---------------------------------------------------------------- guest

/**
 * Connects to the room `code`. Returns at once in 'connecting'; it moves to
 * 'open', or to 'error' with room-not-found / network / browser / timeout.
 */
export function connectPeerGuest(code: string, opts: { timeoutMs?: number } = {}): Transport {
  let peer: Peer | null = null;
  const t = new PeerTransport(null, () => {
    clearTimeout(timer);
    // Let the close reach the other side before tearing down signaling.
    const p = peer;
    peer = null;
    setTimeout(() => p?.destroy(), 200);
  });
  const timer = setTimeout(() => t.fail(netError('timeout')), opts.timeoutMs ?? CONNECT_TIMEOUT_MS);
  loadPeer()
    .then((PeerClass) => {
      if (t.state !== 'connecting') return;
      peer = new PeerClass(envOptions());
      peer.on('open', () => {
        if (!peer || t.state !== 'connecting') return;
        t.attach(peer.connect(peerIdForCode(code), { reliable: true, serialization: 'json' }));
      });
      peer.on('error', (e) => {
        // After the channel is open, signaling hiccups don't matter.
        if (t.state === 'connecting') t.fail(netError(mapPeerError(errType(e)), errType(e)));
      });
      peer.on('disconnected', () => {
        if (t.state === 'connecting') peer?.reconnect();
      });
    })
    .catch((e) => t.fail(netError('network', `could not load PeerJS: ${String(e)}`)));
  t.onStatus((s) => {
    if (s.kind !== 'connecting') clearTimeout(timer);
  });
  return t;
}

// ---------------------------------------------------------------- host

export type PeerHostStatus =
  | { kind: 'ready'; code: string }
  /** Lost the signaling server; open data connections keep working (§8.5). */
  | { kind: 'reconnecting' }
  | { kind: 'error'; error: NetError };

export interface PeerHost extends Listener {
  readonly code: string;
  onStatus(cb: (s: PeerHostStatus) => void): () => void;
}

/**
 * Registers a room and resolves once the signaling server has accepted its id.
 * A taken code is replaced by a fresh one (up to MAX_CODE_TRIES). Rejects with
 * a NetError.
 */
export async function createPeerHost(opts: { code?: string; random?: () => number } = {}): Promise<PeerHost> {
  const PeerClass = await loadPeer().catch((e) => {
    throw netError('network', `could not load PeerJS: ${String(e)}`);
  });
  let lastErr: NetError = netError('code-taken');
  for (let i = 0; i < MAX_CODE_TRIES; i++) {
    const code = i === 0 && opts.code ? opts.code : randomRoomCode(opts.random);
    const peer = await openPeer(PeerClass, peerIdForCode(code)).catch((e: NetError) => {
      lastErr = e;
      return null;
    });
    if (peer) return new PeerHostImpl(peer, code);
    if (lastErr.code !== 'code-taken') throw lastErr;
  }
  throw lastErr;
}

function openPeer(PeerClass: PeerCtor, id: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peer = new PeerClass(id, envOptions());
    const timer = setTimeout(() => {
      peer.destroy();
      reject(netError('timeout'));
    }, CONNECT_TIMEOUT_MS);
    peer.once('open', () => {
      clearTimeout(timer);
      resolve(peer);
    });
    peer.once('error', (e) => {
      clearTimeout(timer);
      peer.destroy();
      reject(netError(mapPeerError(errType(e)), errType(e)));
    });
  });
}

class PeerHostImpl implements PeerHost {
  private readonly connCbs = new Set<(t: Transport) => void>();
  private readonly statusCbs = new Set<(s: PeerHostStatus) => void>();
  private readonly transports = new Set<PeerTransport>();
  private closed = false;

  constructor(
    private readonly peer: Peer,
    readonly code: string,
  ) {
    peer.on('connection', (conn) => {
      if (this.closed) {
        conn.close();
        return;
      }
      const t = new PeerTransport(conn);
      this.transports.add(t);
      t.onStatus((s) => {
        if (s.kind === 'closed' || s.kind === 'error') this.transports.delete(t);
      });
      for (const cb of [...this.connCbs]) cb(t);
    });
    peer.on('disconnected', () => {
      if (this.closed) return;
      this.emit({ kind: 'reconnecting' });
      setTimeout(() => {
        if (!this.closed && peer.disconnected && !peer.destroyed) peer.reconnect();
      }, 1000);
    });
    peer.on('open', () => {
      if (!this.closed) this.emit({ kind: 'ready', code });
    });
    peer.on('error', (e) => {
      if (this.closed) return;
      const type = errType(e);
      // Signaling trouble while disconnected: keep retrying, the 'disconnected' handler does that.
      if (peer.disconnected && mapPeerError(type) === 'network') {
        setTimeout(() => {
          if (!this.closed && peer.disconnected && !peer.destroyed) peer.reconnect();
        }, 3000);
        return;
      }
      // Errors about one guest's connection (e.g. negotiation) don't end the room.
      if (type === 'peer-unavailable' || type === 'webrtc') return;
      this.emit({ kind: 'error', error: netError(mapPeerError(type), type) });
    });
  }

  onConnection(cb: (t: Transport) => void): () => void {
    this.connCbs.add(cb);
    return () => this.connCbs.delete(cb);
  }

  onStatus(cb: (s: PeerHostStatus) => void): () => void {
    this.statusCbs.add(cb);
    return () => this.statusCbs.delete(cb);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const t of this.transports) t.close();
    this.transports.clear();
    const peer = this.peer;
    setTimeout(() => peer.destroy(), 200);
  }

  private emit(s: PeerHostStatus): void {
    for (const cb of [...this.statusCbs]) cb(s);
  }
}
