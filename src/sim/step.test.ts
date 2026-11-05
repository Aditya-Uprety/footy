import { describe, expect, it } from 'vitest';
import { PHYS } from './constants';
import { collideGround, integrate, settleRolling, step } from './step';
import type { BallState } from './types';

const r = PHYS.BALL_R;

function ball(p: [number, number, number], v: [number, number, number], wy = 0, rolling = false): BallState {
  return { p: { x: p[0], y: p[1], z: p[2] }, v: { x: v[0], y: v[1], z: v[2] }, w: { x: 0, y: wy, z: 0 }, rolling };
}

describe('step phases (PLAN §5.4–5.5)', () => {
  it('applies gravity and quadratic drag', () => {
    const b = ball([0, 10, 0], [20, 0, 0]);
    integrate(b);
    const dt = PHYS.DT;
    expect(b.v.y).toBeCloseTo(-PHYS.G * dt, 12);
    expect(b.v.x).toBeCloseTo(20 - PHYS.K_D * 20 * 20 * dt, 12);
    // Semi-implicit: position uses the new velocity.
    expect(b.p.x).toBeCloseTo(b.v.x * dt, 12);
  });

  it('Magnus with ω = (0, −w, 0) pushes a +x ball toward +z (right)', () => {
    const b = ball([0, 10, 0], [20, 0, 0], -50);
    integrate(b);
    expect(b.v.z).toBeCloseTo(PHYS.K_M * 50 * 20 * PHYS.DT, 12);
  });

  it('decays spin with TAU_AIR in the air and TAU_GROUND when rolling', () => {
    const a = ball([0, 5, 0], [10, 0, 0], -50);
    integrate(a);
    expect(a.w.y).toBeCloseTo(-50 * (1 - PHYS.DT / PHYS.TAU_AIR), 12);
    const g = ball([0, r, 0], [10, 0, 0], -50, true);
    integrate(g);
    expect(g.w.y).toBeCloseTo(-50 * (1 - PHYS.DT / PHYS.TAU_GROUND), 12);
  });

  it('rolling: no vertical acceleration, MU_ROLL·G deceleration, never reverses', () => {
    const b = ball([0, r, 0], [3, 0, 4], 0, true);
    integrate(b);
    expect(b.v.y).toBe(0);
    const decel = PHYS.MU_ROLL * PHYS.G + PHYS.K_D * 25;
    expect(Math.sqrt(b.v.x ** 2 + b.v.z ** 2)).toBeCloseTo(5 - decel * PHYS.DT, 9);
    expect(b.v.z / b.v.x).toBeCloseTo(4 / 3, 12);
    // Slower than one step of rolling resistance: stops dead instead of reversing.
    const s = ball([0, r, 0], [0.001, 0, 0], 0, true);
    integrate(s);
    expect(s.v.x).toBe(0);
    expect(settleRolling(s)).toBe(true);
  });

  it('bounces with restitution and impact friction, and emits the impact speed', () => {
    const b = ball([0, r - 0.01, 0], [10, -8, 0]);
    const impact = collideGround(b);
    expect(impact).toBe(8);
    expect(b.p.y).toBe(r);
    expect(b.v.y).toBeCloseTo(0.55 * 8, 12);
    const k = Math.max(0.6, 1 - (0.45 * 1.55 * 8) / 10);
    expect(b.v.x).toBeCloseTo(10 * k, 12);
    expect(b.rolling).toBe(false);
  });

  it('keeps at least BOUNCE_KEEP_MIN of the horizontal speed on a steep landing', () => {
    const b = ball([0, r - 0.01, 0], [2, -10, 0], -40);
    collideGround(b);
    expect(b.v.x).toBeCloseTo(2 * PHYS.BOUNCE_KEEP_MIN, 12);
    expect(b.w.y).toBeCloseTo(-40 * PHYS.SPIN_KEEP_GROUND, 12);
  });

  it('starts rolling when the rebound is slower than V_SETTLE', () => {
    const b = ball([0, r - 0.001, 0], [5, -1, 0]);
    collideGround(b);
    expect(b.rolling).toBe(true);
    expect(b.v.y).toBe(0);
  });

  it('ignores the ground while above it or moving up', () => {
    const up = ball([0, r - 0.001, 0], [5, 2, 0]);
    expect(collideGround(up)).toBe(0);
    expect(up.p.y).toBe(r);
    expect(up.v.y).toBe(2);
    const high = ball([0, 1, 0], [5, -2, 0]);
    expect(collideGround(high)).toBe(0);
  });

  it('step() stops a slow rolling ball', () => {
    const b = ball([0, r, 0], [0.04, 0, 0], 0, true);
    expect(step(b).stopped).toBe(true);
    const f = ball([0, r, 0], [1, 0, 0], 0, true);
    expect(step(f).stopped).toBe(false);
  });
});
