// Session interface + LocalSession (PLAN §3.2, §3.3, M7.5).
//
// A Session is what the mode views talk to: the current GameState, the seats
// this device controls, a way to send intents, and callbacks for new states,
// kicks and refusals. LocalSession (hot-seat) runs HostCore in the page with
// both seats local; HostSession / GuestSession (M10) put a transport between.
import { HostCore, type KickEvent } from '../game/host';
import type { Settings } from '../game/settings';
import type { GameState, Intent, IntentType, Seat, Violation } from '../game/types';

/** An intent the host refused, with the reason (and placement violations) to show. */
export interface Denial {
  seat: Seat;
  intentType: IntentType;
  reason: string;
  violations?: Violation[];
}

export type SessionKick = Pick<KickEvent, 'result' | 'next' | 'seat' | 'auto'>;

export interface Session {
  readonly kind: 'local' | 'host' | 'guest';
  /** The latest authoritative state (after a kick this is already `next`; views hold it until playback ends). */
  readonly state: GameState;
  /** Seats this device plays: both in hot-seat, one online. */
  readonly localSeats: readonly Seat[];
  /** Sends an intent for a local seat. Outcomes arrive through onState / onKick / onDenied. */
  send(seat: Seat, intent: Intent): void;
  /** Random legal spots for the current pick of a local seat (?autoplace, placement timer), or null. */
  randomPick(seat: Seat): Intent | null;
  onState(cb: (s: GameState) => void): () => void;
  onKick(cb: (k: SessionKick) => void): () => void;
  onDenied(cb: (d: Denial) => void): () => void;
  dispose(): void;
}

export interface LocalSessionOptions {
  settings: Settings;
  names: [string, string];
  seed: number;
  /** Clock for the HostCore guards, ms (default performance.now). */
  now?: () => number;
  /** How often the guards run, ms (0 = never; default 500). */
  tickMs?: number;
}

/** Hot-seat: HostCore in the page, both seats local. */
export class LocalSession implements Session {
  readonly kind = 'local' as const;
  readonly localSeats: readonly Seat[] = Object.freeze([0, 1] as Seat[]);
  readonly core: HostCore;
  private readonly deniedCbs = new Set<(d: Denial) => void>();
  private readonly timer: ReturnType<typeof setInterval> | null;
  private readonly now: () => number;

  constructor(opts: LocalSessionOptions) {
    this.now = opts.now ?? (() => performance.now());
    this.core = new HostCore({ settings: opts.settings, names: opts.names, seed: opts.seed, now: this.now });
    const tick = opts.tickMs ?? 500;
    this.timer = tick > 0 ? setInterval(() => this.core.tick(this.now()), tick) : null;
  }

  get state(): GameState {
    return this.core.state;
  }

  send(seat: Seat, intent: Intent): void {
    const r = this.core.handle(seat, intent);
    if (r.ok) return;
    const d: Denial = { seat, intentType: intent.type, reason: r.reason, ...(r.violations ? { violations: r.violations } : {}) };
    for (const cb of this.deniedCbs) cb(d);
  }

  randomPick(seat: Seat): Intent | null {
    return this.core.randomPickFor(seat);
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

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.deniedCbs.clear();
  }
}
