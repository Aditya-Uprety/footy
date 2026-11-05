// PURE. HostCore: the only writer of GameState (PLAN §3.4, §7, §8.4, §8.6).
// Hot-seat (LocalSession) and the online host (HostSession) both wrap it.
//
// - handle(seat, intent) validates the seat, phase, turnId/pick, numbers and
//   spot legality, then applies the rules. Refusals carry a reason (and the
//   placement violations) for the UI.
// - onState(cb) fires after every change EXCEPT kicks; onKick(cb) fires with
//   { result, next } after a kick. Clients play the result back and apply
//   `next` when the playback ends (§8.4), so a kick never fires onState.
// - Time is injected: `now()` stamps when a turn starts, `tick(nowMs)` runs
//   the guards. Shot guard: no kick within shotTimer + the previous playback
//   duration + 15 s → auto-kick with the last streamed yaw and neutral
//   sliders. Placement guard (placement timer on): placementTimer + 15 s →
//   a random legal pick. With a timer off its guard is off.

import { createRng, type Rng } from '../shared/rng';
import { derivePitch } from '../shared/pitch';
import type { KickResult } from '../sim/types';
import { pickInfo, randomPick } from './draft';
import { activeSeat, applyPick, chooseRole, kick, kickOrigin, newMatch, RuleError, teamOfSeat, voteRematch } from './rules';
import type { Settings } from './settings';
import type { GameState, Intent, KickInput, Seat, Violation } from './types';

/** Extra time the host allows past a client timer before it acts itself, ms (§8.4). */
export const GUARD_GRACE_MS = 15_000;
/** Neutral sliders for a guard auto-kick (§8.4). */
export const GUARD_SLIDERS: Readonly<Omit<KickInput, 'yaw'>> = Object.freeze({ power: 0.5, curve: 0, loft: 0 });

export type HandleResult = { ok: true } | { ok: false; reason: string; violations?: Violation[] };

export interface KickEvent {
  result: KickResult;
  next: GameState;
  /** The kicking seat. */
  seat: Seat;
  /** Auto-kick: the client's shot timer ran out (intent auto) or the host guard fired. */
  auto: boolean;
  /** True only when the host guard kicked. */
  guard: boolean;
}

export interface HostCoreOptions {
  settings: Settings;
  names: [string, string];
  /** RNG seed (toss, rematch tosses, guard placements). */
  seed: number;
  /** Injected clock, ms. Defaults to a clock that never advances (guards then fire only via tick). */
  now?: () => number;
  /** Resume from a saved state instead of starting a new match. */
  state?: GameState;
}

type Listener<T> = (v: T) => void;

/** Yaw from the current kicker toward the middle of the goal its team attacks. */
export function defaultYaw(s: GameState): number {
  if (!s.possession) return 0;
  const o = kickOrigin(s, s.possession);
  const gx = (s.possession.team === 0 ? 1 : -1) * derivePitch(s.settings).halfLength;
  return Math.atan2(0 - o.z, gx - o.x);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export class HostCore {
  private s: GameState;
  private readonly rng: Rng;
  private readonly now: () => number;
  private readonly stateCbs = new Set<Listener<GameState>>();
  private readonly kickCbs = new Set<Listener<KickEvent>>();
  /** When the current turn/pick started on the host, and the extra allowance (previous playback). */
  private turnStart = 0;
  private extraMs = 0;
  /** Last streamed aim yaw for the current turn. */
  private aim: { turnId: number; yaw: number } | null = null;

  constructor(opts: HostCoreOptions) {
    this.rng = createRng(opts.seed);
    this.now = opts.now ?? (() => 0);
    this.s = opts.state ?? newMatch(opts.settings, opts.names, this.rng);
    this.turnStart = this.now();
  }

  get state(): GameState {
    return this.s;
  }

  onState(cb: Listener<GameState>): () => void {
    this.stateCbs.add(cb);
    return () => this.stateCbs.delete(cb);
  }

  onKick(cb: Listener<KickEvent>): () => void {
    this.kickCbs.add(cb);
    return () => this.kickCbs.delete(cb);
  }

  /** Validates and applies an intent from `seat` (§8.6). */
  handle(seat: Seat, intent: Intent): HandleResult {
    if (seat !== 0 && seat !== 1) return { ok: false, reason: 'Unknown seat' };
    if (!isObj(intent) || typeof intent.type !== 'string') return { ok: false, reason: 'Malformed intent' };
    try {
      switch (intent.type) {
        case 'tossChoice':
          if (intent.role !== 'A' && intent.role !== 'B') return { ok: false, reason: 'Unknown role' };
          this.commit(chooseRole(this.s, seat, intent.role));
          return { ok: true };
        case 'place':
          return this.place(seat, intent);
        case 'kick':
          return this.kickIntent(seat, intent);
        case 'rematch':
          this.commit(voteRematch(this.s, seat, this.rng));
          return { ok: true };
        default:
          return { ok: false, reason: 'Unknown intent' };
      }
    } catch (e) {
      if (e instanceof RuleError) return { ok: false, reason: e.reason, ...(e.violations ? { violations: e.violations } : {}) };
      throw e;
    }
  }

  /** The kicking seat's streamed aim (≤ 10 Hz); used by the guard auto-kick. Ignored from the other seat. */
  noteAim(seat: Seat, yaw: number): void {
    if (this.s.phase !== 'play' || !finite(yaw) || activeSeat(this.s) !== seat) return;
    this.aim = { turnId: this.s.turnId, yaw };
  }

  /** When the guard fires for the current turn or pick (host clock, ms), or null when no guard applies. */
  deadline(): number | null {
    const st = this.s.settings;
    if (this.s.phase === 'play' && st.shotTimerSec > 0) return this.turnStart + st.shotTimerSec * 1000 + this.extraMs + GUARD_GRACE_MS;
    if (this.s.phase === 'placement' && st.placementTimerSec > 0) return this.turnStart + st.placementTimerSec * 1000 + GUARD_GRACE_MS;
    return null;
  }

  /** Runs the guards at host time `nowMs`. Returns true if the guard acted. */
  tick(nowMs: number): boolean {
    const d = this.deadline();
    if (d === null || nowMs < d) return false;
    const seat = activeSeat(this.s);
    if (seat === null) return false;
    if (this.s.phase === 'play') {
      const yaw = this.aim && this.aim.turnId === this.s.turnId ? this.aim.yaw : defaultYaw(this.s);
      this.doKick(seat, { yaw, ...GUARD_SLIDERS }, true, true);
      return true;
    }
    const team = pickInfo(this.s.pick)!.team;
    this.commit(applyPick(this.s, team, randomPick(this.s, team, this.rng)));
    return true;
  }

  /** Random legal spots for the current pick (for ?autoplace and the client placement timer). */
  randomPickFor(seat: Seat): Intent | null {
    const info = pickInfo(this.s.pick);
    if (this.s.phase !== 'placement' || !info || teamOfSeat(this.s, seat) !== info.team) return null;
    return { type: 'place', pick: this.s.pick, spots: randomPick(this.s, info.team, this.rng) };
  }

  private place(seat: Seat, intent: Extract<Intent, { type: 'place' }>): HandleResult {
    if (this.s.phase !== 'placement') return { ok: false, reason: 'Not in the placement phase' };
    if (intent.pick !== this.s.pick) return { ok: false, reason: 'Stale pick' };
    const team = teamOfSeat(this.s, seat);
    if (team === null || pickInfo(this.s.pick)?.team !== team) return { ok: false, reason: 'Not your pick' };
    if (!Array.isArray(intent.spots) || intent.spots.some((p) => !isObj(p) || !finite(p.x) || !finite(p.z) || typeof p.gk !== 'boolean')) {
      return { ok: false, reason: 'Malformed spots' };
    }
    const spots = intent.spots.map((p) => ({ x: p.x, z: p.z, gk: p.gk }));
    this.commit(applyPick(this.s, team, spots));
    return { ok: true };
  }

  private kickIntent(seat: Seat, intent: Extract<Intent, { type: 'kick' }>): HandleResult {
    if (this.s.phase !== 'play' || !this.s.possession) return { ok: false, reason: 'Not in play' };
    if (intent.turnId !== this.s.turnId) return { ok: false, reason: 'Stale turn' };
    if (activeSeat(this.s) !== seat) return { ok: false, reason: 'Not your kick' };
    const i = intent.input;
    if (!isObj(i) || !finite(i.yaw) || !finite(i.power) || !finite(i.curve) || !finite(i.loft)) {
      return { ok: false, reason: 'Malformed kick input' };
    }
    // Ranges are clamped (and restart caps applied) by the kick model.
    this.doKick(seat, { yaw: i.yaw, power: i.power, curve: i.curve, loft: i.loft }, intent.auto === true, false);
    return { ok: true };
  }

  private doKick(seat: Seat, input: KickInput, auto: boolean, guard: boolean): void {
    const team = teamOfSeat(this.s, seat)!;
    const { result, next } = kick(this.s, team, input);
    this.s = next;
    this.aim = null;
    this.turnStart = this.now();
    this.extraMs = result.duration * 1000;
    const ev: KickEvent = { result, next, seat, auto, guard };
    for (const cb of this.kickCbs) cb(ev);
  }

  private commit(next: GameState): void {
    const turnChanged = next.phase !== this.s.phase || next.pick !== this.s.pick || next.turnId !== this.s.turnId;
    this.s = next;
    if (turnChanged) {
      this.turnStart = this.now();
      this.extraMs = 0;
      this.aim = null;
    }
    for (const cb of this.stateCbs) cb(next);
  }
}
