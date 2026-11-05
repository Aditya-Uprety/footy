// PURE. Who gets the ball after it stops (PLAN §2.5.6–7).
//
// The player whose center is closest to the ball in 2D (x/z). Players within
// TIE_DIST of the closest distance count as tied: among them the team that
// did NOT take the kick wins; if several of that team are still tied (or all
// tied players are on the kicking team), the lowest player id wins.

import type { Team } from '../sim/types';

/** Distances within this of the minimum count as a tie, m. */
export const TIE_DIST = 0.01;

/** What possession needs from a placed player (game PlayerSpot satisfies this). */
export interface PositionedPlayer {
  id: number;
  team: Team;
  x: number;
  z: number;
}

/**
 * The player who gets the ball at (x, z) after a kick by `kickingTeam`.
 * Returns null only when there are no players.
 */
export function closestPlayer<P extends PositionedPlayer>(
  players: readonly P[],
  x: number,
  z: number,
  kickingTeam: Team,
): P | null {
  if (players.length === 0) return null;
  const dist = players.map((p) => {
    const dx = p.x - x;
    const dz = p.z - z;
    return Math.sqrt(dx * dx + dz * dz);
  });
  let min = Infinity;
  for (const d of dist) if (d < min) min = d;

  let best: P | null = null;
  let bestOther = false;
  for (let i = 0; i < players.length; i++) {
    if (dist[i]! > min + TIE_DIST) continue;
    const p = players[i]!;
    const other = p.team !== kickingTeam;
    if (!best || (other && !bestOther) || (other === bestOther && p.id < best.id)) {
      best = p;
      bestOther = other;
    }
  }
  return best;
}
