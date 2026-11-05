// PURE. Match rules (PLAN §2, §7): newMatch → toss/role → 12 picks → play
// (kick → resolveOutcome) → half-time → full-time → rematch.
//
// Every function takes a GameState and returns a NEW state (rev + 1); the
// input is never mutated. Illegal calls throw a RuleError whose `reason` the
// HostCore passes on to the seat (with the placement violations, if any).

import { derivePitch } from '../shared/pitch';
import type { Rng } from '../shared/rng';
import { simulateKick } from '../sim/simulate';
import type { KickCaps } from '../sim/kick';
import type { KickOrigin, KickResult } from '../sim/types';
import { buildWorld } from '../sim/world';
import { PICK_COUNT, pickInfo, spotsToPlayers, validateSpots } from './draft';
import { decideRestart, kickoffPossession } from './restarts';
import { halfTimeAfter, sanitizeSettings, type Settings } from './settings';
import {
  otherTeam,
  type GameState,
  type KickInput,
  type Outcome,
  type PlayerSpot,
  type Possession,
  type Seat,
  type SpotInput,
  type Team,
  type Violation,
} from './types';

/** Team A takes the opening kickoff (§2.1.2); the other team kicks off the second half (§2.7.2). */
export const OPENING_KICKOFF_TEAM: Team = 0;

export class RuleError extends Error {
  constructor(
    readonly reason: string,
    readonly violations?: Violation[],
  ) {
    super(reason);
    this.name = 'RuleError';
  }
}

function fail(reason: string, violations?: Violation[]): never {
  throw new RuleError(reason, violations);
}

/** A copy with rev + 1 and the given changes. */
function bump(s: GameState, changes: Partial<GameState>): GameState {
  return { ...s, ...changes, rev: s.rev + 1 };
}

/** Longest seat name, characters (§2.1.3: names are editable). */
export const NAME_MAX = 16;

/** Default seat names: "Player 1", "Player 2". */
export function defaultName(seat: Seat): string {
  return `Player ${seat + 1}`;
}

/**
 * A clean seat name: control characters removed, whitespace collapsed,
 * trimmed, at most NAME_MAX characters; `fallback` when nothing is left.
 */
export function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const clean = raw.replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  const chars = [...clean].slice(0, NAME_MAX).join('').trim();
  return chars || fallback;
}

/** A fresh match in the toss phase: the host RNG draws the toss winner (§2.1.2). */
export function newMatch(settings: Settings, names: [string, string], rng: Rng, rev = 0): GameState {
  return {
    rev,
    phase: 'toss',
    settings: sanitizeSettings(settings),
    seatNames: [sanitizeName(names[0], defaultName(0)), sanitizeName(names[1], defaultName(1))],
    toss: { winner: rng.int(2) as Seat, teamOfSeat: null },
    pick: 0,
    players: [],
    score: [0, 0],
    kicksTaken: 0,
    half: 1,
    possession: null,
    turnId: 0,
    last: null,
    rematchVotes: [false, false],
  };
}

/** The team a seat plays for (after the toss), or null. */
export function teamOfSeat(s: Pick<GameState, 'toss'>, seat: Seat): Team | null {
  return s.toss.teamOfSeat ? s.toss.teamOfSeat[seat] : null;
}

/** The seat playing `team` (after the toss), or null. */
export function seatOfTeam(s: Pick<GameState, 'toss'>, team: Team): Seat | null {
  const map = s.toss.teamOfSeat;
  if (!map) return null;
  return map[0] === team ? 0 : 1;
}

/** The seat that must act now (toss choice, pick, kick), or null (full-time: either seat may vote). */
export function activeSeat(s: GameState): Seat | null {
  switch (s.phase) {
    case 'toss':
      return s.toss.winner;
    case 'placement': {
      const info = pickInfo(s.pick);
      return info ? seatOfTeam(s, info.team) : null;
    }
    case 'play':
      return s.possession ? seatOfTeam(s, s.possession.team) : null;
    case 'fulltime':
      return null;
  }
}

/** §2.1.2: the toss winner picks Team A (first pick + kickoff) or Team B (last pick). */
export function chooseRole(s: GameState, seat: Seat, role: 'A' | 'B'): GameState {
  if (s.phase !== 'toss') fail('Not in the toss phase');
  if (seat !== s.toss.winner) fail('Only the toss winner chooses');
  if (role !== 'A' && role !== 'B') fail('Unknown role');
  const mine: Team = role === 'A' ? 0 : 1;
  const teamOfSeat: [Team, Team] = seat === 0 ? [mine, otherTeam(mine)] : [otherTeam(mine), mine];
  return bump(s, { phase: 'placement', toss: { winner: s.toss.winner, teamOfSeat }, pick: 0 });
}

/** Phase change after the draft: Team A kicks off, turn 1. */
function startPlay(s: GameState, players: PlayerSpot[]): GameState {
  return bump(s, {
    players,
    pick: PICK_COUNT,
    phase: 'play',
    possession: kickoffPossession(OPENING_KICKOFF_TEAM),
    turnId: 1,
    half: 1,
    kicksTaken: 0,
    score: [0, 0],
    last: null,
  });
}

/** §2.3: confirms the current pick for `team`. Throws with the violations if it isn't legal. */
export function applyPick(s: GameState, team: Team, spots: readonly SpotInput[]): GameState {
  if (s.phase !== 'placement') fail('Not in the placement phase');
  const info = pickInfo(s.pick);
  if (!info || info.team !== team) fail('Not your pick');
  const violations = validateSpots(s, team, spots);
  if (violations.length > 0) fail(violations[0]!.message, violations);
  const players = [...s.players, ...spotsToPlayers(s.players, team, spots)];
  if (s.pick + 1 >= PICK_COUNT) return startPlay(s, players);
  return bump(s, { players, pick: s.pick + 1 });
}

/** Restart caps for a possession: throw-ins cap power and lock curve (§2.6.3). */
export function kickCaps(p: Possession): KickCaps {
  return p.restart === 'throwin' ? { throwIn: true } : {};
}

/** The physics origin of the current kicker. */
export function kickOrigin(s: Pick<GameState, 'players'>, p: Possession): KickOrigin {
  const k = p.kicker;
  if (k.kind === 'ghost') return { kind: 'ghost', x: k.x, y: k.y, z: k.z };
  const spot = s.players.find((q) => q.id === k.playerId);
  if (!spot) fail(`Unknown kicker #${k.playerId}`);
  return { kind: 'player', playerId: spot.id, team: spot.team, x: spot.x, z: spot.z, gk: spot.gk };
}

/**
 * §2.4–2.6: `team` kicks with `input`. Simulates the kick in the current
 * world and resolves it. Returns the KickResult (for playback) and the next
 * state (to apply when playback ends).
 */
export function kick(s: GameState, team: Team, input: KickInput): { result: KickResult; next: GameState } {
  if (s.phase !== 'play' || !s.possession) fail('Not in play');
  const p = s.possession;
  if (p.team !== team) fail('Not your kick');
  const pitch = derivePitch(s.settings);
  const world = buildWorld(pitch, s.players, p.kicker);
  const result = simulateKick({
    input,
    origin: kickOrigin(s, p),
    team,
    world,
    caps: kickCaps(p),
    turnId: s.turnId,
  });
  return { result, next: resolveOutcome(s, p, result.outcome) };
}

/**
 * Applies a kick's outcome (§7 order): score / restart (§2.6) → kicksTaken + 1
 * → half-time after N/2 kicks (the other team than the opening one kicks off
 * from the center) → full-time after N kicks (a goal on that kick counts).
 */
export function resolveOutcome(s: GameState, possession: Possession, outcome: Outcome): GameState {
  if (s.phase !== 'play') fail('Not in play');
  const d = decideRestart(s, possession, outcome);
  const score: [number, number] = [s.score[0], s.score[1]];
  if (d.scored !== null) score[d.scored] += 1;
  const kicksTaken = s.kicksTaken + 1;
  const turnId = s.turnId;
  let next: Possession | null = d.possession;
  let awarded = d.awarded;
  let half = s.half;
  let phase: GameState['phase'] = 'play';

  if (kicksTaken >= s.settings.kicksPerMatch) {
    phase = 'fulltime';
    next = null;
  } else if (half === 1 && kicksTaken >= halfTimeAfter(s.settings)) {
    half = 2;
    next = kickoffPossession(otherTeam(OPENING_KICKOFF_TEAM));
    awarded = 'kickoff';
  }

  return bump(s, {
    phase,
    score,
    kicksTaken,
    half,
    possession: next,
    turnId: next ? turnId + 1 : turnId,
    last: { turnId, outcome, awarded, team: possession.team, ...(d.disallowed ? { disallowed: true } : {}) },
  });
}

/** §2.7.4: a seat votes for a rematch; with both votes a new toss and a fresh draft start. */
export function voteRematch(s: GameState, seat: Seat, rng: Rng): GameState {
  if (s.phase !== 'fulltime') fail('The match is not over');
  const votes: [boolean, boolean] = [s.rematchVotes[0], s.rematchVotes[1]];
  if (votes[seat]) fail('Already voted');
  votes[seat] = true;
  if (votes[0] && votes[1]) return newMatch(s.settings, s.seatNames, rng, s.rev + 1);
  return bump(s, { rematchVotes: votes });
}

/** Result at full-time: the winning team, or null for a draw (§2.7.3). */
export function winner(s: Pick<GameState, 'score'>): Team | null {
  if (s.score[0] === s.score[1]) return null;
  return s.score[0] > s.score[1] ? 0 : 1;
}
