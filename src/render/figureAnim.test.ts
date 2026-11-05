// Figure animation poses (M12.2): the kick, the keeper's catch and the possessor ring.
import { describe, expect, it } from 'vitest';
import {
  CATCH_SPREAD,
  CATCH_TIME,
  catchPose,
  catchReach,
  IDLE_POSE,
  KICK_DURATION,
  KICK_STRIKE_TIME,
  kickPose,
  relaxPose,
  RELAX_TIME,
  ringPulse,
  WINDUP_DURATION,
  windupPose,
} from './figureAnim';

const GK_REST = (100 * Math.PI) / 180;

describe('kick animation', () => {
  it('the wind-up draws the kicking leg back and holds it', () => {
    expect(windupPose(0).legR).toBeCloseTo(0, 6);
    const end = windupPose(WINDUP_DURATION);
    expect(end.legR).toBeLessThan(-0.5);
    expect(windupPose(WINDUP_DURATION * 5).legR).toBeCloseTo(end.legR, 9);
  });

  it('the strike starts from the pose it is given and swings the leg forward', () => {
    const from = windupPose(WINDUP_DURATION);
    expect(kickPose(0, from).legR).toBeCloseTo(from.legR, 9);
    expect(kickPose(KICK_STRIKE_TIME, from).legR).toBeGreaterThan(1);
    // Monotone forward swing through the strike.
    let prev = -Infinity;
    for (let t = 0; t <= KICK_STRIKE_TIME; t += 0.01) {
      const leg = kickPose(t, from).legR;
      expect(leg).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = leg;
    }
  });

  it('the opposite arm swings forward while the kicking-side arm goes back', () => {
    const p = kickPose(KICK_STRIKE_TIME);
    expect(p.armL).toBeGreaterThan(0.3);
    expect(p.armR).toBeLessThan(-0.3);
  });

  it('ends standing at KICK_DURATION and stays there', () => {
    for (const t of [KICK_DURATION, KICK_DURATION + 3]) {
      const p = kickPose(t);
      for (const [k, v] of Object.entries(IDLE_POSE)) expect(p[k as keyof typeof p]).toBeCloseTo(v, 9);
    }
  });

  it('is continuous (no jumps larger than a frame of motion)', () => {
    let prev = kickPose(0);
    for (let t = 1 / 60; t <= KICK_DURATION; t += 1 / 60) {
      const p = kickPose(t);
      expect(Math.abs(p.legR - prev.legR)).toBeLessThan(0.45);
      prev = p;
    }
  });
});

describe('keeper catch pose', () => {
  it('brings both arms forward to a small absolute spread and holds', () => {
    const end = catchPose(CATCH_TIME, 1.2, GK_REST);
    expect(end.armL).toBeGreaterThan(0.9);
    expect(end.armR).toBeCloseTo(end.armL, 9);
    expect(GK_REST + end.armLAbd).toBeCloseTo(CATCH_SPREAD, 9);
    const held = catchPose(CATCH_TIME * 10, 1.2, GK_REST);
    expect(held).toEqual(end);
  });

  it('starts from the resting arms', () => {
    const p = catchPose(0, 1.2, GK_REST);
    expect(p.armL).toBeCloseTo(0, 9);
    expect(p.armLAbd).toBeCloseTo(0, 9);
  });

  it('reaches higher for high balls and leans into low ones', () => {
    const low = catchReach(0.9);
    const high = catchReach(1.8);
    expect(high.swing).toBeGreaterThan(low.swing);
    expect(low.lean).toBeGreaterThan(high.lean);
    // Out-of-range heights are clamped.
    expect(catchReach(-3)).toEqual(low);
    expect(catchReach(9)).toEqual(high);
  });
});

describe('relax and ring', () => {
  it('relax eases a held pose back to standing', () => {
    const held = catchPose(1, 1.5, GK_REST);
    expect(relaxPose(0, held)).toEqual(held);
    const done = relaxPose(RELAX_TIME, held);
    for (const [k, v] of Object.entries(IDLE_POSE)) expect(done[k as keyof typeof done]).toBeCloseTo(v, 9);
  });

  it('the ring pulse stays gentle and visible', () => {
    for (let t = 0; t < 10; t += 0.1) {
      const { scale, opacity } = ringPulse(t);
      expect(scale).toBeGreaterThan(0.9);
      expect(scale).toBeLessThan(1.1);
      expect(opacity).toBeGreaterThan(0.5);
      expect(opacity).toBeLessThanOrEqual(1);
    }
  });
});
