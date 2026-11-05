// PURE. The placement phase (PLAN §2.3): snake-draft schedule, spot
// validation with readable reasons, forced keeper, keeper feasibility guard,
// and random legal fills (placement timer expiry, ?autoplace).

import { derivePitch, rectContains, type Pitch } from '../shared/pitch';
import type { Rng } from '../shared/rng';
import { HITBOX } from '../sim/constants';
import type { Settings } from './settings';
import { otherTeam, type GameState, type PlayerSpot, type SpotInput, type Team, type Violation } from './types';

export const PLAYERS_PER_TEAM = 11;

/** §2.3.1: A1, B2, A2, B2, A2, B2, A2, B2, A2, B2, A2, B1 (team 0 = A, 1 = B). */
export const DRAFT_SCHEDULE: readonly { team: Team; count: number }[] = Object.freeze(
  [1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1].map((count, i) => Object.freeze({ team: (i % 2) as Team, count })),
);

export const PICK_COUNT = DRAFT_SCHEDULE.length;

/** Grid step for the keeper feasibility guard, m (§2.3.4e). */
export const GK_GUARD_GRID = 0.25;

/** The team and number of players for pick `pick` (0-based), or null once the draft is complete. */
export function pickInfo(pick: number): { team: Team; count: number } | null {
  return DRAFT_SCHEDULE[pick] ?? null;
}

/** Slots `team` still has to fill from pick `pick` on (including that pick). */
export function slotsLeftFrom(pick: number, team: Team): number {
  let n = 0;
  for (let i = pick; i < PICK_COUNT; i++) if (DRAFT_SCHEDULE[i]!.team === team) n += DRAFT_SCHEDULE[i]!.count;
  return n;
}

export function teamHasGk(players: readonly PlayerSpot[], team: Team): boolean {
  return players.some((p) => p.team === team && p.gk);
}

/**
 * §2.3.3: when this is the team's last pick and it has no keeper yet, the
 * pick must include exactly one keeper (its last slot is forced to be the GK).
 */
export function gkForced(state: Pick<GameState, 'pick' | 'players'>, team: Team): boolean {
  const info = pickInfo(state.pick);
  if (!info || info.team !== team) return false;
  return !teamHasGk(state.players, team) && slotsLeftFrom(state.pick, team) === info.count;
}

type Spacing = Pick<Settings, 'minTeammateDist' | 'minOpponentDist'>;
type Placed = { team: Team; x: number; z: number };

function fmt(m: number): string {
  return `${Math.round(m * 10) / 10} m`;
}

/**
 * Rules a–d of §2.3.4 for one spot against the players already standing
 * (confirmed players plus other tentative spots of this pick). Returns every
 * broken rule; the UI shows the first message on hover.
 */
export function spotViolations(
  pitch: Pitch,
  spacing: Spacing,
  placed: readonly Placed[],
  team: Team,
  spot: SpotInput,
  index = -1,
): Violation[] {
  const out: Violation[] = [];
  const v = (code: Violation['code'], message: string): void => {
    out.push({ spot: index, code, message });
  };
  if (!Number.isFinite(spot.x) || !Number.isFinite(spot.z)) {
    v('notFinite', 'Invalid position');
    return out;
  }
  const b = pitch.placementBounds;
  if (!rectContains(b, spot.x, spot.z)) {
    v('bounds', `Too close to a line (stay ${fmt(pitch.halfLength - b.xMax)} inside the pitch)`);
  }
  const R = spot.gk ? HITBOX.GK.R : HITBOX.OUTFIELD.R;
  if (Math.sqrt(spot.x * spot.x + spot.z * spot.z) < pitch.centerCircleR + R) {
    v('centerCircle', 'Inside the center circle');
  }
  if (spot.gk && !rectContains(pitch.ends[team].penaltyArea, spot.x, spot.z)) {
    v('gkBox', 'The keeper must stand in your own penalty area');
  }
  let nearMate = Infinity;
  let nearOpp = Infinity;
  for (const p of placed) {
    const dx = p.x - spot.x;
    const dz = p.z - spot.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (p.team === team) nearMate = Math.min(nearMate, d);
    else nearOpp = Math.min(nearOpp, d);
  }
  if (nearMate < spacing.minTeammateDist) {
    v('teammate', `Too close to a teammate (${fmt(nearMate)}, needs ${fmt(spacing.minTeammateDist)})`);
  }
  if (nearOpp < spacing.minOpponentDist) {
    v('opponent', `Too close to an opponent (${fmt(nearOpp)}, needs ${fmt(spacing.minOpponentDist)})`);
  }
  return out;
}

/** True when the spot breaks none of rules a–d. */
export function spotLegal(pitch: Pitch, spacing: Spacing, placed: readonly Placed[], team: Team, spot: SpotInput): boolean {
  return spotViolations(pitch, spacing, placed, team, spot).length === 0;
}

/**
 * §2.3.4e: does `team` still have a legal keeper spot in its own penalty
 * area, given the players standing? Scans a GK_GUARD_GRID grid over the box
 * (clipped to the placement bounds).
 */
export function gkSpotExists(pitch: Pitch, spacing: Spacing, placed: readonly Placed[], team: Team): boolean {
  return findGkSpot(pitch, spacing, placed, team) !== null;
}

/** The first legal keeper spot on the guard grid, scanning from the goal line outward; null if none. */
export function findGkSpot(pitch: Pitch, spacing: Spacing, placed: readonly Placed[], team: Team): SpotInput | null {
  const box = pitch.ends[team].penaltyArea;
  const b = pitch.placementBounds;
  const xMin = Math.max(box.xMin, b.xMin);
  const xMax = Math.min(box.xMax, b.xMax);
  const zMin = Math.max(box.zMin, b.zMin);
  const zMax = Math.min(box.zMax, b.zMax);
  const g = GK_GUARD_GRID;
  const nx = Math.floor((xMax - xMin) / g + 1e-9);
  const nz = Math.floor((zMax - zMin) / g + 1e-9);
  const minR = pitch.centerCircleR + HITBOX.GK.R;
  const X2 = spacing.minTeammateDist * spacing.minTeammateDist;
  const Y2 = spacing.minOpponentDist * spacing.minOpponentDist;
  const fromLine = pitch.ends[team].side < 0;
  for (let ix = 0; ix <= nx; ix++) {
    const x = fromLine ? xMin + ix * g : xMax - ix * g;
    for (let iz = 0; iz <= nz; iz++) {
      const z = zMin + iz * g;
      if (x * x + z * z < minR * minR) continue;
      let ok = true;
      for (const p of placed) {
        const dx = p.x - x;
        const dz = p.z - z;
        if (dx * dx + dz * dz < (p.team === team ? X2 : Y2)) {
          ok = false;
          break;
        }
      }
      if (ok) return { x, z, gk: true };
    }
  }
  return null;
}

/**
 * Validates a whole pick for `team` (§2.3.3–4): the right number of spots,
 * rules a–d for each spot (against confirmed players and the pick's other
 * spots), at most one keeper per team, the forced keeper on the team's last
 * pick, and the keeper feasibility guard for both teams. Returns every
 * violation; empty = legal. Does not check the phase or whose turn it is.
 */
export function validateSpots(state: Pick<GameState, 'settings' | 'pick' | 'players'>, team: Team, spots: readonly SpotInput[]): Violation[] {
  const out: Violation[] = [];
  const info = pickInfo(state.pick);
  if (!info) return [{ spot: -1, code: 'count', message: 'The draft is complete' }];
  if (spots.length !== info.count) {
    out.push({ spot: -1, code: 'count', message: `Place exactly ${info.count} player${info.count === 1 ? '' : 's'}` });
    if (spots.length === 0 || spots.length > info.count) return out;
  }
  const pitch = derivePitch(state.settings);
  const spacing = state.settings;

  const standing: Placed[] = state.players.map((p) => ({ team: p.team, x: p.x, z: p.z }));
  spots.forEach((spot, i) => {
    const others = spots.filter((_, j) => j !== i).map((s) => ({ team, x: s.x, z: s.z }));
    out.push(...spotViolations(pitch, spacing, [...standing, ...others], team, spot, i));
  });
  if (out.some((v) => v.code === 'notFinite')) return out;

  const hadGk = teamHasGk(state.players, team);
  const newGks = spots.filter((s) => s.gk).length;
  if (newGks + (hadGk ? 1 : 0) > 1) {
    out.push({ spot: -1, code: 'gkCount', message: 'Only one keeper per team' });
  }
  if (gkForced(state, team) && newGks === 0) {
    out.push({ spot: -1, code: 'gkForced', message: 'Your last player must be the keeper' });
  }

  // §2.3.4e: after this pick, every team without a keeper must still have a legal keeper spot.
  if (out.length === 0) {
    const after: Placed[] = [...standing, ...spots.map((s) => ({ team, x: s.x, z: s.z }))];
    for (const t of [team, otherTeam(team)] as Team[]) {
      const hasGk = t === team ? hadGk || newGks > 0 : teamHasGk(state.players, t);
      if (hasGk) continue;
      if (!gkSpotExists(pitch, spacing, after, t)) {
        const whose = t === team ? 'your' : "the other team's";
        out.push({ spot: -1, code: 'gkGuard', message: `This would leave ${whose} keeper no legal spot in the box` });
      }
    }
  }
  return out;
}

/** The PlayerSpots a legal pick adds (ids and shirts continue the placement order). */
export function spotsToPlayers(players: readonly PlayerSpot[], team: Team, spots: readonly SpotInput[]): PlayerSpot[] {
  let id = players.reduce((m, p) => Math.max(m, p.id), 0);
  let shirt = players.filter((p) => p.team === team && !p.gk).length + 2;
  return spots.map((s) => ({ id: ++id, team, x: s.x, z: s.z, gk: s.gk, shirt: s.gk ? 1 : shirt++ }));
}

/** Chance an auto-placed outfield spot is drawn from the team's own half (else anywhere). */
const OWN_HALF_BIAS = 0.7;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * A random legal pick for `team` at the current pick (placement-timer expiry,
 * ?autoplace). `keep` are spots the seat already placed (kept when they are
 * still legal together); the rest is filled at random. The keeper is placed
 * when forced, otherwise with probability 1 / (slots left), so it lands at a
 * random pick. Falls back to a grid keeper spot and full redraws; throws only
 * if no legal pick is found at all.
 */
export function randomPick(
  state: Pick<GameState, 'settings' | 'pick' | 'players'>,
  team: Team,
  rng: Rng,
  keep: readonly SpotInput[] = [],
): SpotInput[] {
  const info = pickInfo(state.pick);
  if (!info || info.team !== team) throw new Error('randomPick: not this team’s pick');
  const pitch = derivePitch(state.settings);
  const b = pitch.placementBounds;
  const standing: Placed[] = state.players.map((p) => ({ team: p.team, x: p.x, z: p.z }));
  const hadGk = teamHasGk(state.players, team);
  const forced = gkForced(state, team);
  const left = slotsLeftFrom(state.pick, team);

  for (let attempt = 0; attempt < 60; attempt++) {
    // Keep the seat's own spots on the first tries, then start over.
    const spots: SpotInput[] = attempt < 30 ? keep.slice(0, info.count).map((s) => ({ ...s })) : [];
    let haveGk = hadGk || spots.some((s) => s.gk);
    const wantGk = !haveGk && (forced || rng.next() < info.count / left);
    while (spots.length < info.count) {
      const placed = [...standing, ...spots.map((s) => ({ team, x: s.x, z: s.z }))];
      const gk = wantGk && !haveGk;
      let spot: SpotInput | null = null;
      for (let tries = 0; tries < 300 && !spot; tries++) {
        let cand: SpotInput;
        if (gk) {
          const box = pitch.ends[team].penaltyArea;
          cand = { gk: true, x: rng.range(Math.max(box.xMin, b.xMin), Math.min(box.xMax, b.xMax)), z: rng.range(-12, 12) };
        } else {
          const own = rng.next() < OWN_HALF_BIAS;
          const x = own ? (team === 0 ? rng.range(b.xMin, 0) : rng.range(0, b.xMax)) : rng.range(b.xMin, b.xMax);
          cand = { gk: false, x, z: rng.range(b.zMin, b.zMax) };
        }
        cand = { ...cand, x: round2(cand.x), z: round2(cand.z) };
        if (spotLegal(pitch, state.settings, placed, team, cand)) spot = cand;
      }
      if (!spot && gk) spot = findGkSpot(pitch, state.settings, placed, team);
      if (!spot) break;
      spots.push(spot);
      if (spot.gk) haveGk = true;
    }
    if (spots.length === info.count && validateSpots(state, team, spots).length === 0) return spots;
  }
  throw new Error('randomPick: no legal pick found');
}
