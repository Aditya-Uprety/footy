// Online host session (PLAN §3.3, §8.3, M10.1): HostCore + the HostLink.
//
// The host is the only writer of GameState. Seat 0 plays on this device;
// seat 1's intents arrive over the link and go through the same HostCore
// validation. Every change goes out as a full `state` snapshot; a kick goes
// out as `kick{result (frames as base64), next}` and is never followed by a
// `state` for the same change (each side applies `next` after its playback).
// A guest that (re)joins gets the current state at once.
import { HostCore, type KickEvent } from '../game/host';
import { activeSeat } from '../game/rules';
import { toWireKick } from '../game/serialize';
import type { Settings } from '../game/settings';
import type { GameState, Intent, Seat } from '../game/types';
import type { Denial, Session, SessionAim, SessionKick } from '../app/session';
import type { HostLink } from './link';
import { msg, type GuestMessage } from './protocol';

export interface HostSessionOptions {
  link: HostLink;
  settings: Settings;
  /** [host, guest]. */
  names: [string, string];
  seed: number;
  /** Clock for the HostCore guards, ms (default performance.now). */
  now?: () => number;
  /** How often the guards run, ms (0 = never; default 500). */
  tickMs?: number;
  /** Resume from a saved state (host-refresh recovery). */
  state?: GameState;
}

/** The guest's seat. */
export const GUEST_SEAT: Seat = 1;
export const HOST_SEAT: Seat = 0;

export class HostSession implements Session {
  readonly kind = 'host' as const;
  readonly localSeats: readonly Seat[] = Object.freeze([HOST_SEAT]);
  readonly core: HostCore;
  readonly link: HostLink;
  private readonly deniedCbs = new Set<(d: Denial) => void>();
  private readonly aimCbs = new Set<(a: SessionAim) => void>();
  private readonly offs: (() => void)[] = [];
  private readonly timer: ReturnType<typeof setInterval> | null;
  private readonly now: () => number;
  private disposed = false;

  constructor(opts: HostSessionOptions) {
    this.link = opts.link;
    this.now = opts.now ?? (() => performance.now());
    this.core = new HostCore({
      settings: opts.settings,
      names: opts.names,
      seed: opts.seed,
      now: this.now,
      ...(opts.state ? { state: opts.state } : {}),
    });
    this.offs.push(
      this.core.onState((s) => this.link.send(msg('state', { state: s }))),
      this.core.onKick((k) => this.sendKick(k)),
      this.link.onMessage((m) => this.receive(m)),
      this.link.on((e) => {
        if (e.kind === 'join') this.sendState();
      }),
    );
    const tick = opts.tickMs ?? 500;
    this.timer = tick > 0 ? setInterval(() => this.core.tick(this.now()), tick) : null;
    // The guest is already in the room when the match starts: send it the toss.
    this.sendState();
  }

  get state(): GameState {
    return this.core.state;
  }

  /** Re-sends the current snapshot (join, resume). */
  sendState(): void {
    if (!this.disposed) this.link.send(msg('state', { state: this.core.state }));
  }

  send(seat: Seat, intent: Intent): void {
    if (seat !== HOST_SEAT) return;
    const r = this.core.handle(seat, intent);
    if (r.ok) return;
    const d: Denial = { seat, intentType: intent.type, reason: r.reason, ...(r.violations ? { violations: r.violations } : {}) };
    for (const cb of [...this.deniedCbs]) cb(d);
  }

  randomPick(seat: Seat): Intent | null {
    return seat === HOST_SEAT ? this.core.randomPickFor(seat) : null;
  }

  onState(cb: (s: GameState) => void): () => void {
    return this.core.onState(cb);
  }

  onKick(cb: (k: SessionKick) => void): () => void {
    return this.core.onKick(cb);
  }

  onDenied(cb: (d: Denial) => void): () => void {
    this.deniedCbs.add(cb);
    return () => this.deniedCbs.delete(cb);
  }

  aim(seat: Seat, turnId: number, yaw: number): void {
    const s = this.core.state;
    if (seat !== HOST_SEAT || s.phase !== 'play' || turnId !== s.turnId || activeSeat(s) !== HOST_SEAT || !Number.isFinite(yaw)) return;
    this.core.noteAim(seat, yaw);
    this.link.send(msg('aim', { turnId, yaw }));
  }

  onAim(cb: (a: SessionAim) => void): () => void {
    this.aimCbs.add(cb);
    return () => this.aimCbs.delete(cb);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    for (const off of this.offs) off();
    this.deniedCbs.clear();
    this.aimCbs.clear();
  }

  private sendKick(k: KickEvent): void {
    this.link.send(msg('kick', { result: toWireKick(k.result), next: k.next }));
  }

  private receive(m: GuestMessage): void {
    if (this.disposed) return;
    switch (m.t) {
      case 'intent': {
        const r = this.core.handle(GUEST_SEAT, m.intent);
        if (!r.ok) {
          this.link.send(
            msg('denied', { intentType: m.intent.type, reason: r.reason, ...(r.violations ? { violations: r.violations } : {}) }),
          );
        }
        return;
      }
      case 'aim': {
        const s = this.core.state;
        if (s.phase !== 'play' || m.turnId !== s.turnId || activeSeat(s) !== GUEST_SEAT) return;
        this.core.noteAim(GUEST_SEAT, m.yaw);
        const a: SessionAim = { seat: GUEST_SEAT, turnId: m.turnId, yaw: m.yaw };
        for (const cb of [...this.aimCbs]) cb(a);
        return;
      }
      default:
        return;
    }
  }
}
