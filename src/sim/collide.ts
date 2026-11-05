// PURE. Collision primitives and the generic contact response (PLAN §5.7).
//
// Each `*Contact` function only measures: it fills `out` with the contact
// normal n (unit, obstacle → ball) and penetration δ > 0 and returns true, or
// returns false. The `respond*` functions then push the ball out and change
// its velocity. Contacts reuse one scratch object, so the loop doesn't allocate.
//
// Determinism (§5.11): only + − × ÷ and Math.sqrt.

import type { PhysicsConstants } from './constants';
import type { BallState, Vec3 } from './types';
import type { Capsule, Hitbox, NetRect } from './world';

export interface Contact {
  nx: number;
  ny: number;
  nz: number;
  /** Penetration depth, m (> 0 when in contact). */
  delta: number;
}

export function newContact(): Contact {
  return { nx: 0, ny: 0, nz: 0, delta: 0 };
}

const EPS_D = 1e-9;

/** Normal for a degenerate contact (d < 1e-9): n = −v̂, or +ŷ when v = 0. */
function degenerateNormal(v: Vec3, out: Contact): void {
  const s = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (s > 1e-12) {
    out.nx = -v.x / s;
    out.ny = -v.y / s;
    out.nz = -v.z / s;
  } else {
    out.nx = 0;
    out.ny = 1;
    out.nz = 0;
  }
}

/**
 * Player hitbox (§5.7): below the cylinder top the normal is horizontal from
 * the axis; above it, radial from the hemisphere center (x, HC, z).
 * δ = R + r − d.
 */
export function playerContact(b: BallState, h: Hitbox, r: number, out: Contact): boolean {
  const reach = h.R + r;
  const dx = b.p.x - h.x;
  const dz = b.p.z - h.z;
  // Cheap reject on the horizontal box before any sqrt.
  if (dx > reach || dx < -reach || dz > reach || dz < -reach) return false;
  const dy = b.p.y > h.HC ? b.p.y - h.HC : 0;
  if (dy > reach) return false;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= reach * reach) return false;
  const d = Math.sqrt(d2);
  out.delta = reach - d;
  if (d < EPS_D) degenerateNormal(b.v, out);
  else {
    out.nx = dx / d;
    out.ny = dy / d;
    out.nz = dz / d;
  }
  return true;
}

/**
 * Capsule (post or bar): q = a + clamp(((p − a)·ab)/|ab|², 0, 1)·ab;
 * n = (p − q)/|p − q|; δ = r + capsule radius − |p − q|.
 */
export function capsuleContact(b: BallState, cap: Capsule, r: number, out: Contact): boolean {
  const reach = cap.r + r;
  const px = b.p.x - cap.a.x;
  const py = b.p.y - cap.a.y;
  const pz = b.p.z - cap.a.z;
  let s = (px * cap.ab.x + py * cap.ab.y + pz * cap.ab.z) / cap.ab2;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  const dx = px - s * cap.ab.x;
  const dy = py - s * cap.ab.y;
  const dz = pz - s * cap.ab.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= reach * reach) return false;
  const d = Math.sqrt(d2);
  out.delta = reach - d;
  if (d < EPS_D) degenerateNormal(b.v, out);
  else {
    out.nx = dx / d;
    out.ny = dy / d;
    out.nz = dz / d;
  }
  return true;
}

/**
 * Two-sided net rectangle (§5.7). `p0` is the ball center at the start of the
 * step; the side it came from decides the normal, so a ball that passed
 * through the plane within one step is pushed back to its own side.
 *   s = (p − o)·m, s0 = (p0 − o)·m, side = s0 ≥ 0 ? +1 : −1
 *   contact if (|s| < r or sign(s) ≠ side) and the center projects inside the
 *   rectangle; then n = side·m, δ = r − side·s.
 */
export function netContact(b: BallState, p0: Vec3, net: NetRect, r: number, out: Contact): boolean {
  const ox = b.p.x - net.o.x;
  const oy = b.p.y - net.o.y;
  const oz = b.p.z - net.o.z;
  const s = ox * net.m.x + oy * net.m.y + oz * net.m.z;
  const s0 = (p0.x - net.o.x) * net.m.x + (p0.y - net.o.y) * net.m.y + (p0.z - net.o.z) * net.m.z;
  const side = s0 >= 0 ? 1 : -1;
  const crossed = side > 0 ? s < 0 : s >= 0;
  if (!(crossed || (s < r && s > -r))) return false;
  const pu = ox * net.u.x + oy * net.u.y + oz * net.u.z;
  if (pu > net.U || pu < -net.U) return false;
  const pw = ox * net.w.x + oy * net.w.y + oz * net.w.z;
  if (pw > net.V || pw < -net.V) return false;
  out.nx = side * net.m.x;
  out.ny = side * net.m.y;
  out.nz = side * net.m.z;
  out.delta = r - side * s;
  return true;
}

/**
 * Generic response (§5.7) for a player or frame contact:
 *   p += n·δ;  vn = v·n
 *   if vn < 0: vN = vn·n, vT = v − vN, jn = −(1+e)·vn,
 *              vT *= max(0, 1 − μ·jn/|vT|), v = −e·vN + vT, ω *= k
 * Returns the impact speed −vn (> 0), or 0 when the ball was already
 * separating (pushed out only, no impact).
 */
export function respond(b: BallState, n: Contact, e: number, mu: number, spinKeep: number): number {
  const p = b.p;
  const v = b.v;
  p.x += n.nx * n.delta;
  p.y += n.ny * n.delta;
  p.z += n.nz * n.delta;
  const vn = v.x * n.nx + v.y * n.ny + v.z * n.nz;
  if (vn >= 0) return 0;
  const vNx = vn * n.nx;
  const vNy = vn * n.ny;
  const vNz = vn * n.nz;
  let tx = v.x - vNx;
  let ty = v.y - vNy;
  let tz = v.z - vNz;
  const vt = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (vt > 0) {
    const jn = -(1 + e) * vn;
    let f = 1 - (mu * jn) / vt;
    if (f < 0) f = 0;
    tx *= f;
    ty *= f;
    tz *= f;
  }
  v.x = -e * vNx + tx;
  v.y = -e * vNy + ty;
  v.z = -e * vNz + tz;
  b.w.x *= spinKeep;
  b.w.y *= spinKeep;
  b.w.z *= spinKeep;
  return -vn;
}

/**
 * Net response (§5.7): push out, reflect the normal component with E_NET and
 * keep NET_TANGENT_KEEP of the tangential part. Spin is damped by the same
 * NET_TANGENT_KEEP (the plan leaves spin open; a net grabs the ball, so
 * leftover sidespin shouldn't keep curving it inside the goal).
 * Returns the impact speed, or 0 when already separating.
 */
export function respondNet(b: BallState, n: Contact, c: PhysicsConstants): number {
  const p = b.p;
  const v = b.v;
  p.x += n.nx * n.delta;
  p.y += n.ny * n.delta;
  p.z += n.nz * n.delta;
  const vn = v.x * n.nx + v.y * n.ny + v.z * n.nz;
  if (vn >= 0) return 0;
  const keep = c.NET_TANGENT_KEEP;
  const tx = v.x - vn * n.nx;
  const ty = v.y - vn * n.ny;
  const tz = v.z - vn * n.nz;
  const vnOut = -c.E_NET * vn;
  v.x = vnOut * n.nx + keep * tx;
  v.y = vnOut * n.ny + keep * ty;
  v.z = vnOut * n.nz + keep * tz;
  b.w.x *= keep;
  b.w.y *= keep;
  b.w.z *= keep;
  return -vn;
}

/**
 * Kicker grace (§5.6): the kicker's hitbox stays ignored while the ball's
 * horizontal distance from the kicker's axis is ≤ R + r + GRACE_DIST.
 * Returns true once the ball is beyond that (grace over for good).
 */
export function graceOver(b: BallState, h: Hitbox, c: PhysicsConstants): boolean {
  const dx = b.p.x - h.x;
  const dz = b.p.z - h.z;
  const lim = h.R + c.BALL_R + c.GRACE_DIST;
  return dx * dx + dz * dz > lim * lim;
}
