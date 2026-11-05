// Figure animation poses (PLAN M12.2): pure numbers, no Three.js.
//
// A pose is a handful of joint angles (rad). Legs swing about the hip axis
// (positive = foot forward, +x of the figure); arms swing in the same plane
// and may spread (`armAbd` is added to the arm's resting spread: positive =
// further from the body). `lean` tips the whole figure forward about the feet.
// Hitboxes never change with a pose (§2.8: animations are visual only).
import { clamp, lerp } from '../shared/math';

export interface Pose {
  legL: number;
  legR: number;
  armL: number;
  armR: number;
  /** Extra spread of the left / right arm on top of its resting angle. */
  armLAbd: number;
  armRAbd: number;
  lean: number;
}

export const IDLE_POSE: Readonly<Pose> = Object.freeze({
  legL: 0,
  legR: 0,
  armL: 0,
  armR: 0,
  armLAbd: 0,
  armRAbd: 0,
  lean: 0,
});

export function copyPose(p: Readonly<Pose>): Pose {
  return { ...p };
}

/** Linear blend of two poses, k in 0–1. */
export function blendPose(a: Readonly<Pose>, b: Readonly<Pose>, k: number): Pose {
  return {
    legL: lerp(a.legL, b.legL, k),
    legR: lerp(a.legR, b.legR, k),
    armL: lerp(a.armL, b.armL, k),
    armR: lerp(a.armR, b.armR, k),
    armLAbd: lerp(a.armLAbd, b.armLAbd, k),
    armRAbd: lerp(a.armRAbd, b.armRAbd, k),
    lean: lerp(a.lean, b.lean, k),
  };
}

const easeOut = (k: number): number => 1 - (1 - k) * (1 - k);
const easeInOut = (k: number): number => k * k * (3 - 2 * k);
const unit = (t: number, dur: number): number => clamp(t / dur, 0, 1);

// ---- kick --------------------------------------------------------------------
// The right leg (the +z side, §5.1) kicks; the opposite arm swings forward.

/** Seconds the kicker's leg draws back before the strike (the flow's wind-up is 0.35 s). */
export const WINDUP_DURATION = 0.3;
/** Seconds from the strike to the end of the swing, to the end of the follow-through, and to standing again. */
export const KICK_STRIKE_TIME = 0.1;
export const KICK_FOLLOW_TIME = 0.35;
export const KICK_DURATION = 0.95;

const WINDUP: Readonly<Pose> = { ...IDLE_POSE, legR: -0.75, legL: 0.06, armL: -0.4, armR: 0.5, armLAbd: 0.1, armRAbd: 0.1, lean: 0.08 };
const STRIKE: Readonly<Pose> = { ...IDLE_POSE, legR: 1.15, legL: -0.05, armL: 0.75, armR: -0.6, armLAbd: 0.15, armRAbd: 0.15, lean: -0.06 };
const FOLLOW: Readonly<Pose> = { ...IDLE_POSE, legR: 1.45, legL: -0.08, armL: 0.9, armR: -0.7, armLAbd: 0.2, armRAbd: 0.2, lean: -0.14 };

/** Drawing the leg back, t seconds after the wind-up began (holds the last pose). */
export function windupPose(t: number, from: Readonly<Pose> = IDLE_POSE): Pose {
  return blendPose(from, WINDUP, easeInOut(unit(t, WINDUP_DURATION)));
}

/**
 * The strike, t seconds after the ball is released: from wherever the pose was
 * (`from`: idle, or the wind-up) through the swing and follow-through, then back to standing.
 */
export function kickPose(t: number, from: Readonly<Pose> = IDLE_POSE): Pose {
  if (t < KICK_STRIKE_TIME) return blendPose(from, STRIKE, easeOut(unit(t, KICK_STRIKE_TIME)));
  if (t < KICK_FOLLOW_TIME) return blendPose(STRIKE, FOLLOW, unit(t - KICK_STRIKE_TIME, KICK_FOLLOW_TIME - KICK_STRIKE_TIME));
  return blendPose(FOLLOW, IDLE_POSE, easeInOut(unit(t - KICK_FOLLOW_TIME, KICK_DURATION - KICK_FOLLOW_TIME)));
}

// ---- keeper catch -------------------------------------------------------------

/** Seconds for the arms to come together around the ball. */
export const CATCH_TIME = 0.22;
/** Absolute arm spread of a catching keeper (small: the arms close around the ball), rad. */
export const CATCH_SPREAD = -0.15;

/** How far the arms reach for a ball at height y: low balls in front, high balls overhead. */
export function catchReach(ballY: number): { swing: number; lean: number } {
  const k = clamp((ballY - 0.9) / (1.8 - 0.9), 0, 1);
  return { swing: lerp(1.0, 2.15, k), lean: lerp(0.3, -0.05, k) };
}

/**
 * The catch pose, t seconds after the ball is taken: the arms swing to meet the
 * ball and stay there (hold). `restSpread` is the arm's resting spread (keeper
 * arms are out at ~100°), so the pose can aim for an absolute spread.
 */
export function catchPose(t: number, ballY: number, restSpread: number, from: Readonly<Pose> = IDLE_POSE): Pose {
  const { swing, lean } = catchReach(ballY);
  const target: Pose = {
    ...IDLE_POSE,
    armL: swing,
    armR: swing,
    armLAbd: CATCH_SPREAD - restSpread,
    armRAbd: CATCH_SPREAD - restSpread,
    lean,
  };
  return blendPose(from, target, easeOut(unit(t, CATCH_TIME)));
}

/** Seconds to return from a held pose to standing. */
export const RELAX_TIME = 0.35;
export function relaxPose(t: number, from: Readonly<Pose>): Pose {
  return blendPose(from, IDLE_POSE, easeInOut(unit(t, RELAX_TIME)));
}

// ---- possessor ring ----------------------------------------------------------------

/** Pulse of the possessor ring at time t: scale and opacity. */
export function ringPulse(t: number): { scale: number; opacity: number } {
  const s = Math.sin(t * 4);
  return { scale: 1 + 0.05 * s, opacity: 0.8 + 0.15 * s };
}
