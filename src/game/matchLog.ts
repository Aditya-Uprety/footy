// PURE. Match log and full-time stats (PLAN §12 M15.3).
//
// `resolveOutcome` appends one compact KickLogEntry per kick to `GameState.log`
// (so it syncs online with the normal snapshots and survives a reconnect).
// `matchStats` turns the log into the numbers shown at full-time.
//
// Definitions (kept simple on purpose):
//   shot       a kick by team T that ended in the opponent's goal (counted or
//              not), in a save by the opponent's keeper, or over the
//              opponent's goal line. A shot on target = goal or save.
//   save       the keeper of the team that did NOT kick caught the ball from a
//              shot (a kicker's own keeper catching a rebound is not a save).
//   possession each kick is a turn with the ball, so a team's possession % is
//              its share of all kicks taken.

import type { Outcome, PlayerSpot, RestartKind, Team } from './types';
import { otherTeam } from './types';

export type KickResultKind = 'goal' | 'nogoal' | 'touch' | 'goalline' | 'catch' | 'stop';

export interface KickLogEntry {
  /** Kick number, 1-based. */
  n: number;
  half: 1 | 2;
  /** The team that took the kick. */
  team: Team;
  /** The kicker's player id; null for a ghost taker (kickoff, throw-in, corner). */
  player: number | null;
  /** How the kick was taken. */
  restart: RestartKind;
  result: KickResultKind;
  /** The team credited with the goal (result 'goal'), else null. */
  scored: Team | null;
  /** True for an own goal (the ball last touched by the team whose goal it entered). */
  own: boolean;
  /** 0 = not a shot, 1 = shot off target, 2 = shot on target (goal or save). */
  shot: 0 | 1 | 2;
  /** The keeper who caught the ball (result 'catch'), else null. */
  keeper: number | null;
  /** The restart awarded next and who takes it (null at full-time). */
  awarded: RestartKind;
  nextTeam: Team | null;
}

export interface LogInput {
  n: number;
  half: 1 | 2;
  team: Team;
  player: number | null;
  restart: RestartKind;
  outcome: Outcome;
  disallowed: boolean;
  awarded: RestartKind;
  nextTeam: Team | null;
  players: readonly Pick<PlayerSpot, 'id' | 'team'>[];
}

/** Builds the log entry for a resolved kick. */
export function makeLogEntry(i: LogInput): KickLogEntry {
  const o = i.outcome;
  const opponent = otherTeam(i.team);
  let result: KickResultKind;
  let scored: Team | null = null;
  let own = false;
  let shot: 0 | 1 | 2 = 0;
  let keeper: number | null = null;
  switch (o.kind) {
    case 'goal':
      result = i.disallowed ? 'nogoal' : 'goal';
      if (!i.disallowed) {
        scored = otherTeam(o.goalOf);
        own = o.lastTouch.team === o.goalOf && o.touches > 0;
      }
      if (o.goalOf === opponent) shot = 2;
      break;
    case 'out':
      result = o.line === 'touch' ? 'touch' : 'goalline';
      // The goal line at the opponent's end (x < 0 is team A's goal).
      if (o.line === 'goal' && (o.x < 0 ? 0 : 1) === opponent) shot = 1;
      break;
    case 'catch': {
      result = 'catch';
      keeper = o.keeperId;
      const k = i.players.find((p) => p.id === o.keeperId);
      if (k && k.team === opponent) shot = 2;
      break;
    }
    case 'stop':
      result = 'stop';
      break;
  }
  return {
    n: i.n,
    half: i.half,
    team: i.team,
    player: i.player,
    restart: i.restart,
    result,
    scored,
    own,
    shot,
    keeper,
    awarded: i.awarded,
    nextTeam: i.nextTeam,
  };
}

export interface TeamStats {
  kicks: number;
  goals: number;
  shots: number;
  onTarget: number;
  saves: number;
  corners: number;
  /** Share of all kicks, whole percent (the two teams add up to 100 once a kick was taken). */
  possession: number;
}

/** Per-team numbers from the log. */
export function matchStats(log: readonly KickLogEntry[]): Record<Team, TeamStats> {
  const blank = (): TeamStats => ({ kicks: 0, goals: 0, shots: 0, onTarget: 0, saves: 0, corners: 0, possession: 0 });
  const stats: Record<Team, TeamStats> = { 0: blank(), 1: blank() };
  for (const e of log) {
    const mine = stats[e.team];
    mine.kicks += 1;
    if (e.shot > 0) mine.shots += 1;
    if (e.shot === 2) mine.onTarget += 1;
    if (e.restart === 'corner') mine.corners += 1;
    if (e.scored !== null) stats[e.scored].goals += 1;
    // A save belongs to the keeper's team: the opponent of a shot on target that was caught.
    if (e.result === 'catch' && e.shot === 2) stats[otherTeam(e.team)].saves += 1;
  }
  const total = stats[0].kicks + stats[1].kicks;
  if (total > 0) {
    stats[0].possession = Math.round((stats[0].kicks / total) * 100);
    stats[1].possession = 100 - stats[0].possession;
  }
  return stats;
}
