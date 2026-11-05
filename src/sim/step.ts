// PURE. One fixed physics step (PLAN §5.4, §5.5).
//
// The step is split into phases so simulate.ts can run world collisions
// (players, frame, nets; M3) between them in the §5.5 order:
//   integrate → collideGround (airborne only) → [world collisions] → settleRolling
// `step` composes the phases for an empty plane.
//
// Determinism (§5.11): only + − × ÷ and Math.sqrt in here.

import { PHYS, type PhysicsConstants } from './constants';
import type { BallState } from './types';

/**
 * Forces, semi-implicit Euler and spin decay:
 *   a = g − K_D·|v|·v + K_M·(ω × v)  (+ rolling resistance, no vertical part, when rolling)
 *   v += a·DT;  p += v·DT;  ω *= 1 − DT/τ
 */
export function integrate(b: BallState, c: PhysicsConstants = PHYS): void {
  const v = b.v;
  const w = b.w;
  const vx = v.x;
  const vy = v.y;
  const vz = v.z;
  const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
  const kd = c.K_D * speed;
  let ax = -kd * vx + c.K_M * (w.y * vz - w.z * vy);
  let ay = -c.G - kd * vy + c.K_M * (w.z * vx - w.x * vz);
  let az = -kd * vz + c.K_M * (w.x * vy - w.y * vx);

  if (b.rolling) {
    ay = 0; // ground support
    const vh = Math.sqrt(vx * vx + vz * vz);
    const roll = c.MU_ROLL * c.G;
    if (vh <= roll * c.DT) {
      // Rolling resistance would reverse the ball: it has stopped rolling.
      v.x = 0;
      v.z = 0;
      ax = 0;
      az = 0;
    } else {
      ax -= (roll * vx) / vh;
      az -= (roll * vz) / vh;
    }
  }

  v.x += ax * c.DT;
  v.y += ay * c.DT;
  v.z += az * c.DT;
  b.p.x += v.x * c.DT;
  b.p.y += v.y * c.DT;
  b.p.z += v.z * c.DT;

  const keep = 1 - c.DT / (b.rolling ? c.TAU_GROUND : c.TAU_AIR);
  w.x *= keep;
  w.y *= keep;
  w.z *= keep;
}

/**
 * Ground bounce for an airborne ball. Returns the impact speed (|v.y| before
 * the bounce) if the ball hit the ground moving down this step, else 0.
 * Impact friction keeps k = max(BOUNCE_KEEP_MIN, 1 − MU_GROUND·(1+E)·|v.y|/|v_h|)
 * of the horizontal speed; a rebound slower than V_SETTLE starts rolling.
 */
export function collideGround(b: BallState, c: PhysicsConstants = PHYS): number {
  const p = b.p;
  const v = b.v;
  if (p.y >= c.BALL_R) return 0;
  p.y = c.BALL_R;
  if (v.y >= 0) return 0;
  const vyAbs = -v.y;
  const vh = Math.sqrt(v.x * v.x + v.z * v.z);
  let k = c.BOUNCE_KEEP_MIN;
  if (vh > 1e-12) {
    const fric = 1 - (c.MU_GROUND * (1 + c.E_GROUND) * vyAbs) / vh;
    if (fric > k) k = fric;
  }
  v.x *= k;
  v.z *= k;
  v.y = c.E_GROUND * vyAbs;
  b.w.x *= c.SPIN_KEEP_GROUND;
  b.w.y *= c.SPIN_KEEP_GROUND;
  b.w.z *= c.SPIN_KEEP_GROUND;
  if (v.y < c.V_SETTLE) {
    v.y = 0;
    b.rolling = true;
  }
  return vyAbs;
}

/**
 * Keeps a rolling ball on the ground (p.y = r, v.y = 0). Returns true when it
 * has stopped (horizontal speed below V_STOP).
 */
export function settleRolling(b: BallState, c: PhysicsConstants = PHYS): boolean {
  if (!b.rolling) return false;
  b.p.y = c.BALL_R;
  b.v.y = 0;
  return b.v.x * b.v.x + b.v.z * b.v.z < c.V_STOP * c.V_STOP;
}

/** What happened during one `step`. Reused between calls to avoid allocation. */
export interface StepInfo {
  /** Impact speed of a ground bounce this step, m/s, or 0 if none. */
  ground: number;
  /** The ball has stopped (end of simulation). */
  stopped: boolean;
}

export function newStepInfo(): StepInfo {
  return { ground: 0, stopped: false };
}

/** One full step on an empty plane (§5.5 without world collisions). */
export function step(b: BallState, c: PhysicsConstants = PHYS, info: StepInfo = newStepInfo()): StepInfo {
  integrate(b, c);
  info.ground = b.rolling ? 0 : collideGround(b, c);
  info.stopped = settleRolling(b, c);
  return info;
}
