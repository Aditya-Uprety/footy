// KickResult player (PLAN §5.9, M4.3): binary-searches the recorded frames by
// time and lerps between them, fires each event when playback time passes
// its t, and applies the per-viewer time-warp (hold F = 3×; "auto-speed slow
// rolls" = 2× while rolling below 2 m/s). It also drives a BallView: rolling →
// rotate by distance / r about ŷ × v̂; airborne → spin0, decaying.
//
// The logic has no Three.js runtime dependency so it runs in Node tests.
import { PHYS } from '../sim/constants';
import { FRAME_STRIDE, type KickResult, type SimEvent, type Vec3 } from '../sim/types';
import type { BallView } from './ball';

/** Hold F. */
export const FAST_FORWARD_RATE = 3;
/** Auto-speed slow rolls. */
export const SLOW_ROLL_RATE = 2;
/** "Slow" = rolling below this speed, m/s. */
export const SLOW_ROLL_SPEED = 2;
/** The ball counts as on the ground below r + this, m. */
const GROUND_EPS = 0.004;
/** Seconds to move a caught ball into the keeper's hands. */
const CATCH_SNAP_TIME = 0.12;

/**
 * Index i of the frame segment [i, i+1] containing t (clamped to the ends):
 * frames[i].t ≤ t < frames[i+1].t.
 */
export function frameSegment(frames: Float32Array, t: number): number {
  const n = frames.length / FRAME_STRIDE;
  if (n <= 1 || t <= frames[0]!) return 0;
  if (t >= frames[(n - 1) * FRAME_STRIDE]!) return Math.max(0, n - 2);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid * FRAME_STRIDE]! <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Ball position at time t (lerp between frames; clamped to the first/last frame). */
export function sampleFrames(frames: Float32Array, t: number, out: Vec3): Vec3 {
  const n = frames.length / FRAME_STRIDE;
  if (n === 0) {
    out.x = out.y = out.z = 0;
    return out;
  }
  const i = frameSegment(frames, t);
  const a = i * FRAME_STRIDE;
  if (n === 1) {
    out.x = frames[a + 1]!;
    out.y = frames[a + 2]!;
    out.z = frames[a + 3]!;
    return out;
  }
  const b = a + FRAME_STRIDE;
  const ta = frames[a]!;
  const tb = frames[b]!;
  // Frame times are float32: a t that rounds to tb (e.g. t = duration) is exactly frame b.
  const k = tb > ta && Math.fround(t) < tb ? Math.min(1, Math.max(0, (t - ta) / (tb - ta))) : 1;
  out.x = frames[a + 1]! + (frames[b + 1]! - frames[a + 1]!) * k;
  out.y = frames[a + 2]! + (frames[b + 2]! - frames[a + 2]!) * k;
  out.z = frames[a + 3]! + (frames[b + 3]! - frames[a + 3]!) * k;
  return out;
}

/** Ball velocity at time t: the slope of the frame segment containing t. */
export function sampleVelocity(frames: Float32Array, t: number, out: Vec3): Vec3 {
  const n = frames.length / FRAME_STRIDE;
  out.x = out.y = out.z = 0;
  if (n < 2) return out;
  const a = frameSegment(frames, t) * FRAME_STRIDE;
  const b = a + FRAME_STRIDE;
  const dt = frames[b]! - frames[a]!;
  if (dt <= 0) return out;
  out.x = (frames[b + 1]! - frames[a + 1]!) / dt;
  out.y = (frames[b + 2]! - frames[a + 2]!) / dt;
  out.z = (frames[b + 3]! - frames[a + 3]!) / dt;
  return out;
}

/** Where a caught ball ends up: in front of the keeper, toward where it was touched, at a hand-ish height. */
export function keeperHands(keeper: { x: number; z: number }, ball: Vec3): Vec3 {
  const dx = ball.x - keeper.x;
  const dz = ball.z - keeper.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const reach = 0.45;
  const ux = d > 1e-6 ? dx / d : 1;
  const uz = d > 1e-6 ? dz / d : 0;
  return { x: keeper.x + ux * reach, y: Math.min(1.8, Math.max(0.9, ball.y)), z: keeper.z + uz * reach };
}

export interface PlaybackOptions {
  /** Called once per event, in order, when playback time passes its t. */
  onEvent?: (ev: SimEvent) => void;
  /** Called once when playback reaches the end (including any tail). */
  onEnd?: () => void;
  /** 2× while rolling below 2 m/s (per-viewer setting, default on). */
  autoSlowRolls?: boolean;
  /** Keeper position for the catch snap (§5.8: the ball snaps to the keeper's hands). */
  keeperAt?: (id: number) => { x: number; z: number } | null;
  /** Ball radius and air spin decay (default PHYS; the Lab passes its edited constants). */
  consts?: { BALL_R: number; TAU_AIR: number };
}

export interface PlaybackInput {
  /** Hold F. */
  fastForward?: boolean;
}

export class KickPlayback {
  readonly result: KickResult;
  /** Playback time, s (sim time). */
  t = 0;
  /** Current display position (includes the catch snap) and velocity. */
  readonly pos: Vec3 = { x: 0, y: 0, z: 0 };
  readonly vel: Vec3 = { x: 0, y: 0, z: 0 };
  /** The time-warp applied on the last update. */
  rate = 1;
  private nextEvent = 0;
  private ended = false;
  private readonly prev: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly opts: PlaybackOptions;
  private readonly r: number;
  private readonly tauAir: number;
  private catchFrom: Vec3 | null = null;
  private catchTo: Vec3 | null = null;
  private catchT = 0;

  constructor(result: KickResult, opts: PlaybackOptions = {}) {
    this.result = result;
    this.opts = opts;
    this.r = opts.consts?.BALL_R ?? PHYS.BALL_R;
    this.tauAir = opts.consts?.TAU_AIR ?? PHYS.TAU_AIR;
    this.seek(0);
  }

  get duration(): number {
    return this.result.duration;
  }

  get done(): boolean {
    return this.ended;
  }

  /** On the ground (within a few mm) and not moving up or down. */
  get rolling(): boolean {
    return this.pos.y <= this.r + GROUND_EPS && Math.abs(this.vel.y) < 0.5;
  }

  get speed(): number {
    const v = this.vel;
    return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  }

  /** Time-warp for the current state. */
  rateFor(input: PlaybackInput = {}): number {
    if (input.fastForward) return FAST_FORWARD_RATE;
    if ((this.opts.autoSlowRolls ?? true) && this.rolling && this.speed < SLOW_ROLL_SPEED) return SLOW_ROLL_RATE;
    return 1;
  }

  /** Restarts at time t without firing events before it (used for replays). */
  seek(t: number): void {
    this.t = Math.max(0, Math.min(t, this.duration));
    this.nextEvent = 0;
    while (this.nextEvent < this.result.events.length && this.result.events[this.nextEvent]!.t < this.t) this.nextEvent++;
    this.ended = false;
    this.catchFrom = this.catchTo = null;
    sampleFrames(this.result.frames, this.t, this.pos);
    sampleVelocity(this.result.frames, this.t, this.vel);
    this.prev.x = this.pos.x;
    this.prev.y = this.pos.y;
    this.prev.z = this.pos.z;
  }

  /**
   * Advances by a real-time dt with the time-warp applied, fires the events
   * passed and, at the end, onEnd. Returns the sim time advanced.
   */
  update(realDt: number, input: PlaybackInput = {}): number {
    this.prev.x = this.pos.x;
    this.prev.y = this.pos.y;
    this.prev.z = this.pos.z;
    if (this.ended) {
      this.stepCatch(realDt);
      return 0;
    }
    this.rate = this.rateFor(input);
    const t0 = this.t;
    this.t = Math.min(this.duration, this.t + Math.max(0, realDt) * this.rate);

    const events = this.result.events;
    while (this.nextEvent < events.length && events[this.nextEvent]!.t <= this.t) {
      const ev = events[this.nextEvent++]!;
      if (ev.kind === 'catch') this.beginCatch(ev);
      this.opts.onEvent?.(ev);
    }

    if (!this.catchTo) {
      sampleFrames(this.result.frames, this.t, this.pos);
      sampleVelocity(this.result.frames, this.t, this.vel);
    }
    this.stepCatch(realDt);

    if (this.t >= this.duration) {
      // Fire anything left (events exactly at the end are already covered; this guards float edge cases).
      while (this.nextEvent < events.length) {
        const ev = events[this.nextEvent++]!;
        if (ev.kind === 'catch') this.beginCatch(ev);
        this.opts.onEvent?.(ev);
      }
      this.ended = true;
      this.opts.onEnd?.();
    }
    return this.t - t0;
  }

  /** Air spin at playback time t: spin0 decaying with TAU_AIR (visual only). */
  spinAt(t: number, out: Vec3): Vec3 {
    const k = Math.exp(-t / this.tauAir);
    out.x = this.result.spin0.x * k;
    out.y = this.result.spin0.y * k;
    out.z = this.result.spin0.z * k;
    return out;
  }

  private readonly spinScratch: Vec3 = { x: 0, y: 0, z: 0 };

  /** Moves and rotates a ball view to match the last update(simDt = its return value). */
  applyTo(ball: Pick<BallView, 'setPosition' | 'roll' | 'spin'>, simDt: number): void {
    ball.setPosition(this.pos.x, this.pos.y, this.pos.z);
    if (this.catchTo || simDt <= 0) return;
    if (this.rolling) {
      ball.roll(this.pos.x - this.prev.x, this.pos.z - this.prev.z);
    } else {
      const w = this.spinAt(this.t, this.spinScratch);
      ball.spin(w.x, w.y, w.z, simDt);
    }
  }

  private beginCatch(ev: Extract<SimEvent, { kind: 'catch' }>): void {
    const keeper = this.opts.keeperAt?.(ev.keeperId);
    const at = { x: ev.x, y: ev.y, z: ev.z };
    this.pos.x = at.x;
    this.pos.y = at.y;
    this.pos.z = at.z;
    this.vel.x = this.vel.y = this.vel.z = 0;
    if (!keeper) return;
    this.catchFrom = at;
    this.catchTo = keeperHands(keeper, at);
    this.catchT = 0;
  }

  private stepCatch(realDt: number): void {
    if (!this.catchFrom || !this.catchTo) return;
    this.catchT = Math.min(1, this.catchT + realDt / CATCH_SNAP_TIME);
    const k = this.catchT;
    this.pos.x = this.catchFrom.x + (this.catchTo.x - this.catchFrom.x) * k;
    this.pos.y = this.catchFrom.y + (this.catchTo.y - this.catchFrom.y) * k;
    this.pos.z = this.catchFrom.z + (this.catchTo.z - this.catchFrom.z) * k;
  }
}
