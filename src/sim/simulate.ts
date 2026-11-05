// PURE. simulateKick -> KickResult (PLAN §5.5, §5.7, §5.8, §5.9).
//
// The whole flight is simulated instantly at a fixed DT, recording a frame
// [t, x, y, z] every FRAME_EVERY steps, on every contact step and on the last
// step. Per step (§5.5, §5.7):
//   integrate → ground (airborne only) → players → frame → nets → settle → lines
// Without a `world` the ball flies over an empty infinite plane (M2 tests,
// sim:table): no obstacles and no goal/out lines.
//
// Rule events (§5.8): crossing the goal-line plane x = ±(L/2 + r) is a GOAL
// when the crossing point is between the posts and under the bar, else an
// OUT over the goal line; crossing |z| = W/2 + r is an OUT over a touchline.
// A keeper contact is a CATCH and ends the simulation at once. After a goal
// or out a visual-only tail runs (ground, frame and nets; no players, no
// rule events); its contact events carry `tail: true`.

import { PHYS, type PhysicsConstants } from './constants';
import { capsuleContact, graceOver, netContact, newContact, playerContact, respond, respondNet } from './collide';
import { capKickInput, initialBallState, type KickCaps } from './kick';
import { collideGround, integrate, settleRolling } from './step';
import {
  FRAME_STRIDE,
  type BallState,
  type KickInput,
  type KickOrigin,
  type KickResult,
  type Outcome,
  type SimEvent,
  type Team,
  type Touch,
  type Vec3,
} from './types';
import type { Hitbox, World, WorldLines } from './world';

export interface SimulateOptions {
  /** Raw input; caps (clamping, throw-in limits) are applied here. */
  input: KickInput;
  origin: KickOrigin;
  /** The kicking team (owns the last touch until a player is hit). */
  team: Team;
  /** Players, goal frames, nets and lines (buildWorld). Omit for an empty infinite plane. */
  world?: World;
  caps?: KickCaps;
  turnId?: number;
  consts?: PhysicsConstants;
}

/** Grows a plain array of frame floats; converted to Float32Array at the end. */
class FrameRecorder {
  readonly data: number[] = [];
  private lastStep = -1;

  record(stepIndex: number, t: number, x: number, y: number, z: number): void {
    if (stepIndex === this.lastStep) return;
    this.lastStep = stepIndex;
    this.data.push(t, x, y, z);
  }
}

/** A goal-line or touchline crossing found by `detectLines`. */
export type LineCrossing =
  | { kind: 'goal'; goalOf: Team; z: number; f: number }
  | { kind: 'out'; line: 'touch' | 'goal'; x: number; z: number; f: number };

/**
 * Line events for one step from p0 to p (§5.8). `f` is the crossing fraction
 * of the step; when both planes are crossed the smaller f wins. Exit points
 * are reported on the line itself: x = ±L/2 for the goal line (with the
 * crossing z), z = ±W/2 for a touchline (with the crossing x).
 */
export function detectLines(lines: WorldLines, p0: Vec3, p: Vec3, r: number): LineCrossing | null {
  let best: LineCrossing | null = null;

  const gx = lines.halfLength + r;
  const ax0 = p0.x < 0 ? -p0.x : p0.x;
  const ax = p.x < 0 ? -p.x : p.x;
  if (ax0 <= gx && ax > gx) {
    const side = p.x > 0 ? 1 : -1;
    const f = (side * gx - p0.x) / (p.x - p0.x);
    const yc = p0.y + f * (p.y - p0.y);
    const zc = p0.z + f * (p.z - p0.z);
    const azc = zc < 0 ? -zc : zc;
    best =
      azc < lines.goalHalfWidth && yc < lines.goalHeight
        ? { kind: 'goal', goalOf: side > 0 ? 1 : 0, z: zc, f }
        : { kind: 'out', line: 'goal', x: side * lines.halfLength, z: zc, f };
  }

  const tz = lines.halfWidth + r;
  const az0 = p0.z < 0 ? -p0.z : p0.z;
  const az = p.z < 0 ? -p.z : p.z;
  if (az0 <= tz && az > tz) {
    const side = p.z > 0 ? 1 : -1;
    const f = (side * tz - p0.z) / (p.z - p0.z);
    if (!best || f < best.f) {
      const xc = p0.x + f * (p.x - p0.x);
      best = { kind: 'out', line: 'touch', x: xc, z: side * lines.halfWidth, f };
    }
  }
  return best;
}

/** Mutable state of one simulation run. */
interface Run {
  readonly b: BallState;
  readonly c: PhysicsConstants;
  readonly world: World | null;
  readonly events: SimEvent[];
  readonly frames: FrameRecorder;
  readonly p0: Vec3;
  /** Step index and time of the current step. */
  n: number;
  t: number;
  /** A contact happened this step (forces a frame). */
  contact: boolean;
  /** Kicker's hitbox while its grace lasts (§5.6), then null. */
  grace: Hitbox | null;
  lastTouch: Touch;
  touches: number;
}

const contactScratch = newContact();

/** Pushes a contact event, marked when it's in the visual-only tail. */
function pushContact(run: Run, ev: SimEvent, tail: boolean): void {
  if (tail) (ev as { tail?: boolean }).tail = true;
  run.events.push(ev);
  run.contact = true;
}

/**
 * integrate → ground → [players] → frame → nets for one step. Returns the
 * keeper hitbox when a keeper was touched (CATCH: the caller stops at once).
 */
function physicsStep(run: Run, players: boolean, tail: boolean): Hitbox | null {
  const { b, c, world, p0 } = run;
  const r = c.BALL_R;
  p0.x = b.p.x;
  p0.y = b.p.y;
  p0.z = b.p.z;
  run.contact = false;

  integrate(b, c);
  if (!b.rolling) {
    const impact = collideGround(b, c);
    if (impact > 0) pushContact(run, { kind: 'ground', t: run.t, x: b.p.x, y: b.p.y, z: b.p.z, speed: impact }, tail);
  }
  if (!world) return null;

  const n = contactScratch;
  if (players) {
    if (run.grace && graceOver(b, run.grace, c)) run.grace = null;
    for (const h of world.hitboxes) {
      if (h === run.grace || !playerContact(b, h, r, n)) continue;
      if (h.gk) return h; // any keeper contact is a catch (§2.5.3)
      const impact = respond(b, n, c.E_PLAYER, c.MU_PLAYER, c.SPIN_KEEP_PLAYER);
      if (impact > 0) {
        run.lastTouch = { team: h.team, playerId: h.id };
        run.touches++;
        pushContact(
          run,
          { kind: 'player', playerId: h.id, team: h.team, t: run.t, x: b.p.x, y: b.p.y, z: b.p.z, speed: impact },
          tail,
        );
      }
    }
  }

  for (const cap of world.frame) {
    if (!capsuleContact(b, cap, r, n)) continue;
    const impact = respond(b, n, c.E_FRAME, c.MU_FRAME, c.SPIN_KEEP_FRAME);
    if (impact > 0) pushContact(run, { kind: cap.kind, t: run.t, x: b.p.x, y: b.p.y, z: b.p.z, speed: impact }, tail);
  }

  for (const net of world.nets) {
    if (!netContact(b, p0, net, r, n)) continue;
    const impact = respondNet(b, n, c);
    if (impact > 0) pushContact(run, { kind: 'net', t: run.t, x: b.p.x, y: b.p.y, z: b.p.z, speed: impact }, tail);
  }

  // A frame or net contact that throws the ball up ends rolling (§5.5).
  if (b.rolling && b.v.y > c.V_SETTLE) b.rolling = false;
  return null;
}

export function simulateKick(opts: SimulateOptions): KickResult {
  const c = opts.consts ?? PHYS;
  const world = opts.world ?? null;
  const input = capKickInput(opts.input, opts.caps, c);
  const b = initialBallState(input, opts.origin, c);
  const start = { ...b.p };
  const spin0 = { ...b.w };
  const v0 = Math.sqrt(b.v.x * b.v.x + b.v.y * b.v.y + b.v.z * b.v.z);

  const kickerId = world?.kickerId ?? (opts.origin.kind === 'player' ? opts.origin.playerId : null);
  const run: Run = {
    b,
    c,
    world,
    events: [{ kind: 'kick', t: 0, speed: v0 }],
    frames: new FrameRecorder(),
    p0: { ...b.p },
    n: 0,
    t: 0,
    contact: false,
    grace: world && kickerId !== null ? (world.hitboxes.find((h) => h.id === kickerId) ?? null) : null,
    lastTouch: { team: opts.team, playerId: null },
    touches: 0,
  };
  const { events, frames } = run;
  frames.record(0, 0, b.p.x, b.p.y, b.p.z);

  const maxSteps = Math.round(c.T_MAX / c.DT);
  const every = Math.max(1, Math.round(c.FRAME_EVERY));
  const recordStep = (force: boolean) => {
    if (force || run.contact || run.n % every === 0) frames.record(run.n, run.t, b.p.x, b.p.y, b.p.z);
  };

  let outcome: Outcome | null = null;
  let tailTime = 0;
  for (;;) {
    run.n++;
    run.t = run.n * c.DT;
    const keeper = physicsStep(run, true, false);
    if (keeper) {
      events.push({ kind: 'catch', t: run.t, keeperId: keeper.id, x: b.p.x, y: b.p.y, z: b.p.z });
      outcome = { kind: 'catch', keeperId: keeper.id };
      recordStep(true);
      break;
    }
    const stopped = settleRolling(b, c);

    const cross = world ? detectLines(world.lines, run.p0, b.p, c.BALL_R) : null;
    if (cross) {
      const { lastTouch, touches } = run;
      if (cross.kind === 'goal') {
        events.push({ kind: 'goal', t: run.t, goalOf: cross.goalOf });
        outcome = { kind: 'goal', goalOf: cross.goalOf, z: cross.z, lastTouch, touches };
        tailTime = c.TAIL_GOAL;
      } else {
        events.push({ kind: 'out', t: run.t, line: cross.line, x: cross.x, z: cross.z });
        outcome = { kind: 'out', line: cross.line, x: cross.x, z: cross.z, lastTouch, touches };
        tailTime = c.TAIL_OUT;
      }
      recordStep(true);
      break;
    }

    const last = stopped || run.n >= maxSteps;
    recordStep(last);
    if (last) {
      events.push({ kind: 'stop', t: run.t, x: b.p.x, z: b.p.z });
      outcome = { kind: 'stop', x: b.p.x, z: b.p.z, lastTouch: run.lastTouch, touches: run.touches };
      break;
    }
  }

  // Visual-only tail after a goal or out: ground, frame and nets only.
  const tailSteps = Math.round(tailTime / c.DT);
  for (let k = 1; k <= tailSteps; k++) {
    run.n++;
    run.t = run.n * c.DT;
    physicsStep(run, false, true);
    const stopped = settleRolling(b, c);
    const last = stopped || k === tailSteps;
    recordStep(last);
    if (last) break;
  }

  return {
    turnId: opts.turnId ?? 0,
    input,
    start,
    spin0,
    frames: new Float32Array(frames.data),
    events,
    outcome,
    duration: run.t,
  };
}

/** Number of recorded frames. */
export function frameCount(r: KickResult): number {
  return r.frames.length / FRAME_STRIDE;
}
