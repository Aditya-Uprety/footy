import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../game/settings';
import { HITBOX, PHYS } from './constants';
import {
  capKickInput,
  cornerSpot,
  initialBallState,
  kickDirection,
  kickRight,
  kickSpeed,
  kickStart,
  kickoffSpot,
  throwInSpot,
} from './kick';
import type { KickOrigin } from './types';

const r = PHYS.BALL_R;
const center: KickOrigin = { kind: 'ghost', ...kickoffSpot() };

describe('kick model (PLAN §5.6)', () => {
  it('maps power to V_MIN..V_MAX', () => {
    expect(kickSpeed(0)).toBe(3);
    expect(kickSpeed(1)).toBe(32);
    expect(kickSpeed(0.25)).toBeCloseTo(10.25, 12);
  });

  it('clamps sliders, zeroes non-finite numbers and applies throw-in caps', () => {
    expect(capKickInput({ yaw: 1, power: 2, curve: -3, loft: -1 })).toEqual({ yaw: 1, power: 1, curve: -1, loft: 0 });
    expect(capKickInput({ yaw: NaN, power: Infinity, curve: NaN, loft: 0.5 })).toEqual({
      yaw: 0,
      power: 0,
      curve: 0,
      loft: 0.5,
    });
    expect(capKickInput({ yaw: 0, power: 0.9, curve: 0.8, loft: 0.3 }, { throwIn: true })).toEqual({
      yaw: 0,
      power: 0.45,
      curve: 0,
      loft: 0.3,
    });
    // Below the cap, power is untouched.
    expect(capKickInput({ yaw: 0, power: 0.2, curve: 0, loft: 0 }, { throwIn: true }).power).toBe(0.2);
  });

  it('uses d̂ = (cos θ, 0, sin θ) and r̂ = d̂ × ŷ', () => {
    const d = kickDirection(0);
    expect([d.x, d.y, d.z]).toEqual([1, 0, 0]);
    const right = kickRight(0);
    expect(right.x).toBeCloseTo(0, 15);
    expect(right.z).toBe(1); // facing +x, right is +z
    const t = 0.7;
    const dd = kickDirection(t);
    const rr = kickRight(t);
    // r̂ = d̂ × ŷ = (−d.z, 0, d.x)
    expect(rr.x).toBeCloseTo(-dd.z, 15);
    expect(rr.z).toBeCloseTo(dd.x, 15);
  });

  it('builds velocity from speed and loft, spin from curve', () => {
    const b = initialBallState({ yaw: Math.PI / 2, power: 1, curve: 0.5, loft: 1 }, center);
    const a = PHYS.LOFT_MAX;
    expect(b.v.x).toBeCloseTo(0, 12);
    expect(b.v.y).toBeCloseTo(32 * Math.sin(a), 12);
    expect(b.v.z).toBeCloseTo(32 * Math.cos(a), 12);
    expect(b.w).toEqual({ x: 0, y: -25, z: 0 });
    expect(b.rolling).toBe(false);
  });

  it('starts rolling only for a zero-loft kick from the ground', () => {
    expect(initialBallState({ yaw: 0, power: 0.5, curve: 0, loft: 0 }, center).rolling).toBe(true);
    expect(initialBallState({ yaw: 0, power: 0.5, curve: 0, loft: 0.01 }, center).rolling).toBe(false);
    const throwIn: KickOrigin = { kind: 'ghost', ...throwInSpot(DEFAULT_SETTINGS, 0, 1) };
    expect(initialBallState({ yaw: -Math.PI / 2, power: 0.3, curve: 0, loft: 0 }, throwIn).rolling).toBe(false);
  });

  it('puts the ball just outside a player kicker along d̂', () => {
    const yaw = 2.1;
    const out: KickOrigin = { kind: 'player', playerId: 3, team: 0, x: 10, z: -5, gk: false };
    const p = kickStart(out, yaw);
    const off = HITBOX.OUTFIELD.R + r + PHYS.KICK_GAP;
    expect(p.x).toBeCloseTo(10 + Math.cos(yaw) * off, 12);
    expect(p.z).toBeCloseTo(-5 + Math.sin(yaw) * off, 12);
    expect(p.y).toBe(r);
    const gk: KickOrigin = { ...out, gk: true };
    const pg = kickStart(gk, 0);
    expect(pg.x).toBeCloseTo(10 + HITBOX.GK.R + r + PHYS.KICK_GAP, 12);
  });

  it('places ghost-taker balls for kickoff, corners and throw-ins (§5.6)', () => {
    const s = DEFAULT_SETTINGS;
    expect(kickoffSpot()).toEqual({ x: 0, y: r, z: 0 });
    expect(cornerSpot(s, 1, -1)).toEqual({ x: s.pitchLength / 2 - 0.5, y: r, z: -(s.pitchWidth / 2 - 0.5) });
    expect(cornerSpot(s, -1, 1)).toEqual({ x: -(s.pitchLength / 2 - 0.5), y: r, z: s.pitchWidth / 2 - 0.5 });
    const t = throwInSpot(s, 20, -1);
    expect(t).toEqual({ x: 20, y: PHYS.THROW_HEIGHT, z: -(s.pitchWidth / 2 - r) });
    // Exit x is clamped to ±(L/2 − 1).
    expect(throwInSpot(s, 60, 1).x).toBe(s.pitchLength / 2 - 1);
    expect(throwInSpot(s, -60, 1).x).toBe(-(s.pitchLength / 2 - 1));
  });
});
