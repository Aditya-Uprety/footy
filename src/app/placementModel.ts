// The draft UI's state for one pick (PLAN §2.3, M7.3–M7.4), kept free of
// DOM and Three.js so it can be unit-tested: tentative spots (place, move,
// remove, undo), the keeper toggle with the forced-keeper lock, live hover
// checks (rules a–d against confirmed players and the pick's other spots)
// and the pick-level issues that block Confirm (count, keeper, guard).
import { gkForced, pickInfo, spotsToPlayers, spotViolations, teamHasGk, validateSpots } from '../game/draft';
import type { GameState, PlayerSpot, SpotInput, Team, Violation } from '../game/types';
import { derivePitch, type Pitch } from '../shared/pitch';

export type PickState = Pick<GameState, 'settings' | 'pick' | 'players'>;

export interface GkStatus {
  /** The team already has a keeper (confirmed or tentative): the toggle is off and disabled. */
  has: boolean;
  /** §2.3.3: this pick must include the keeper. */
  forced: boolean;
  /** The next spot must be the keeper (forced, and only one slot is left). */
  locked: boolean;
  /** The next spot placed will be a keeper. */
  next: boolean;
  /** The toggle can be flipped. */
  toggleable: boolean;
}

export interface PlacementModel {
  readonly team: Team;
  readonly pitch: Pitch;
  /** Players this pick places. */
  readonly count: number;
  readonly spots: readonly SpotInput[];
  /** Spots still to place in this pick. */
  readonly remaining: number;
  /** The keeper toggle as the user set it. */
  readonly gkMode: boolean;
  gk(): GkStatus;
  /** Flips the keeper toggle (no-op unless toggleable). Returns the new value. */
  toggleGk(): boolean;
  /** Rules a–d for a spot at (x, z); `moving` = index of the spot being dragged (ignored as a neighbour, keeps its keeper flag). */
  check(x: number, z: number, moving?: number): Violation[];
  /** Adds a spot (as a keeper when gk().next). Returns the violations; empty = placed. */
  add(x: number, z: number): Violation[];
  /** Moves spot i; returns the violations (empty = moved). */
  move(i: number, x: number, z: number): Violation[];
  remove(i: number): void;
  /** Removes the last spot. */
  undo(): void;
  clear(): void;
  /** The tentative spot whose center is within `radius` of (x, z) (closest first), or -1. */
  spotAt(x: number, z: number, radius: number): number;
  /** What blocks Confirm now; empty = ready. */
  issues(): Violation[];
  /** The players the tentative spots would become (ids and shirt numbers for display). */
  preview(): PlayerSpot[];
}

export function createPlacementModel(state: PickState, team: Team): PlacementModel {
  const info = pickInfo(state.pick);
  if (!info || info.team !== team) throw new Error('createPlacementModel: not this team’s pick');
  const pitch = derivePitch(state.settings);
  const count = info.count;
  const spots: SpotInput[] = [];
  let gkMode = false;

  const confirmedGk = teamHasGk(state.players, team);
  const forced = gkForced(state, team);
  const standing = state.players.map((p) => ({ team: p.team, x: p.x, z: p.z }));

  function gk(): GkStatus {
    const has = confirmedGk || spots.some((s) => s.gk);
    const locked = forced && !has && count - spots.length === 1;
    return { has, forced, locked, next: !has && (gkMode || locked), toggleable: !has && !locked && spots.length < count };
  }

  function check(x: number, z: number, moving = -1): Violation[] {
    const isGk = moving >= 0 ? (spots[moving]?.gk ?? false) : gk().next;
    const others = spots.filter((_, j) => j !== moving).map((s) => ({ team, x: s.x, z: s.z }));
    return spotViolations(pitch, state.settings, [...standing, ...others], team, { x, z, gk: isGk });
  }

  const model: PlacementModel = {
    team,
    pitch,
    count,
    get spots() {
      return spots;
    },
    get remaining() {
      return count - spots.length;
    },
    get gkMode() {
      return gkMode;
    },
    gk,
    toggleGk() {
      if (gk().toggleable) gkMode = !gkMode;
      return gkMode;
    },
    check,
    add(x, z) {
      if (spots.length >= count) return [{ spot: -1, code: 'count', message: `This pick places ${count} player${count === 1 ? '' : 's'}` }];
      const v = check(x, z);
      if (v.length) return v;
      const isGk = gk().next;
      spots.push({ x, z, gk: isGk });
      if (isGk) gkMode = false;
      return [];
    },
    move(i, x, z) {
      const s = spots[i];
      if (!s) return [];
      const v = check(x, z, i);
      if (v.length === 0) spots[i] = { ...s, x, z };
      return v;
    },
    remove(i) {
      if (i >= 0 && i < spots.length) spots.splice(i, 1);
    },
    undo() {
      spots.pop();
    },
    clear() {
      spots.length = 0;
      gkMode = false;
    },
    spotAt(x, z, radius) {
      let best = -1;
      let bestD = radius;
      spots.forEach((s, i) => {
        const d = Math.sqrt((s.x - x) ** 2 + (s.z - z) ** 2);
        if (d <= bestD) {
          bestD = d;
          best = i;
        }
      });
      return best;
    },
    issues() {
      if (spots.length < count) {
        const n = count - spots.length;
        return [{ spot: -1, code: 'count', message: `Place ${n} more player${n === 1 ? '' : 's'}` }];
      }
      return validateSpots(state, team, spots);
    },
    preview() {
      return spotsToPlayers(state.players, team, spots);
    },
  };
  return model;
}
