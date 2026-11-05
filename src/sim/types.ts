// PURE. Sim data types (PLAN §5.9, §7): BallState, KickInput, SimEvent,
// Outcome, KickResult. game/types.ts re-uses Team, KickInput, Touch and
// Outcome from here so the two layers can't drift apart.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 0 = Team A (defends x = −L/2), 1 = Team B. */
export type Team = 0 | 1;

/** Mutable ball state used by the stepper. */
export interface BallState {
  /** Position of the ball's center, m. */
  p: Vec3;
  /** Velocity, m/s. */
  v: Vec3;
  /** Angular velocity, rad/s. */
  w: Vec3;
  /** On the ground: vertical motion suppressed, rolling resistance applies. */
  rolling: boolean;
}

/**
 * The kicking seat's choice (§2.4.2). Fractions, before restart caps.
 * yaw: direction d̂ = (cos yaw, 0, sin yaw), rad.
 * power ∈ [0, 1], curve ∈ [−1, 1] (+ bends right), loft ∈ [0, 1] (× LOFT_MAX).
 */
export interface KickInput {
  yaw: number;
  power: number;
  curve: number;
  loft: number;
}

/** Who strikes the ball, as far as physics cares (§5.6). */
export type KickOrigin =
  /** A placed player: the ball starts in front of their hitbox along d̂. */
  | { kind: 'player'; playerId: number; team: Team; x: number; z: number; gk: boolean }
  /** A ghost taker (kickoff, throw-in, corner): the ball starts exactly here. */
  | { kind: 'ghost'; x: number; y: number; z: number };

/** Last player contact (§2.6.5); playerId null = no contact since the kick (the kicking team). */
export interface Touch {
  team: Team;
  playerId: number | null;
}

export type Outcome =
  | { kind: 'goal'; goalOf: Team; lastTouch: Touch; touches: number }
  | { kind: 'out'; line: 'touch' | 'goal'; x: number; z: number; lastTouch: Touch; touches: number }
  | { kind: 'catch'; keeperId: number }
  | { kind: 'stop'; x: number; z: number; lastTouch: Touch; touches: number };

/** Contact events carry the impact speed (−v·n, m/s) and the ball position. */
interface ContactBase {
  t: number;
  x: number;
  y: number;
  z: number;
  speed: number;
  /** True for events inside the visual-only tail after a goal/out. */
  tail?: boolean;
}

export type SimEvent =
  | { kind: 'kick'; t: number; speed: number }
  | ({ kind: 'ground' } & ContactBase)
  | ({ kind: 'player'; playerId: number; team: Team } & ContactBase)
  | ({ kind: 'post' } & ContactBase)
  | ({ kind: 'bar' } & ContactBase)
  | ({ kind: 'net' } & ContactBase)
  | { kind: 'goal'; t: number; goalOf: Team }
  | { kind: 'out'; t: number; line: 'touch' | 'goal'; x: number; z: number }
  | { kind: 'catch'; t: number; keeperId: number; x: number; y: number; z: number }
  | { kind: 'stop'; t: number; x: number; z: number };

export type SimEventKind = SimEvent['kind'];

/** Floats per recorded frame: [t, x, y, z]. */
export const FRAME_STRIDE = 4;

export interface KickResult {
  turnId: number;
  /** The input after restart caps. */
  input: KickInput;
  /** Ball start position and initial spin. */
  start: Vec3;
  spin0: Vec3;
  /** [t, x, y, z] × n: every FRAME_EVERY steps + every contact step + the last step. */
  frames: Float32Array;
  events: SimEvent[];
  outcome: Outcome;
  /** Seconds, including any tail. */
  duration: number;
}
