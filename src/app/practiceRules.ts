// Practice-mode rules (PLAN M5.5), kept pure for tests: a seeded random
// 22-player layout and "who kicks next" with no rules engine (that is M6).
//
// Layout: each team gets one keeper inside its own penalty area and ten
// outfield players, following the placement spot rules of §2.3.4 a–d (1 m
// field margin, hitbox outside the center circle, ≥ X from teammates, ≥ Y
// from opponents). Outfield players lean toward their own half.
//
// Next kicker: after a stop the closest player (§2.5.6); after a catch the
// keeper; goals and outs reset to a center kickoff (by the conceding team, or
// the team that did not touch the ball last).
import { closestPlayer } from '../game/possession';
import type { Settings } from '../game/settings';
import type { Pitch } from '../shared/pitch';
import { rectContains } from '../shared/pitch';
import type { Rng } from '../shared/rng';
import { HITBOX, PHYS } from '../sim/constants';
import { kickoffSpot } from '../sim/kick';
import type { KickOrigin, Outcome, Team } from '../sim/types';

export interface PracticePlayer {
  id: number;
  team: Team;
  x: number;
  z: number;
  gk: boolean;
  /** GK 1, outfield 2–11. */
  shirt: number;
}

export const PLAYERS_PER_TEAM = 11;
/** Chance an outfield spot is drawn from the team's own half (else anywhere). */
const OWN_HALF_BIAS = 0.7;

/** Spot rules §2.3.4 a–d against the players placed so far (no GK guard: practice only). */
export function practiceSpotOk(
  pitch: Pitch,
  settings: Pick<Settings, 'minTeammateDist' | 'minOpponentDist'>,
  placed: readonly { team: Team; x: number; z: number }[],
  spot: { team: Team; x: number; z: number; gk: boolean },
): boolean {
  if (!rectContains(pitch.placementBounds, spot.x, spot.z)) return false;
  const R = spot.gk ? HITBOX.GK.R : HITBOX.OUTFIELD.R;
  if (Math.sqrt(spot.x * spot.x + spot.z * spot.z) < pitch.centerCircleR + R) return false;
  if (spot.gk && !rectContains(pitch.ends[spot.team].penaltyArea, spot.x, spot.z)) return false;
  for (const p of placed) {
    const d = Math.sqrt((p.x - spot.x) ** 2 + (p.z - spot.z) ** 2);
    if (d < (p.team === spot.team ? settings.minTeammateDist : settings.minOpponentDist)) return false;
  }
  return true;
}

/** A seeded random legal layout of 2 × 11 players (ids 1–22: A's first). */
export function practiceLayout(pitch: Pitch, settings: Pick<Settings, 'minTeammateDist' | 'minOpponentDist'>, rng: Rng): PracticePlayer[] {
  for (let attempt = 0; attempt < 50; attempt++) {
    const placed: PracticePlayer[] = [];
    const shirts: [number, number] = [2, 2];
    let ok = true;
    // Keepers first, a few metres off their goal line.
    for (const team of [0, 1] as Team[]) {
      const end = pitch.ends[team];
      const spot = drawSpot(200, () => ({
        team,
        gk: true,
        x: end.goalLineX - end.side * rng.range(2.5, 9),
        z: rng.range(-9, 9),
      }), (s) => practiceSpotOk(pitch, settings, placed, s));
      if (!spot) {
        ok = false;
        break;
      }
      placed.push({ ...spot, id: 0, shirt: 1 });
    }
    // Outfield, alternating teams so neither is squeezed out.
    for (let i = 0; ok && i < 2 * (PLAYERS_PER_TEAM - 1); i++) {
      const team = (i % 2) as Team;
      const b = pitch.placementBounds;
      const spot = drawSpot(400, () => {
        const own = rng.next() < OWN_HALF_BIAS;
        const x = own ? (team === 0 ? rng.range(b.xMin, 0) : rng.range(0, b.xMax)) : rng.range(b.xMin, b.xMax);
        return { team, gk: false, x, z: rng.range(b.zMin, b.zMax) };
      }, (s) => practiceSpotOk(pitch, settings, placed, s));
      if (!spot) {
        ok = false;
        break;
      }
      placed.push({ ...spot, id: 0, shirt: shirts[team]++ });
    }
    if (!ok) continue;
    // Ids in team order: A 1–11 (GK first), B 12–22.
    const sorted = [...placed].sort((p, q) => p.team - q.team || p.shirt - q.shirt);
    return sorted.map((p, i) => ({ ...p, id: i + 1, x: round2(p.x), z: round2(p.z) }));
  }
  throw new Error('practiceLayout: could not place 22 players');
}

function drawSpot<S>(tries: number, gen: () => S, ok: (s: S) => boolean): S | null {
  for (let i = 0; i < tries; i++) {
    const s = gen();
    if (ok(s)) return s;
  }
  return null;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Whose ball, and where, for a practice turn. */
export interface PracticeTurn {
  team: Team;
  origin: KickOrigin;
  /** Initial aim yaw: toward the opponent's goal. */
  yaw: number;
  /** For the HUD: why this team has the ball. */
  reason: 'kickoff' | 'stop' | 'catch' | 'goal' | 'out';
}

/** Yaw from (x, z) toward the center of the goal `team` attacks. */
export function yawTowardGoal(pitch: Pitch, team: Team, x: number, z: number): number {
  const gx = team === 0 ? pitch.halfLength : -pitch.halfLength;
  return Math.atan2(0 - z, gx - x);
}

export function kickoffTurn(pitch: Pitch, team: Team, reason: PracticeTurn['reason'] = 'kickoff'): PracticeTurn {
  const s = kickoffSpot(PHYS);
  return { team, origin: { kind: 'ghost', ...s }, yaw: yawTowardGoal(pitch, team, 0, 0), reason };
}

export function playerTurn(pitch: Pitch, p: PracticePlayer, reason: PracticeTurn['reason']): PracticeTurn {
  return {
    team: p.team,
    origin: { kind: 'player', playerId: p.id, team: p.team, x: p.x, z: p.z, gk: p.gk },
    yaw: yawTowardGoal(pitch, p.team, p.x, p.z),
    reason,
  };
}

/** The next practice turn after a kick by `kickingTeam` ended with `outcome`. */
export function nextPracticeTurn(pitch: Pitch, players: readonly PracticePlayer[], kickingTeam: Team, outcome: Outcome): PracticeTurn {
  switch (outcome.kind) {
    case 'stop': {
      const p = closestPlayer(players, outcome.x, outcome.z, kickingTeam);
      return p ? playerTurn(pitch, p, 'stop') : kickoffTurn(pitch, kickingTeam);
    }
    case 'catch': {
      const k = players.find((p) => p.id === outcome.keeperId);
      return k ? playerTurn(pitch, k, 'catch') : kickoffTurn(pitch, kickingTeam);
    }
    case 'goal':
      // The conceding team (the one defending that goal) kicks off.
      return kickoffTurn(pitch, outcome.goalOf, 'goal');
    case 'out':
      return kickoffTurn(pitch, outcome.lastTouch.team === 0 ? 1 : 0, 'out');
  }
}
