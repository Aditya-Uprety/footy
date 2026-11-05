// PURE. simulateKick -> KickResult (PLAN §5.5, §5.8, §5.9).
//
// The whole flight is simulated instantly at a fixed DT, recording a frame
// [t, x, y, z] every FRAME_EVERY steps, on every contact step and on the last
// step. M2 covers the empty plane (kick / ground / stop); M3 adds the world
// (players, goal frames, nets), goal/out lines, catches and tails.

import { PHYS, type PhysicsConstants } from './constants';
import { capKickInput, initialBallState, type KickCaps } from './kick';
import { collideGround, integrate, settleRolling } from './step';
import { FRAME_STRIDE, type KickInput, type KickOrigin, type KickResult, type SimEvent, type Team } from './types';

export interface SimulateOptions {
  /** Raw input; caps (clamping, throw-in limits) are applied here. */
  input: KickInput;
  origin: KickOrigin;
  /** The kicking team (owns the last touch until a player is hit). */
  team: Team;
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

export function simulateKick(opts: SimulateOptions): KickResult {
  const c = opts.consts ?? PHYS;
  const input = capKickInput(opts.input, opts.caps, c);
  const b = initialBallState(input, opts.origin, c);
  const start = { ...b.p };
  const spin0 = { ...b.w };
  const v0 = Math.sqrt(b.v.x * b.v.x + b.v.y * b.v.y + b.v.z * b.v.z);

  const events: SimEvent[] = [{ kind: 'kick', t: 0, speed: v0 }];
  const frames = new FrameRecorder();
  frames.record(0, 0, b.p.x, b.p.y, b.p.z);

  const maxSteps = Math.round(c.T_MAX / c.DT);
  const every = Math.max(1, Math.round(c.FRAME_EVERY));
  let n = 0;
  let t = 0;
  for (;;) {
    n++;
    t = n * c.DT;
    integrate(b, c);
    let contact = false;
    if (!b.rolling) {
      const impact = collideGround(b, c);
      if (impact > 0) {
        contact = true;
        events.push({ kind: 'ground', t, x: b.p.x, y: b.p.y, z: b.p.z, speed: impact });
      }
    }
    const stopped = settleRolling(b, c);
    const last = stopped || n >= maxSteps;
    if (contact || last || n % every === 0) frames.record(n, t, b.p.x, b.p.y, b.p.z);
    if (last) break;
  }

  events.push({ kind: 'stop', t, x: b.p.x, z: b.p.z });
  return {
    turnId: opts.turnId ?? 0,
    input,
    start,
    spin0,
    frames: new Float32Array(frames.data),
    events,
    outcome: {
      kind: 'stop',
      x: b.p.x,
      z: b.p.z,
      lastTouch: { team: opts.team, playerId: null },
      touches: 0,
    },
    duration: t,
  };
}

/** Number of recorded frames. */
export function frameCount(r: KickResult): number {
  return r.frames.length / FRAME_STRIDE;
}
