// PURE. Kick model (PLAN §5.6): KickInput (+ restart caps) -> initial ball
// state, plus the ghost-taker ball spots for kickoffs, corners and throw-ins.
// Trig runs here, once per kick; the step loop itself uses no trig (§5.11).

import type { PitchSettings } from '../shared/pitch';
import { HITBOX, PHYS, type PhysicsConstants } from './constants';
import type { BallState, KickInput, KickOrigin, Vec3 } from './types';

/** Corner kicks: the ball sits this far inside both lines, m (§2.6.4). */
export const CORNER_BALL_INSET = 0.5;
/** Throw-ins: the taker's x is kept this far inside the goal lines, m (§2.6.3). */
export const THROW_X_MARGIN = 1;

export interface KickCaps {
  /** Throw-in: power ≤ THROW_POWER_CAP, curve locked at 0 (§2.6.3). */
  throwIn?: boolean;
}

function finiteOr0(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Clamps the sliders to their ranges and applies restart caps. Non-finite
 * numbers become 0, so a malformed intent can never produce NaN physics.
 */
export function capKickInput(input: KickInput, caps: KickCaps = {}, c: PhysicsConstants = PHYS): KickInput {
  let power = clamp(finiteOr0(input.power), 0, 1);
  let curve = clamp(finiteOr0(input.curve), -1, 1);
  const loft = clamp(finiteOr0(input.loft), 0, 1);
  if (caps.throwIn) {
    power = Math.min(power, c.THROW_POWER_CAP);
    curve = 0;
  }
  return { yaw: finiteOr0(input.yaw), power, curve, loft };
}

/** Kick direction d̂ = (cos yaw, 0, sin yaw). */
export function kickDirection(yaw: number): Vec3 {
  return { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) };
}

/** The kicker's right r̂ = d̂ × ŷ = (−sin yaw, 0, cos yaw). Curve > 0 bends this way. */
export function kickRight(yaw: number): Vec3 {
  return { x: -Math.sin(yaw), y: 0, z: Math.cos(yaw) };
}

/** Kick speed for a power fraction, m/s. */
export function kickSpeed(power: number, c: PhysicsConstants = PHYS): number {
  return c.V_MIN + power * (c.V_MAX - c.V_MIN);
}

/** Hitbox radius of a player kicker (outfield or GK). */
export function kickerRadius(gk: boolean): number {
  return gk ? HITBOX.GK.R : HITBOX.OUTFIELD.R;
}

/**
 * Where the ball starts. A player kicker gets it at their feet, just outside
 * their hitbox along d̂: (kx, r, kz) + d̂·(R + r + KICK_GAP). A ghost taker's
 * origin is the ball spot itself (see kickoffSpot / cornerSpot / throwInSpot).
 */
export function kickStart(origin: KickOrigin, yaw: number, c: PhysicsConstants = PHYS): Vec3 {
  if (origin.kind === 'ghost') return { x: origin.x, y: origin.y, z: origin.z };
  const d = kickDirection(yaw);
  const off = kickerRadius(origin.gk) + c.BALL_R + c.KICK_GAP;
  return { x: origin.x + d.x * off, y: c.BALL_R, z: origin.z + d.z * off };
}

/**
 * Initial ball state for an (already capped) input:
 * v = v0·(cos α·d̂ + sin α·ŷ), ω = (0, −curve·W_MAX, 0). Clockwise spin seen
 * from above (curve > 0) bends the ball right, toward r̂. The ball starts
 * rolling only when α = 0 and it starts on the ground.
 */
export function initialBallState(input: KickInput, origin: KickOrigin, c: PhysicsConstants = PHYS): BallState {
  const d = kickDirection(input.yaw);
  const v0 = kickSpeed(input.power, c);
  const alpha = input.loft * c.LOFT_MAX;
  const ch = Math.cos(alpha);
  const sv = Math.sin(alpha);
  const p = kickStart(origin, input.yaw, c);
  return {
    p,
    v: { x: v0 * ch * d.x, y: v0 * sv, z: v0 * ch * d.z },
    w: { x: 0, y: -input.curve * c.W_MAX, z: 0 },
    rolling: alpha === 0 && Math.abs(p.y - c.BALL_R) < 1e-9,
  };
}

/** Kickoff ball spot: the center spot. */
export function kickoffSpot(c: PhysicsConstants = PHYS): Vec3 {
  return { x: 0, y: c.BALL_R, z: 0 };
}

/**
 * Corner ball spot, CORNER_BALL_INSET inside both lines of the corner at
 * (sx·L/2, sz·W/2).
 */
export function cornerSpot(pitch: PitchSettings, sx: -1 | 1, sz: -1 | 1, c: PhysicsConstants = PHYS): Vec3 {
  return {
    x: sx * (pitch.pitchLength / 2 - CORNER_BALL_INSET),
    y: c.BALL_R,
    z: sz * (pitch.pitchWidth / 2 - CORNER_BALL_INSET),
  };
}

/**
 * Throw-in ball spot: released from THROW_HEIGHT just inside the touchline
 * at z = sz·W/2, at the exit x clamped to ±(L/2 − THROW_X_MARGIN).
 */
export function throwInSpot(pitch: PitchSettings, xExit: number, sz: -1 | 1, c: PhysicsConstants = PHYS): Vec3 {
  const xMax = pitch.pitchLength / 2 - THROW_X_MARGIN;
  return { x: clamp(xExit, -xMax, xMax), y: c.THROW_HEIGHT, z: sz * (pitch.pitchWidth / 2 - c.BALL_R) };
}
