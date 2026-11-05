// PURE. What happens after a kick (PLAN §2.5.6, §2.6, §2.7.1): the score
// change and the next possession for each Outcome.
//
//   goal  → the scoring team gets +1; the conceding team kicks off.
//   out over a touchline → throw-in to the team that didn't touch last: its
//           player closest to the exit point gets the ball where they stand
//           (M17; it is an ordinary kick, so no caps and goals count).
//   out over a goal line, at the goal defended by D →
//           last touch by the attackers: goal kick, D's keeper has the ball;
//           last touch by D: corner to the attackers on the side it went out.
//   catch → the keeper's team, from where the keeper stands.
//   stop  → the closest player (tie → the non-kicking team, then lower id).

import { derivePitch, type Pitch, type PitchSettings } from '../shared/pitch';
import { cornerSpot, kickoffSpot, throwInSpot } from '../sim/kick';
import { closestPlayer } from './possession';
import { otherTeam, type GameState, type Kicker, type Outcome, type Possession, type RestartKind, type Team } from './types';

export interface RestartDecision {
  /** Who kicks next, from where. */
  possession: Possession;
  /** The restart awarded (= possession.restart). */
  awarded: RestartKind;
  /** The team that scored on this kick, or null. */
  scored: Team | null;
  /** A goal that didn't count. Always false since M17 (throw-ins are ordinary kicks); kept for the log and the wire. */
  disallowed: boolean;
}

function ghost(p: { x: number; y: number; z: number }): Kicker {
  return { kind: 'ghost', x: p.x, y: p.y, z: p.z };
}

function dims(pitch: Pitch): PitchSettings {
  return { pitchLength: pitch.length, pitchWidth: pitch.width };
}

function sign(v: number): -1 | 1 {
  return v < 0 ? -1 : 1;
}

/** The center-spot kickoff for `team`. */
export function kickoffPossession(team: Team): Possession {
  return { team, kicker: ghost(kickoffSpot()), restart: 'kickoff' };
}

/**
 * Throw-in for `team` where the ball left over the touchline at (x, ±W/2)
 * (§2.6.3, M17): `team`'s player closest to the exit point gets the ball where
 * they stand (ties → lower id). Without players (never in a match) a ghost
 * taker stands at the exit point.
 */
export function throwInPossession(pitch: Pitch, players: GameState['players'], team: Team, xExit: number, zExit: number): Possession {
  const mine = players.filter((p) => p.team === team);
  const nearest = mine.length ? closestPlayer(mine, xExit, zExit, otherTeam(team)) : null;
  if (nearest) return { team, kicker: { kind: 'player', playerId: nearest.id }, restart: 'throwin' };
  return { team, kicker: ghost(throwInSpot(dims(pitch), xExit, sign(zExit))), restart: 'throwin' };
}

/** Corner for `team` at the goal defended by `defending`, on the side z points to. */
export function cornerPossession(pitch: Pitch, team: Team, defending: Team, z: number): Possession {
  const sx: -1 | 1 = pitch.ends[defending].side;
  return { team, kicker: ghost(cornerSpot(dims(pitch), sx, sign(z))), restart: 'corner' };
}

/**
 * Goal kick: `team`'s keeper has the ball where they stand. Without a keeper
 * (allowed when an outfield player stands in the team's own box, §2.3.3) the
 * team's player closest to the center of its own goal line takes it.
 */
export function goalKickPossession(players: GameState['players'], team: Team, pitch: Pitch): Possession {
  const gk = players.find((p) => p.team === team && p.gk);
  if (gk) return { team, kicker: { kind: 'player', playerId: gk.id }, restart: 'goalkick' };
  const lineX = pitch.ends[team].goalLineX;
  const mine = players.filter((p) => p.team === team);
  if (mine.length === 0) return kickoffPossession(team);
  const nearest = closestPlayer(mine, lineX, 0, otherTeam(team))!;
  return { team, kicker: { kind: 'player', playerId: nearest.id }, restart: 'goalkick' };
}

/**
 * The restart after a kick by `kick.team` (taken as a `kick.restart`) ended
 * with `outcome`. Pure: reads the settings (pitch size) and the players.
 */
export function decideRestart(
  state: Pick<GameState, 'settings' | 'players'>,
  kick: { team: Team; restart: RestartKind },
  outcome: Outcome,
): RestartDecision {
  const pitch = derivePitch(state.settings);
  const done = (possession: Possession, scored: Team | null = null, disallowed = false): RestartDecision => ({
    possession,
    awarded: possession.restart,
    scored,
    disallowed,
  });

  switch (outcome.kind) {
    case 'goal': {
      const conceding = outcome.goalOf;
      return done(kickoffPossession(conceding), otherTeam(conceding));
    }
    case 'out': {
      const last = outcome.lastTouch.team;
      if (outcome.line === 'touch') return done(throwInPossession(pitch, state.players, otherTeam(last), outcome.x, outcome.z));
      const defending: Team = outcome.x < 0 ? 0 : 1;
      if (last !== defending) return done(goalKickPossession(state.players, defending, pitch));
      return done(cornerPossession(pitch, otherTeam(defending), defending, outcome.z));
    }
    case 'catch': {
      const keeper = state.players.find((p) => p.id === outcome.keeperId);
      const team = keeper ? keeper.team : otherTeam(kick.team);
      return done({ team, kicker: { kind: 'player', playerId: outcome.keeperId }, restart: 'catch' });
    }
    case 'stop': {
      const p = closestPlayer(state.players, outcome.x, outcome.z, kick.team);
      if (!p) return done(kickoffPossession(otherTeam(kick.team)));
      return done({ team: p.team, kicker: { kind: 'player', playerId: p.id }, restart: 'open' });
    }
  }
}
