import { describe, expect, it } from 'vitest';
import { isGameState } from '../net/protocol';
import { matchStats } from './matchLog';
import { resolveOutcome } from './rules';
import { draftedMatch } from './testUtil';
import type { GameState, Outcome, Team } from './types';

const touch = (team: Team, id: number | null = null) => ({ team, playerId: id });

function gk(s: GameState, team: Team) {
  return s.players.find((p) => p.team === team && p.gk)!;
}

/** Plays `outcomes` in order, each taken by whoever has the ball. */
function play(s: GameState, outcomes: Outcome[]): GameState {
  let cur = s;
  for (const o of outcomes) cur = resolveOutcome(cur, cur.possession!, o);
  return cur;
}

describe('match log and stats (M15.3)', () => {
  const s0 = draftedMatch(5);

  it('starts empty and gets one entry per kick', () => {
    expect(s0.log).toEqual([]);
    const s = play(s0, [{ kind: 'stop', x: 3, z: 3, lastTouch: touch(0), touches: 0 }]);
    expect(s.log).toHaveLength(1);
    expect(s.log[0]).toMatchObject({ n: 1, half: 1, team: 0, player: null, restart: 'kickoff', result: 'stop', shot: 0, scored: null });
  });

  it('does not mutate the previous state', () => {
    const before = s0.log;
    play(s0, [{ kind: 'stop', x: 3, z: 3, lastTouch: touch(0), touches: 0 }]);
    expect(s0.log).toBe(before);
    expect(s0.log).toEqual([]);
  });

  it('counts goals, shots, saves and corners from a short crafted match', () => {
    const redKeeper = gk(s0, 0);
    const blueKeeper = gk(s0, 1);
    const s = play(s0, [
      // 1. Red kicks off straight into Blue's goal (goalOf = Blue = 1): a goal for Red.
      { kind: 'goal', goalOf: 1, z: 0, lastTouch: touch(0), touches: 0 },
      // 2. Blue kicks off, Blue's shot is caught by Red's keeper: a save for Red.
      { kind: 'catch', keeperId: redKeeper.id },
      // 3. Red's keeper kicks, ball goes over Blue's goal line (x > 0): Red shot off target.
      { kind: 'out', line: 'goal', x: 52.5, z: 9, lastTouch: touch(0), touches: 0 },
      // 4. Blue's keeper kicks it over the touchline: no shot.
      { kind: 'out', line: 'touch', x: 10, z: 34, lastTouch: touch(1), touches: 0 },
    ]);
    expect(s.score).toEqual([1, 0]);
    expect(s.log.map((e) => e.result)).toEqual(['goal', 'catch', 'goalline', 'touch']);
    expect(s.log.map((e) => e.shot)).toEqual([2, 2, 1, 0]);
    expect(s.log[0]!.scored).toBe(0);
    expect(s.log[1]!.keeper).toBe(redKeeper.id);
    const st = matchStats(s.log);
    expect(st[0]).toMatchObject({ goals: 1, shots: 2 /* goal + wide */, saves: 1, kicks: 2 });
    expect(st[1]).toMatchObject({ goals: 0, shots: 1, onTarget: 1, saves: 0, kicks: 2 });
    expect(st[0].possession + st[1].possession).toBe(100);
    expect(st[0].possession).toBe(50);
    expect(blueKeeper.id).not.toBe(redKeeper.id);
  });

  it('a keeper catching their own team\'s kick is not a shot or a save', () => {
    const redKeeper = gk(s0, 0);
    const s = play(s0, [{ kind: 'catch', keeperId: redKeeper.id }]);
    expect(s.log[0]!.shot).toBe(0);
    expect(matchStats(s.log)[0].saves).toBe(0);
    expect(matchStats(s.log)[1].saves).toBe(0);
  });

  it('own goals count for the opponent and are flagged; a throw-in goal that does not count is a shot, not a goal', () => {
    // Red kicks off, Blue defender touches it in, then it goes into Blue's own goal? No: own goal = last touch by the goal's team.
    const own = play(s0, [{ kind: 'goal', goalOf: 0, z: 0, lastTouch: touch(0, 3), touches: 1 }]);
    expect(own.log[0]).toMatchObject({ result: 'goal', scored: 1, own: true, shot: 0 });
    expect(matchStats(own.log)[1].goals).toBe(1);

    const thrower = { ...s0.possession!, team: 0 as Team, restart: 'throwin' as const };
    const s = resolveOutcome({ ...s0, possession: thrower }, thrower, { kind: 'goal', goalOf: 1, z: 0, lastTouch: touch(0), touches: 0 });
    expect(s.log[0]).toMatchObject({ result: 'nogoal', scored: null, shot: 2 });
    expect(matchStats(s.log)[0]).toMatchObject({ goals: 0, shots: 1, onTarget: 1 });
  });

  it('goals in the log always equal the score, and possession is the share of kicks', () => {
    const goal = (to: Team): Outcome => ({ kind: 'goal', goalOf: to, z: 0, lastTouch: touch(to === 0 ? 1 : 0), touches: 0 });
    const stop: Outcome = { kind: 'stop', x: 0, z: 0, lastTouch: touch(0), touches: 0 };
    const s = play(s0, [goal(1), goal(0), stop, stop, goal(1)]);
    const st = matchStats(s.log);
    expect(st[0].goals).toBe(s.score[0]);
    expect(st[1].goals).toBe(s.score[1]);
    expect(st[0].kicks + st[1].kicks).toBe(5);
    expect(st[0].possession + st[1].possession).toBe(100);
  });

  it('records the half, the awarded restart and who takes it', () => {
    const s1 = draftedMatch(5, { kicksPerMatch: 10 });
    const stop: Outcome = { kind: 'stop', x: 0, z: 0, lastTouch: touch(0), touches: 0 };
    const s = play(s1, [stop, stop, stop, stop, stop]);
    expect(s.half).toBe(2);
    expect(s.log[4]).toMatchObject({ n: 5, half: 1, awarded: 'kickoff', nextTeam: 1 });
    const done = play(s, [stop, stop, stop, stop, stop]);
    expect(done.phase).toBe('fulltime');
    expect(done.log).toHaveLength(10);
    expect(done.log[9]).toMatchObject({ n: 10, half: 2, nextTeam: null });
    expect(done.log[5]!.half).toBe(2);
  });

  it('a new match / rematch starts with an empty log; the log passes the protocol guard', () => {
    const s = play(s0, [{ kind: 'catch', keeperId: gk(s0, 1).id }, { kind: 'out', line: 'touch', x: 1, z: -34, lastTouch: touch(0), touches: 0 }]);
    expect(isGameState(JSON.parse(JSON.stringify(s)))).toBe(true);
    expect(isGameState({ ...s, log: [{ ...s.log[0], result: 'bogus' }] })).toBe(false);
    expect(isGameState({ ...s, log: undefined })).toBe(false);
  });
});
