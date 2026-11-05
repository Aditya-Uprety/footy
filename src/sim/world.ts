// PURE. The static world a kick flies through (PLAN §5.2, §5.7):
// player hitboxes, goal frames (posts + crossbar capsules) and net rectangles,
// all derived from the pitch geometry and the placed players.
//
// buildWorld runs once per kick; the step loop in simulate.ts only reads it.

import type { Pitch } from '../shared/pitch';
import { HITBOX } from './constants';
import type { Team, Vec3 } from './types';

/** What buildWorld needs from a placed player (game PlayerSpot satisfies this). */
export interface WorldPlayer {
  id: number;
  team: Team;
  x: number;
  z: number;
  gk: boolean;
}

/** Who kicks: only a player kicker has a hitbox that needs grace (§5.6). KickOrigin and game Kicker both fit. */
export type WorldKicker = { kind: 'player'; playerId: number } | { kind: 'ghost' } | null;

/**
 * Player hitbox (§5.2): vertical cylinder of radius R from y = 0 to HC,
 * capped by a hemisphere of radius R centered at (x, HC, z).
 */
export interface Hitbox {
  id: number;
  team: Team;
  /** Keeper: any contact is a catch (§2.5.3). */
  gk: boolean;
  x: number;
  z: number;
  R: number;
  HC: number;
}

/** Post or crossbar: a capsule around segment a→b (ab = b − a, ab2 = |ab|²). */
export interface Capsule {
  kind: 'post' | 'bar';
  /** The team defending this goal. */
  goalOf: Team;
  a: Vec3;
  ab: Vec3;
  ab2: number;
  r: number;
}

/**
 * Thin two-sided net rectangle (§5.7): unit normal m, center o, half-extent
 * U along unit u and V along unit w.
 */
export interface NetRect {
  name: 'back' | 'sideL' | 'sideR' | 'roof';
  goalOf: Team;
  o: Vec3;
  m: Vec3;
  u: Vec3;
  U: number;
  w: Vec3;
  V: number;
}

/** Rule-line geometry (outer edges, §2.2) used for goal/out detection (§5.8). */
export interface WorldLines {
  /** Goal lines at x = ±halfLength. */
  halfLength: number;
  /** Touchlines at z = ±halfWidth. */
  halfWidth: number;
  /** Inner post edges at |z| = goalHalfWidth (3.66). */
  goalHalfWidth: number;
  /** Crossbar underside (2.44). */
  goalHeight: number;
}

export interface World {
  hitboxes: Hitbox[];
  frame: Capsule[];
  nets: NetRect[];
  lines: WorldLines;
  /** Player id of the kicker (grace applies to its hitbox), or null for a ghost taker. */
  kickerId: number | null;
}

const X: Vec3 = Object.freeze({ x: 1, y: 0, z: 0 });
const Y: Vec3 = Object.freeze({ x: 0, y: 1, z: 0 });
const Z: Vec3 = Object.freeze({ x: 0, y: 0, z: 1 });

function capsule(kind: 'post' | 'bar', goalOf: Team, a: Vec3, b: Vec3, r: number): Capsule {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  return { kind, goalOf, a: { ...a }, ab, ab2: ab.x * ab.x + ab.y * ab.y + ab.z * ab.z, r };
}

export function hitboxFor(p: WorldPlayer): Hitbox {
  const shape = p.gk ? HITBOX.GK : HITBOX.OUTFIELD;
  return { id: p.id, team: p.team, gk: p.gk, x: p.x, z: p.z, R: shape.R, HC: shape.HC };
}

/**
 * Builds the world for one kick: hitboxes for every placed player, the two
 * goal frames and the four net rectangles per goal (§5.2):
 * back at x = ±(L/2 + 2.06); sides at z = ±3.72 from the goal line to the
 * back; roof at y = 2.50.
 */
export function buildWorld(pitch: Pitch, players: readonly WorldPlayer[], kicker: WorldKicker = null): World {
  const frame: Capsule[] = [];
  const nets: NetRect[] = [];
  for (const end of pitch.ends) {
    const g = end.goal;
    const t = end.team;
    frame.push(capsule('post', t, g.leftPost.a, g.leftPost.b, g.postRadius));
    frame.push(capsule('post', t, g.rightPost.a, g.rightPost.b, g.postRadius));
    frame.push(capsule('bar', t, g.crossbar.a, g.crossbar.b, g.postRadius));

    const lineX = end.goalLineX;
    const backX = g.netBackX;
    const midX = (lineX + backX) / 2;
    const halfDepth = Math.abs(backX - lineX) / 2;
    const top = g.postTop;
    const halfTop = top / 2;
    const zSide = g.postZ;
    nets.push({ name: 'back', goalOf: t, o: { x: backX, y: halfTop, z: 0 }, m: X, u: Z, U: zSide, w: Y, V: halfTop });
    nets.push({ name: 'sideL', goalOf: t, o: { x: midX, y: halfTop, z: -zSide }, m: Z, u: X, U: halfDepth, w: Y, V: halfTop });
    nets.push({ name: 'sideR', goalOf: t, o: { x: midX, y: halfTop, z: zSide }, m: Z, u: X, U: halfDepth, w: Y, V: halfTop });
    nets.push({ name: 'roof', goalOf: t, o: { x: midX, y: top, z: 0 }, m: Y, u: X, U: halfDepth, w: Z, V: zSide });
  }

  const g0 = pitch.ends[0].goal;
  return {
    hitboxes: players.map(hitboxFor),
    frame,
    nets,
    lines: {
      halfLength: pitch.halfLength,
      halfWidth: pitch.halfWidth,
      goalHalfWidth: g0.halfWidth,
      goalHeight: g0.height,
    },
    kickerId: kicker && kicker.kind === 'player' ? kicker.playerId : null,
  };
}
