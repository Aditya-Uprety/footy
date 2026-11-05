import { describe, expect, it } from 'vitest';
import { FRAME_R, HITBOX, PHYS, deriveConstants } from './constants';

describe('sim constants (PLAN §5.3)', () => {
  it('derives AREA, K_D and K_M from the base values', () => {
    expect(PHYS.AREA).toBeCloseTo(0.03801, 5);
    expect(PHYS.K_D).toBeCloseTo(0.01354, 5);
    expect(PHYS.K_M).toBeCloseTo(0.00596, 5);
    expect(PHYS.LOFT_MAX).toBeCloseTo((55 * Math.PI) / 180, 12);
  });

  it('re-derives after an edit (Physics Lab)', () => {
    const c = deriveConstants({ ...PHYS, CD: 0.5 });
    expect(c.K_D).toBeCloseTo(2 * PHYS.K_D, 12);
    expect(c.K_M).toBe(PHYS.K_M);
  });

  it('keeps the step small enough that the ball never tunnels through a post (§3.1)', () => {
    // Thinnest obstacle: post + ball = 2·(0.06 + 0.11) = 0.34 m; max travel per step ≈ 0.13 m.
    expect(PHYS.V_MAX * PHYS.DT).toBeLessThan(2 * (PHYS.BALL_R + FRAME_R));
    expect(HITBOX.OUTFIELD.HC + HITBOX.OUTFIELD.R).toBeCloseTo(1.85, 12);
    expect(HITBOX.GK.HC + HITBOX.GK.R).toBeCloseTo(2.3, 12);
  });
});
