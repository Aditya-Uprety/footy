// Collision primitives and responses (PLAN M3.2, §5.7).
import { describe, expect, it } from 'vitest';
import { HITBOX, PHYS } from './constants';
import { capsuleContact, graceOver, netContact, newContact, playerContact, respond, respondNet } from './collide';
import type { BallState } from './types';
import type { Capsule, Hitbox, NetRect } from './world';

const r = PHYS.BALL_R;
const ball = (x: number, y: number, z: number, vx = 0, vy = 0, vz = 0): BallState => ({
  p: { x, y, z },
  v: { x: vx, y: vy, z: vz },
  w: { x: 0, y: 10, z: 0 },
  rolling: false,
});
const outfield: Hitbox = { id: 1, team: 0, gk: false, x: 0, z: 0, ...HITBOX.OUTFIELD };

describe('player hitbox (§5.7)', () => {
  it('uses a horizontal normal below the cylinder top', () => {
    const n = newContact();
    expect(playerContact(ball(-0.45, 1, 0), outfield, r, n)).toBe(true);
    expect(n.nx).toBeCloseTo(-1, 12);
    expect(n.ny).toBe(0);
    expect(n.delta).toBeCloseTo(0.4 + r - 0.45, 12);
  });

  it('uses the hemisphere above HC (radial from (x, HC, z))', () => {
    const n = newContact();
    const b = ball(0.3, HITBOX.OUTFIELD.HC + 0.3, 0);
    expect(playerContact(b, outfield, r, n)).toBe(true);
    expect(n.nx).toBeCloseTo(Math.SQRT1_2, 12);
    expect(n.ny).toBeCloseTo(Math.SQRT1_2, 12);
    // Just above the top: no contact.
    expect(playerContact(ball(0, 1.85 + r + 1e-6, 0), outfield, r, n)).toBe(false);
    expect(playerContact(ball(0, 1.85 + r - 1e-3, 0), outfield, r, n)).toBe(true);
  });

  it('misses beyond R + r', () => {
    expect(playerContact(ball(0.4 + r + 1e-6, 0.11, 0), outfield, r, newContact())).toBe(false);
  });

  it('handles a degenerate center hit with n = −v̂', () => {
    const n = newContact();
    expect(playerContact(ball(0, 1, 0, 3, 0, 4), outfield, r, n)).toBe(true);
    expect([n.nx, n.ny, n.nz]).toEqual([-0.6, -0, -0.8]);
    expect(playerContact(ball(0, 1, 0), outfield, r, n)).toBe(true);
    expect([n.nx, n.ny, n.nz]).toEqual([0, 1, 0]);
  });
});

describe('generic response (§5.7)', () => {
  it('head-on: rebound speed = e × impact, pushed out, spin kept by k', () => {
    const b = ball(-0.45, 1, 0, 10, 0, 0);
    const n = newContact();
    playerContact(b, outfield, r, n);
    const impact = respond(b, n, PHYS.E_PLAYER, PHYS.MU_PLAYER, PHYS.SPIN_KEEP_PLAYER);
    expect(impact).toBeCloseTo(10, 12);
    expect(b.v.x).toBeCloseTo(-PHYS.E_PLAYER * 10, 12);
    expect(b.v.z).toBe(0);
    expect(b.p.x).toBeCloseTo(-(0.4 + r), 12);
    expect(b.w.y).toBeCloseTo(10 * PHYS.SPIN_KEEP_PLAYER, 12);
  });

  it('glancing: the tangential part survives (reduced by friction), the ball turns away from the obstacle', () => {
    const b = ball(-0.3, 1, -0.3, 10, 0, 0); // contact normal points to −x −z
    const n = newContact();
    playerContact(b, outfield, r, n);
    respond(b, n, PHYS.E_PLAYER, PHYS.MU_PLAYER, PHYS.SPIN_KEEP_PLAYER);
    expect(b.v.z).toBeLessThan(0);
    expect(Math.hypot(b.v.x, b.v.z)).toBeLessThan(10);
  });

  it('only pushes out (no impact) when already separating', () => {
    const b = ball(-0.45, 1, 0, -2, 0, 0);
    const n = newContact();
    playerContact(b, outfield, r, n);
    expect(respond(b, n, PHYS.E_PLAYER, PHYS.MU_PLAYER, PHYS.SPIN_KEEP_PLAYER)).toBe(0);
    expect(b.v.x).toBe(-2);
    expect(b.w.y).toBe(10);
  });
});

describe('capsule (§5.7)', () => {
  const post: Capsule = { kind: 'post', goalOf: 1, a: { x: 0, y: 0, z: 0 }, ab: { x: 0, y: 2.5, z: 0 }, ab2: 6.25, r: 0.06 };

  it('measures to the closest point on the segment, clamped to the ends', () => {
    const n = newContact();
    expect(capsuleContact(ball(-0.1, 1.2, 0), post, r, n)).toBe(true);
    expect([n.nx, n.ny, n.nz]).toEqual([-1, 0, 0]);
    expect(n.delta).toBeCloseTo(0.07, 12);
    // Above the top: radial from the end point.
    expect(capsuleContact(ball(0, 2.5 + 0.16, 0), post, r, n)).toBe(true);
    expect(n.ny).toBeCloseTo(1, 12);
    expect(capsuleContact(ball(0, 2.5 + 0.18, 0), post, r, n)).toBe(false);
  });
});

describe('net rectangle (§5.7)', () => {
  const net: NetRect = {
    name: 'back',
    goalOf: 1,
    o: { x: 10, y: 1.25, z: 0 },
    m: { x: 1, y: 0, z: 0 },
    u: { x: 0, y: 0, z: 1 },
    U: 3.72,
    w: { x: 0, y: 1, z: 0 },
    V: 1.25,
  };

  it('touching from either side pushes the ball back to its own side', () => {
    const n = newContact();
    const b = ball(9.95, 1, 0, 5, 0, 0);
    expect(netContact(b, { x: 9.9, y: 1, z: 0 }, net, r, n)).toBe(true);
    expect(n.nx).toBe(-1);
    const b2 = ball(10.05, 1, 0, -5, 0, 0);
    expect(netContact(b2, { x: 10.1, y: 1, z: 0 }, net, r, n)).toBe(true);
    expect(n.nx).toBe(1);
  });

  it('catches a ball that passed through the plane within one step', () => {
    const n = newContact();
    const b = ball(10.3, 1, 0, 30, 0, 0);
    expect(netContact(b, { x: 9.8, y: 1, z: 0 }, net, r, n)).toBe(true);
    expect(n.nx).toBe(-1);
    expect(n.delta).toBeCloseTo(r + 0.3, 12);
    const impact = respondNet(b, n, PHYS);
    expect(impact).toBeCloseTo(30, 12);
    expect(b.p.x).toBeCloseTo(10 - r, 12);
    expect(b.v.x).toBeCloseTo(-PHYS.E_NET * 30, 12);
  });

  it('keeps NET_TANGENT_KEEP of the tangential velocity', () => {
    const n = newContact();
    const b = ball(9.95, 1, 0, 4, 1, 2);
    netContact(b, { x: 9.9, y: 1, z: 0 }, net, r, n);
    respondNet(b, n, PHYS);
    expect(b.v.y).toBeCloseTo(PHYS.NET_TANGENT_KEEP * 1, 12);
    expect(b.v.z).toBeCloseTo(PHYS.NET_TANGENT_KEEP * 2, 12);
  });

  it('ignores balls outside the rectangle or far from the plane', () => {
    const n = newContact();
    expect(netContact(ball(9.95, 1, 3.8, 5), { x: 9.9, y: 1, z: 3.8 }, net, r, n)).toBe(false);
    expect(netContact(ball(9.95, 2.6, 0, 5), { x: 9.9, y: 2.6, z: 0 }, net, r, n)).toBe(false);
    expect(netContact(ball(9.5, 1, 0, 5), { x: 9.4, y: 1, z: 0 }, net, r, n)).toBe(false);
  });
});

describe('kicker grace (§5.6)', () => {
  it('lasts until the ball is more than R + r + GRACE_DIST away horizontally', () => {
    const lim = 0.4 + r + PHYS.GRACE_DIST;
    expect(graceOver(ball(lim - 1e-6, 5, 0), outfield, PHYS)).toBe(false);
    expect(graceOver(ball(lim + 1e-6, 0.11, 0), outfield, PHYS)).toBe(true);
  });
});
