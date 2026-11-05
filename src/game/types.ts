// PURE. Game state, intents and friends (PLAN §7). Team, KickInput, Touch and
// Outcome come from sim/types so the rules and physics layers can't drift.

import type { KickInput, Outcome, Team, Touch } from '../sim/types';
import type { Settings } from './settings';

export type { KickInput, Outcome, Team, Touch, Settings };

/** 0 = Player 1 / online host, 1 = Player 2 / online guest. */
export type Seat = 0 | 1;

export type RestartKind = 'kickoff' | 'throwin' | 'corner' | 'goalkick' | 'catch' | 'open';

/** A placed player. GK shirt 1, outfield 2–11 in placement order. Ids are 1-based, in placement order. */
export interface PlayerSpot {
  id: number;
  team: Team;
  x: number;
  z: number;
  gk: boolean;
  shirt: number;
}

/** A spot proposed in a pick (before it becomes a PlayerSpot). */
export interface SpotInput {
  x: number;
  z: number;
  gk: boolean;
}

/** Who is about to kick: a placed player, or a ghost taker whose (x, y, z) is the ball spot. */
export type Kicker = { kind: 'player'; playerId: number } | { kind: 'ghost'; x: number; y: number; z: number };

export interface Possession {
  team: Team;
  kicker: Kicker;
  restart: RestartKind;
}

export type Phase = 'toss' | 'placement' | 'play' | 'fulltime';

export interface LastKick {
  turnId: number;
  outcome: Outcome;
  /** The restart awarded for the next possession. */
  awarded: RestartKind;
  /** The team that took the kick. */
  team: Team;
  /** True when a goal was scored but didn't count (straight from a throw-in, §2.6.1). */
  disallowed?: boolean;
}

export interface GameState {
  /** +1 on every change. */
  rev: number;
  phase: Phase;
  settings: Settings;
  seatNames: [string, string];
  toss: { winner: Seat; teamOfSeat: [Team, Team] | null };
  /** 0..12 (12 = draft complete). */
  pick: number;
  /** Ids in placement order. */
  players: PlayerSpot[];
  /** Goals for [Team A, Team B]. */
  score: [number, number];
  kicksTaken: number;
  /** The client shows the half-time overlay when this flips. */
  half: 1 | 2;
  possession: Possession | null;
  /** +1 per new possession. */
  turnId: number;
  last: LastKick | null;
  rematchVotes: [boolean, boolean];
}

export type Intent =
  | { type: 'tossChoice'; role: 'A' | 'B' }
  | { type: 'place'; pick: number; spots: SpotInput[] }
  | { type: 'kick'; turnId: number; input: KickInput; auto: boolean }
  | { type: 'rematch' };

export type IntentType = Intent['type'];

/** A broken placement rule (§2.3.4), with a message the UI can show as-is. */
export interface Violation {
  /** Index into the proposed spots; -1 for pick-level problems. */
  spot: number;
  code:
    | 'count'
    | 'notFinite'
    | 'bounds'
    | 'centerCircle'
    | 'gkBox'
    | 'teammate'
    | 'opponent'
    | 'gkCount'
    | 'gkForced'
    | 'gkGuard';
  message: string;
}

export function otherTeam(t: Team): Team {
  return t === 0 ? 1 : 0;
}

export function otherSeat(s: Seat): Seat {
  return s === 0 ? 1 : 0;
}

export const TEAM_LABEL: Readonly<Record<Team, string>> = Object.freeze({ 0: 'Team A', 1: 'Team B' });
