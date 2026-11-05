// PURE. Physics constants (PLAN §5.2, §5.3). SI units: m, s, kg, rad.
//
// Every sim function takes a `PhysicsConstants` argument that defaults to
// PHYS, so the Physics Lab (M4) can pass an edited copy. Use
// `deriveConstants` after editing a base value: it recomputes AREA, K_D and
// K_M from RHO, CD, BALL_R and BALL_M.

const DEG = Math.PI / 180;

export interface PhysicsConstants {
  /** Fixed step, s (240 Hz). */
  DT: number;
  /** Gravity, m/s². */
  G: number;
  /** Air density, kg/m³. */
  RHO: number;
  /** Drag coefficient (constant, past the drag crisis). */
  CD: number;
  /** Ball radius, m. */
  BALL_R: number;
  /** Ball mass, kg. */
  BALL_M: number;
  /** Ball cross-section π r², m² (derived). */
  AREA: number;
  /** Drag factor RHO·CD·AREA/(2m), 1/m (derived). a_drag = −K_D·|v|·v. */
  K_D: number;
  /** Magnus factor RHO·AREA·r/(2m), dimensionless (derived). a_magnus = K_M·(ω × v). */
  K_M: number;
  /** Sidespin at curve ±100 %, rad/s. */
  W_MAX: number;
  /** Spin decay time in the air, s. */
  TAU_AIR: number;
  /** Spin decay time while rolling, s. */
  TAU_GROUND: number;
  /** Ground restitution (vertical). */
  E_GROUND: number;
  /** Ground impact friction. */
  MU_GROUND: number;
  /** Minimum fraction of horizontal speed kept per bounce. */
  BOUNCE_KEEP_MIN: number;
  /** Spin kept per ground bounce (fraction). */
  SPIN_KEEP_GROUND: number;
  /** Rebound speed below which the ball starts rolling, m/s. */
  V_SETTLE: number;
  /** Rolling resistance coefficient (decel = MU_ROLL·G). */
  MU_ROLL: number;
  /** Horizontal speed below which a rolling ball has stopped, m/s. */
  V_STOP: number;
  /** Simulation cap, s. */
  T_MAX: number;
  /** Player contact restitution / friction / spin kept. */
  E_PLAYER: number;
  MU_PLAYER: number;
  SPIN_KEEP_PLAYER: number;
  /** Post and crossbar restitution / friction / spin kept. */
  E_FRAME: number;
  MU_FRAME: number;
  SPIN_KEEP_FRAME: number;
  /** Net restitution (normal) and tangential speed kept. */
  E_NET: number;
  NET_TANGENT_KEEP: number;
  /** Kick speed at power 0 / 100 %, m/s. */
  V_MIN: number;
  V_MAX: number;
  /** Loft angle at loft 100 %, rad (55°). */
  LOFT_MAX: number;
  /** Throw-in power cap (fraction) and release height, m. */
  THROW_POWER_CAP: number;
  /** Kickoff power cap (fraction): a capped kickoff can't reach the goal (M17). */
  KICKOFF_POWER_CAP: number;
  THROW_HEIGHT: number;
  /** Gap between the kicker's hitbox and the ball, m. */
  KICK_GAP: number;
  /** Kicker's hitbox is ignored until the ball is this far beyond it, m. */
  GRACE_DIST: number;
  /** Visual-only simulation after a goal / an out, s. */
  TAIL_GOAL: number;
  TAIL_OUT: number;
  /** Trajectory recording rate, steps per frame (60 Hz). */
  FRAME_EVERY: number;
}

/** Hitbox shapes (§5.2): a vertical cylinder of radius R from y = 0 to HC, capped by a hemisphere of radius R. */
export interface HitboxShape {
  /** Radius, m. */
  R: number;
  /** Height of the cylinder top / hemisphere center, m (the top is at HC + R). */
  HC: number;
}

export const HITBOX: Readonly<{ OUTFIELD: HitboxShape; GK: HitboxShape }> = Object.freeze({
  OUTFIELD: Object.freeze({ R: 0.4, HC: 1.45 }), // top at 1.85 m
  GK: Object.freeze({ R: 1.25, HC: 1.05 }), // top at 2.30 m, arms spread (M17: was R 0.9, HC 1.4)
});

/** Goal frame: posts and crossbar are capsules of this radius, m (0.12 m diameter). */
export const FRAME_R = 0.06;
/** Post axis top / crossbar axis height, m (bar underside at 2.44). */
export const FRAME_TOP = 2.5;

/** Recomputes the derived values (AREA, K_D, K_M) from the base ones. */
export function deriveConstants(base: PhysicsConstants): PhysicsConstants {
  const AREA = Math.PI * base.BALL_R * base.BALL_R;
  return {
    ...base,
    AREA,
    K_D: (base.RHO * base.CD * AREA) / (2 * base.BALL_M),
    K_M: (base.RHO * AREA * base.BALL_R) / (2 * base.BALL_M),
  };
}

export const PHYS: Readonly<PhysicsConstants> = Object.freeze(
  deriveConstants({
    DT: 1 / 240,
    G: 9.81,
    RHO: 1.225,
    CD: 0.25,
    BALL_R: 0.11,
    BALL_M: 0.43,
    AREA: 0, // derived
    K_D: 0, // derived ≈ 0.01354
    K_M: 0, // derived ≈ 0.00596
    W_MAX: 50,
    TAU_AIR: 6,
    TAU_GROUND: 0.5,
    E_GROUND: 0.55,
    MU_GROUND: 0.45,
    BOUNCE_KEEP_MIN: 0.6,
    SPIN_KEEP_GROUND: 0.8,
    V_SETTLE: 0.6,
    MU_ROLL: 0.22, // M17: was 0.12 (rolls were too long)
    V_STOP: 0.05,
    T_MAX: 30,
    E_PLAYER: 0.45,
    MU_PLAYER: 0.25,
    SPIN_KEEP_PLAYER: 0.3,
    E_FRAME: 0.7,
    MU_FRAME: 0.1,
    SPIN_KEEP_FRAME: 0.6,
    E_NET: 0.1,
    NET_TANGENT_KEEP: 0.5,
    V_MIN: 3,
    V_MAX: 30, // M17: was 32
    LOFT_MAX: 55 * DEG,
    THROW_POWER_CAP: 0.45,
    KICKOFF_POWER_CAP: 0.5,
    THROW_HEIGHT: 1.8,
    KICK_GAP: 0.02,
    GRACE_DIST: 0.25,
    TAIL_GOAL: 1.5,
    TAIL_OUT: 1.0,
    FRAME_EVERY: 4,
  }),
);
