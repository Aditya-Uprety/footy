import { describe, expect, it } from 'vitest';
import { createRng } from '../shared/rng';
import { PHYS } from '../sim/constants';
import { DRAFT_SCHEDULE, randomPick } from './draft';
import {
  activeSeat,
  applyPick,
  chooseRole,
  defaultName,
  kick,
  kickCaps,
  NAME_MAX,
  newMatch,
  resolveOutcome,
  RuleError,
  sanitizeName,
  seatOfTeam,
  teamOfSeat,
  voteRematch,
  winner,
} from './rules';
import { defaultSettings } from './settings';
import { draftedMatch } from './testUtil';
import type { GameState, Outcome, Team } from './types';

const noTouch = (team: Team) => ({ lastTouch: { team, playerId: null }, touches: 0 });
const goalFor = (team: Team): Outcome => ({ kind: 'goal', goalOf: team === 0 ? 1 : 0, z: 0, ...noTouch(team) });
const stopAt = (team: Team, x = 0, z = 20): Outcome => ({ kind: 'stop', x, z, ...noTouch(team) });

/** Resolves `n` kicks with `outcome(team)` for the possessing team each time. */
function play(s: GameState, n: number, outcome: (team: Team) => Outcome = stopAt): GameState {
  for (let i = 0; i < n && s.phase === 'play'; i++) s = resolveOutcome(s, s.possession!, outcome(s.possession!.team));
  return s;
}

function throws(f: () => unknown, re: RegExp): RuleError {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(RuleError);
    expect((e as RuleError).reason).toMatch(re);
    return e as RuleError;
  }
  throw new Error('expected a RuleError');
}

describe('seat names', () => {
  it('sanitizes names: trims, collapses spaces, drops control characters, caps the length', () => {
    expect(sanitizeName('  Ann   Lee ', 'x')).toBe('Ann Lee');
    expect(sanitizeName('A\u0000b\nc', 'x')).toBe('Ab c');
    expect(sanitizeName('x'.repeat(40), 'f')).toHaveLength(NAME_MAX);
    expect(sanitizeName('   ', 'Player 2')).toBe('Player 2');
    expect(sanitizeName(42, 'Player 1')).toBe('Player 1');
    expect(sanitizeName('⚽⚽⚽⚽⚽⚽⚽⚽⚽⚽⚽⚽⚽⚽⚽⚽⚽⚽', 'f')).toBe('⚽'.repeat(NAME_MAX));
  });

  it('newMatch falls back to Player 1 / Player 2', () => {
    const s = newMatch(defaultSettings(), ['', ' Bob '], createRng(1));
    expect(s.seatNames).toEqual([defaultName(0), 'Bob']);
  });
});

describe('toss and roles (§2.1)', () => {
  it('the host RNG draws the winner; same seed, same winner', () => {
    const winners = new Set<number>();
    for (let seed = 1; seed < 40; seed++) {
      const a = newMatch(defaultSettings(), ['A', 'B'], createRng(seed));
      expect(newMatch(defaultSettings(), ['A', 'B'], createRng(seed)).toss.winner).toBe(a.toss.winner);
      winners.add(a.toss.winner);
      expect(a.phase).toBe('toss');
      expect(activeSeat(a)).toBe(a.toss.winner);
    }
    expect(winners.size).toBe(2);
  });

  it('the winner picks a role; seats map to teams', () => {
    const s = newMatch(defaultSettings(), ['A', 'B'], createRng(5));
    const w = s.toss.winner;
    const b = chooseRole(s, w, 'B');
    expect(b.phase).toBe('placement');
    expect(teamOfSeat(b, w)).toBe(1);
    expect(teamOfSeat(b, w === 0 ? 1 : 0)).toBe(0);
    expect(seatOfTeam(b, 0)).toBe(w === 0 ? 1 : 0);
    expect(b.rev).toBe(s.rev + 1);
    expect(s.phase).toBe('toss'); // input untouched
    // Team A places first.
    expect(activeSeat(b)).toBe(seatOfTeam(b, 0));
  });

  it('only the winner, only during the toss', () => {
    const s = newMatch(defaultSettings(), ['A', 'B'], createRng(5));
    throws(() => chooseRole(s, s.toss.winner === 0 ? 1 : 0, 'A'), /toss winner/);
    throws(() => chooseRole(chooseRole(s, s.toss.winner, 'A'), s.toss.winner, 'A'), /toss phase/);
  });
});

describe('draft → kickoff (§2.3.6)', () => {
  it('12 picks in order, then Team A kicks off from the center at turn 1', () => {
    const rng = createRng(9);
    const s0 = newMatch(defaultSettings(), ['A', 'B'], rng);
    let s = chooseRole(s0, s0.toss.winner, 'A');
    for (let pick = 0; pick < 12; pick++) {
      const { team } = DRAFT_SCHEDULE[pick]!;
      expect(s.pick).toBe(pick);
      expect(activeSeat(s)).toBe(seatOfTeam(s, team));
      // The other team can't pick now.
      throws(() => applyPick(s, team === 0 ? 1 : 0, randomPick(s, team, createRng(1))), /Not your pick/);
      s = applyPick(s, team, randomPick(s, team, rng));
    }
    expect(s.phase).toBe('play');
    expect(s.players).toHaveLength(22);
    expect(s.turnId).toBe(1);
    expect(s.possession).toEqual({ team: 0, restart: 'kickoff', kicker: { kind: 'ghost', x: 0, y: PHYS.BALL_R, z: 0 } });
  });

  it('an illegal pick throws with its violations and changes nothing', () => {
    const s0 = newMatch(defaultSettings(), ['A', 'B'], createRng(2));
    const s = chooseRole(s0, s0.toss.winner, 'A');
    const e = throws(() => applyPick(s, 0, [{ x: 0, z: 0, gk: false }]), /center circle/);
    expect(s.players).toEqual([]);
    expect(e.violations?.[0]?.code).toBe('centerCircle');
  });
});

describe('kick() (§2.4)', () => {
  it('simulates from the kicker, tags the turn, and resolves into the next state', () => {
    const s = draftedMatch(3);
    const { result, next } = kick(s, 0, { yaw: Math.PI / 2, power: 0.4, curve: 0, loft: 0 });
    expect(result.turnId).toBe(1);
    expect(result.start).toEqual({ x: 0, y: PHYS.BALL_R, z: 0 });
    expect(next.kicksTaken).toBe(1);
    expect(next.turnId).toBe(2);
    expect(next.last).toMatchObject({ turnId: 1, outcome: result.outcome, team: 0 });
    expect(next.rev).toBe(s.rev + 1);
    expect(s.kicksTaken).toBe(0);
  });

  it('only the possessing team may kick', () => {
    throws(() => kick(draftedMatch(3), 1, { yaw: 0, power: 0.5, curve: 0, loft: 0 }), /Not your kick/);
  });

  it('throw-ins go to the nearest player and are not capped (M17)', () => {
    let s = draftedMatch(4);
    s = resolveOutcome(s, s.possession!, { kind: 'out', line: 'touch', x: 10, z: 34, ...noTouch(0) });
    expect(s.possession!.restart).toBe('throwin');
    expect(s.possession!.kicker.kind).toBe('player');
    expect(kickCaps(s.possession!)).toEqual({});
    const { result } = kick(s, 1, { yaw: -Math.PI / 2, power: 1, curve: 1, loft: 0.3 });
    expect(result.input.power).toBe(1);
    expect(result.input.curve).toBe(1);
    expect(result.start.y).toBe(PHYS.BALL_R);
  });

  it('a ball resting on the goal line in the goal mouth is open play: no goal, no restart (M17.3)', () => {
    const s0 = draftedMatch(4);
    const L2 = s0.settings.pitchLength / 2;
    const s = resolveOutcome(s0, s0.possession!, stopAt(0, L2 + PHYS.BALL_R, 0));
    expect(s.score).toEqual([0, 0]);
    expect(s.possession!.restart).toBe('open');
    expect(s.possession!.kicker.kind).toBe('player');
    // The closest player gets it (Team B's keeper, if it stands nearest its goal).
    const kicker = s.players.find((p) => s.possession!.kicker.kind === 'player' && p.id === s.possession!.kicker.playerId)!;
    const d = (p: { x: number; z: number }) => Math.hypot(p.x - (L2 + PHYS.BALL_R), p.z);
    expect(Math.min(...s.players.map(d))).toBeCloseTo(d(kicker), 9);
  });

  it('a player kicker kicks from their own spot', () => {
    let s = draftedMatch(6);
    const p = s.players.find((q) => q.team === 1 && !q.gk)!;
    s = resolveOutcome(s, s.possession!, stopAt(0, p.x, p.z));
    expect(s.possession!.kicker).toEqual({ kind: 'player', playerId: p.id });
    const { result } = kick(s, 1, { yaw: 0, power: 0.2, curve: 0, loft: 0 });
    expect(Math.hypot(result.start.x - p.x, result.start.z - p.z)).toBeCloseTo(0.4 + PHYS.BALL_R + PHYS.KICK_GAP, 9);
  });
});

describe('score, half-time, full-time (§2.7)', () => {
  it('a goal scores and the conceding team kicks off', () => {
    let s = draftedMatch(1);
    s = resolveOutcome(s, s.possession!, goalFor(0));
    expect(s.score).toEqual([1, 0]);
    expect(s.possession).toMatchObject({ team: 1, restart: 'kickoff' });
    expect(s.last).toMatchObject({ awarded: 'kickoff', team: 0 });
  });

  it('half-time after kick N/2: score kept, the other team kicks off from the center', () => {
    let s = draftedMatch(1);
    s = play(s, 19);
    expect(s.half).toBe(1);
    s = resolveOutcome(s, s.possession!, goalFor(s.possession!.team));
    const scoreAtHt = s.score;
    expect(s.kicksTaken).toBe(20);
    expect(s.half).toBe(2);
    expect(s.possession).toMatchObject({ team: 1, restart: 'kickoff', kicker: { kind: 'ghost', x: 0, z: 0 } });
    expect(s.last?.awarded).toBe('kickoff');
    expect(scoreAtHt[0] + scoreAtHt[1]).toBe(1);
    // Also when the 20th kick ends in a plain stop.
    const t = play(play(draftedMatch(1), 19), 1);
    expect(t.possession).toMatchObject({ team: 1, restart: 'kickoff' });
  });

  it('full-time after N kicks; a goal on the last kick counts; level = draw', () => {
    let s = play(draftedMatch(1), 39);
    expect(s.phase).toBe('play');
    s = resolveOutcome(s, s.possession!, goalFor(s.possession!.team));
    expect(s.phase).toBe('fulltime');
    expect(s.kicksTaken).toBe(40);
    expect(s.possession).toBeNull();
    expect(s.score[0] + s.score[1]).toBe(1);
    expect(winner(s)).toBe(s.score[0] === 1 ? 0 : 1);
    expect(winner(play(draftedMatch(1), 40))).toBeNull();
    throws(() => resolveOutcome(s, { team: 0, kicker: { kind: 'ghost', x: 0, y: 0, z: 0 }, restart: 'open' }, stopAt(0)), /Not in play/);
  });

  it('kicksPerMatch is read from settings', () => {
    const s = play(draftedMatch(2, { kicksPerMatch: 10 }), 5);
    expect(s.half).toBe(2);
    expect(play(s, 5).phase).toBe('fulltime');
  });
});

describe('rematch (§2.7.4)', () => {
  it('needs both votes, then a new toss and a fresh draft', () => {
    const rng = createRng(11);
    const end = play(draftedMatch(1), 40);
    const one = voteRematch(end, 1, rng);
    expect(one.rematchVotes).toEqual([false, true]);
    expect(one.phase).toBe('fulltime');
    throws(() => voteRematch(one, 1, rng), /Already voted/);
    const fresh = voteRematch(one, 0, rng);
    expect(fresh.phase).toBe('toss');
    expect(fresh.players).toEqual([]);
    expect(fresh.score).toEqual([0, 0]);
    expect(fresh.toss.teamOfSeat).toBeNull();
    expect(fresh.rev).toBe(one.rev + 1);
    expect(fresh.seatNames).toEqual(end.seatNames);
    throws(() => voteRematch(draftedMatch(1), 0, rng), /not over/);
  });
});
