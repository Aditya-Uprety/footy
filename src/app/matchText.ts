// Pure text for the match HUD (PLAN §9, M8.3): possession banner, event and
// restart toasts, kick counter, full-time result. No DOM, so it is unit-tested.
import { seatOfTeam, winner } from '../game/rules';
import { kitOf } from '../shared/kits';
import type { GameState, LastKick, PlayerSpot, Possession, RestartKind, Team } from '../game/types';
import type { SimEvent } from '../sim/types';

/** Kit names used in every match text: they follow the match's kit pair (M13.4). */
export const TEAM_KIT: Readonly<Record<Team, string>> = {
  get 0() {
    return kitOf(0).name;
  },
  get 1() {
    return kitOf(1).name;
  },
};

export type ToastKind = 'goal' | 'save' | 'out' | 'post' | 'info';

export interface ToastText {
  text: string;
  kind: ToastKind;
  /** Smaller second line. */
  sub?: string;
}

const RESTART_NAME: Readonly<Record<RestartKind, string>> = Object.freeze({
  kickoff: 'Kickoff',
  throwin: 'Throw-in',
  corner: 'Corner',
  goalkick: 'Goal kick',
  catch: "Keeper's ball",
  open: 'Open play',
});

export function restartName(r: RestartKind): string {
  return RESTART_NAME[r];
}

/** "1st half" / "2nd half". */
export function halfLabel(half: 1 | 2): string {
  return half === 1 ? '1st half' : '2nd half';
}

/** "Kick 13/40 · 1st half": the kick about to be taken (capped at N). */
export function kickCounter(s: Pick<GameState, 'kicksTaken' | 'half' | 'settings'>): string {
  const n = s.settings.kicksPerMatch;
  return `Kick ${Math.min(n, s.kicksTaken + 1)}/${n} · ${halfLabel(s.half)}`;
}

function playerLabel(players: readonly PlayerSpot[], id: number): string {
  const p = players.find((q) => q.id === id);
  if (!p) return `#${id}`;
  return `${TEAM_KIT[p.team]} #${p.shirt}${p.gk ? ' (GK)' : ''}`;
}

/**
 * The possession banner: "Red #7 on the ball", "Corner — Blue",
 * "Goal kick — Red #1 (GK)", "Kickoff — Red", "Throw-in — Blue".
 */
export function possessionText(s: Pick<GameState, 'players'>, p: Possession): string {
  const kit = TEAM_KIT[p.team];
  if (p.kicker.kind === 'ghost') return `${restartName(p.restart)} — ${kit}`;
  const who = playerLabel(s.players, p.kicker.playerId);
  if (p.restart === 'goalkick') return `Goal kick — ${who}`;
  if (p.restart === 'catch') return `${who} has the ball`;
  return `${who} on the ball`;
}

/** The seat name playing `team` ("" before the toss). */
export function seatNameOf(s: Pick<GameState, 'toss' | 'seatNames'>, team: Team): string {
  const seat = seatOfTeam(s, team);
  return seat === null ? '' : s.seatNames[seat];
}

/** A toast for a live playback event, or null (only the big moments get one). */
export function eventToast(ev: SimEvent, players: readonly PlayerSpot[]): ToastText | null {
  switch (ev.kind) {
    case 'goal':
      return { text: 'GOAL!', kind: 'goal' };
    case 'catch':
      return { text: 'Saved!', kind: 'save', sub: playerLabel(players, ev.keeperId) };
    case 'out':
      return { text: ev.line === 'touch' ? 'Out — touchline' : 'Out — goal line', kind: 'out' };
    case 'post':
    case 'bar':
      return ev.tail ? null : { text: ev.kind === 'post' ? 'Off the post!' : 'Off the bar!', kind: 'post' };
    default:
      return null;
  }
}

/**
 * The toast when the next state is applied after a kick: the goal scorer
 * (or "No goal" for a throw-in straight in), then the restart awarded.
 * Half-time and full-time have their own overlays, so they return null here.
 */
export function afterKickToast(prev: Pick<GameState, 'half' | 'phase'>, next: GameState): ToastText | null {
  const last: LastKick | null = next.last;
  if (!last || next.phase !== 'play' || next.half !== prev.half) return null;
  const o = last.outcome;
  if (o.kind === 'goal' && !last.disallowed) {
    const scorer: Team = o.goalOf === 0 ? 1 : 0;
    const own = o.lastTouch.team === o.goalOf && o.touches > 0;
    return { text: `Goal — ${TEAM_KIT[scorer]}`, kind: 'goal', sub: `${own ? 'Own goal · ' : ''}${scoreLine(next)}` };
  }
  if (last.disallowed) return { text: 'No goal', kind: 'info', sub: 'Straight from a throw-in' };
  const p = next.possession;
  if (!p) return null;
  switch (last.awarded) {
    case 'throwin':
    case 'corner':
    case 'goalkick':
      return { text: `${restartName(last.awarded)} — ${TEAM_KIT[p.team]}`, kind: 'info' };
    default:
      return null;
  }
}

/** "Red 2 – 1 Blue". */
export function scoreLine(s: Pick<GameState, 'score'>): string {
  return `${TEAM_KIT[0]} ${s.score[0]} – ${s.score[1]} ${TEAM_KIT[1]}`;
}

/** Full-time headline: "Red wins" (with the seat name) or "Draw". */
export function resultText(s: Pick<GameState, 'score' | 'toss' | 'seatNames'>): { headline: string; team: Team | null } {
  const w = winner(s);
  if (w === null) return { headline: 'Draw', team: null };
  const name = seatNameOf(s, w);
  return { headline: `${TEAM_KIT[w]} wins${name ? ` — ${name}` : ''}`, team: w };
}

/** Shot-timer text: whole seconds rounded up ("20", "5", "0"). */
export function timerText(remainingSec: number): string {
  return String(Math.max(0, Math.ceil(remainingSec - 1e-9)));
}
