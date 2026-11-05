// Online guest session (PLAN §3.3, §8.3, M10.2): renders the host's
// snapshots and sends intents for seat 1, only on its own turns.
//
// `state` messages replace the shown state (older revisions are dropped);
// `kick{result, next}` decodes the frames and hands the result to the views,
// which apply `next` after the playback. Intents that can't be ours right now
// (not our pick / kick / toss, or no connection) are refused locally with a
// reason, the same way the host would refuse them.
import { pickInfo, randomPick } from '../game/draft';
import { activeSeat, teamOfSeat } from '../game/rules';
import { fromWireKick } from '../game/serialize';
import type { GameState, Intent, Seat } from '../game/types';
import { createRng, type Rng } from '../shared/rng';
import type { Denial, Session, SessionAim, SessionKick } from '../app/session';
import type { GuestLink } from './link';
import { msg, type HostMessage } from './protocol';

export const GUEST_SEAT: Seat = 1;
const HOST_SEAT: Seat = 0;

/** Why the guest can't send this intent now, or null if it may. */
export function guestIntentBlock(s: GameState | null, intent: Intent): string | null {
  if (!s) return 'Waiting for the host';
  switch (intent.type) {
    case 'tossChoice':
      return s.phase === 'toss' && s.toss.winner === GUEST_SEAT ? null : 'Not your choice';
    case 'place':
      return s.phase === 'placement' && activeSeat(s) === GUEST_SEAT && intent.pick === s.pick ? null : 'Not your pick';
    case 'kick':
      return s.phase === 'play' && activeSeat(s) === GUEST_SEAT && intent.turnId === s.turnId ? null : 'Not your kick';
    case 'rematch':
      return s.phase === 'fulltime' ? null : 'The match is not over';
    default:
      return 'Unknown intent';
  }
}

export interface GuestSessionOptions {
  /** Seed for local random picks (?autoplace, placement timer). */
  seed?: number;
}

export class GuestSession implements Session {
  readonly kind = 'guest' as const;
  readonly localSeats: readonly Seat[] = Object.freeze([GUEST_SEAT]);
  private _link: GuestLink;
  private s: GameState | null = null;
  private readonly rng: Rng;
  private readonly stateCbs = new Set<(s: GameState) => void>();
  private readonly kickCbs = new Set<(k: SessionKick) => void>();
  private readonly deniedCbs = new Set<(d: Denial) => void>();
  private readonly aimCbs = new Set<(a: SessionAim) => void>();
  private off: () => void;
  private disposed = false;

  constructor(link: GuestLink, opts: GuestSessionOptions = {}) {
    this._link = link;
    this.rng = createRng(opts.seed ?? Math.floor(Math.random() * 0x7fffffff));
    this.off = link.onMessage((m) => this.receive(m));
  }

  get link(): GuestLink {
    return this._link;
  }

  /** Continues on a new link after a reconnect (the host re-sends the state on resume). */
  attach(link: GuestLink): void {
    if (this.disposed || link === this._link) return;
    this.off();
    this._link = link;
    this.off = link.onMessage((m) => this.receive(m));
  }

  /** True once the first snapshot has arrived. */
  get ready(): boolean {
    return this.s !== null;
  }

  get state(): GameState {
    if (!this.s) throw new Error('GuestSession: no state yet');
    return this.s;
  }

  send(seat: Seat, intent: Intent): void {
    if (seat !== GUEST_SEAT) return;
    const block = this.link.connected ? guestIntentBlock(this.s, intent) : 'Not connected to the host';
    if (block) {
      this.deny({ seat, intentType: intent.type, reason: block });
      return;
    }
    this.link.send(msg('intent', { intent }));
  }

  randomPick(seat: Seat): Intent | null {
    const s = this.s;
    if (seat !== GUEST_SEAT || !s || s.phase !== 'placement') return null;
    const info = pickInfo(s.pick);
    if (!info || teamOfSeat(s, seat) !== info.team) return null;
    return { type: 'place', pick: s.pick, spots: randomPick(s, info.team, this.rng) };
  }

  onState(cb: (s: GameState) => void): () => void {
    this.stateCbs.add(cb);
    return () => this.stateCbs.delete(cb);
  }

  onKick(cb: (k: SessionKick) => void): () => void {
    this.kickCbs.add(cb);
    return () => this.kickCbs.delete(cb);
  }

  onDenied(cb: (d: Denial) => void): () => void {
    this.deniedCbs.add(cb);
    return () => this.deniedCbs.delete(cb);
  }

  aim(seat: Seat, turnId: number, yaw: number): void {
    const s = this.s;
    if (seat !== GUEST_SEAT || !s || s.phase !== 'play' || s.turnId !== turnId || activeSeat(s) !== GUEST_SEAT) return;
    if (Number.isFinite(yaw)) this.link.send(msg('aim', { turnId, yaw }));
  }

  onAim(cb: (a: SessionAim) => void): () => void {
    this.aimCbs.add(cb);
    return () => this.aimCbs.delete(cb);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.off();
    this.stateCbs.clear();
    this.kickCbs.clear();
    this.deniedCbs.clear();
    this.aimCbs.clear();
  }

  private deny(d: Denial): void {
    for (const cb of [...this.deniedCbs]) cb(d);
  }

  private receive(m: HostMessage): void {
    if (this.disposed) return;
    switch (m.t) {
      case 'state': {
        if (this.s && m.state.rev <= this.s.rev) return;
        this.s = m.state;
        for (const cb of [...this.stateCbs]) cb(m.state);
        return;
      }
      case 'kick': {
        const prev = this.s;
        if (!prev || m.next.rev <= prev.rev) return;
        let result;
        try {
          result = fromWireKick(m.result);
        } catch {
          // Undecodable frames: skip the playback, show the outcome.
          this.s = m.next;
          for (const cb of [...this.stateCbs]) cb(m.next);
          return;
        }
        this.s = m.next;
        const k: SessionKick = { result, next: m.next, seat: activeSeat(prev) ?? HOST_SEAT, auto: false };
        for (const cb of [...this.kickCbs]) cb(k);
        return;
      }
      case 'aim': {
        const s = this.s;
        if (!s || s.phase !== 'play' || m.turnId !== s.turnId || activeSeat(s) !== HOST_SEAT) return;
        const a: SessionAim = { seat: HOST_SEAT, turnId: m.turnId, yaw: m.yaw };
        for (const cb of [...this.aimCbs]) cb(a);
        return;
      }
      case 'denied':
        this.deny({
          seat: GUEST_SEAT,
          intentType: m.intentType,
          reason: m.reason,
          ...(m.violations ? { violations: m.violations } : {}),
        });
        return;
      default:
        return;
    }
  }
}
