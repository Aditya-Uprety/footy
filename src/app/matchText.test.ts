import { describe, expect, it } from 'vitest';
import { resolveOutcome } from '../game/rules';
import { draftedMatch } from '../game/testUtil';
import type { GameState, Outcome, Possession } from '../game/types';
import {
  afterKickToast,
  eventToast,
  kickCounter,
  logLine,
  possessionText,
  resultText,
  scoreLine,
  timerText,
} from './matchText';
import { createShotTimer, SHOT_TIMER_WARN } from './shotTimer';

const touch = (team: 0 | 1, id: number | null = null) => ({ team, playerId: id });

function gk(s: GameState, team: 0 | 1) {
  return s.players.find((p) => p.team === team && p.gk)!;
}

describe('match text (M8.3)', () => {
  const s = draftedMatch(5);

  it('kick counter shows the kick about to be taken and the half', () => {
    expect(kickCounter(s)).toBe('Kick 1/40 · 1st half');
    expect(kickCounter({ ...s, kicksTaken: 20, half: 2 })).toBe('Kick 21/40 · 2nd half');
    expect(kickCounter({ ...s, kicksTaken: 40, half: 2 })).toBe('Kick 40/40 · 2nd half');
  });

  it('possession banner names the kicker or the restart', () => {
    expect(possessionText(s, s.possession!)).toBe('Kickoff — Red');
    const k = gk(s, 1);
    expect(possessionText(s, { team: 1, kicker: { kind: 'player', playerId: k.id }, restart: 'goalkick' })).toBe('Goal kick — Blue #1 (GK)');
    const out = s.players.find((p) => p.team === 0 && !p.gk)!;
    expect(possessionText(s, { team: 0, kicker: { kind: 'player', playerId: out.id }, restart: 'open' })).toBe(`Red #${out.shirt} on the ball`);
    const corner: Possession = { team: 1, kicker: { kind: 'ghost', x: 52, y: 0.11, z: 33.5 }, restart: 'corner' };
    expect(possessionText(s, corner)).toBe('Corner — Blue');
  });

  it('live event toasts: goal, save, out, post (not in the tail)', () => {
    const k = gk(s, 0);
    expect(eventToast({ kind: 'goal', t: 1, goalOf: 1 }, s.players)?.text).toBe('GOAL!');
    expect(eventToast({ kind: 'catch', t: 1, keeperId: k.id, x: 0, y: 1, z: 0 }, s.players)).toEqual({ text: 'Saved!', kind: 'save', sub: 'Red #1 (GK)' });
    expect(eventToast({ kind: 'out', t: 1, line: 'touch', x: 3, z: 34 }, s.players)?.kind).toBe('out');
    expect(eventToast({ kind: 'post', t: 1, x: 0, y: 1, z: 0, speed: 9 }, s.players)?.text).toBe('Off the post!');
    expect(eventToast({ kind: 'post', t: 1, x: 0, y: 1, z: 0, speed: 9, tail: true }, s.players)).toBeNull();
    expect(eventToast({ kind: 'ground', t: 1, x: 0, y: 0, z: 0, speed: 3 }, s.players)).toBeNull();
  });

  it('after-kick toasts: goal with the score, restarts, disallowed throw-in goal', () => {
    const goal: Outcome = { kind: 'goal', goalOf: 1, z: 0, lastTouch: touch(0), touches: 0 };
    const afterGoal = resolveOutcome(s, s.possession!, goal);
    expect(afterKickToast(s, afterGoal)).toEqual({ text: 'Goal — Red', kind: 'goal', sub: 'Red 1 – 0 Blue' });

    const own: Outcome = { kind: 'goal', goalOf: 0, z: 0, lastTouch: touch(0, 3), touches: 1 };
    expect(afterKickToast(s, resolveOutcome(s, s.possession!, own))?.sub).toBe('Own goal · Red 0 – 1 Blue');

    const touchOut: Outcome = { kind: 'out', line: 'touch', x: 10, z: 34, lastTouch: touch(0), touches: 0 };
    expect(afterKickToast(s, resolveOutcome(s, s.possession!, touchOut))?.text).toBe('Throw-in — Blue');

    const wide: Outcome = { kind: 'out', line: 'goal', x: 52.5, z: 12, lastTouch: touch(0), touches: 0 };
    expect(afterKickToast(s, resolveOutcome(s, s.possession!, wide))?.text).toBe('Goal kick — Blue');

    const offDefender: Outcome = { kind: 'out', line: 'goal', x: 52.5, z: -12, lastTouch: touch(1, 30), touches: 1 };
    expect(afterKickToast(s, resolveOutcome(s, s.possession!, offDefender))?.text).toBe('Corner — Red');

    const throwIn: Possession = { team: 0, kicker: { kind: 'ghost', x: 40, y: 1.8, z: 33.89 }, restart: 'throwin' };
    const straight: Outcome = { kind: 'goal', goalOf: 1, z: 1, lastTouch: touch(0), touches: 0 };
    expect(afterKickToast(s, resolveOutcome(s, throwIn, straight))).toEqual({ text: 'No goal', kind: 'info', sub: 'Straight from a throw-in' });

    const stop: Outcome = { kind: 'stop', x: 5, z: 5, lastTouch: touch(0), touches: 0 };
    expect(afterKickToast(s, resolveOutcome(s, s.possession!, stop))).toBeNull();
  });

  it('no after-kick toast at half-time or full-time (they have overlays)', () => {
    const stop: Outcome = { kind: 'stop', x: 5, z: 5, lastTouch: touch(0), touches: 0 };
    const beforeHalf = { ...s, kicksTaken: 19 };
    const half = resolveOutcome(beforeHalf, s.possession!, stop);
    expect(half.half).toBe(2);
    expect(afterKickToast(beforeHalf, half)).toBeNull();
    const beforeEnd = { ...s, kicksTaken: 39, half: 2 as const };
    const end = resolveOutcome(beforeEnd, s.possession!, { kind: 'goal', goalOf: 1, z: 0, lastTouch: touch(0), touches: 0 });
    expect(end.phase).toBe('fulltime');
    expect(afterKickToast(beforeEnd, end)).toBeNull();
  });

  it('result text: winner with seat name, or a draw', () => {
    expect(resultText({ ...s, score: [1, 1] })).toEqual({ headline: 'Draw', team: null });
    const seatA = s.toss.teamOfSeat![0] === 0 ? 0 : 1;
    expect(resultText({ ...s, score: [2, 1] })).toEqual({ headline: `Red wins — ${s.seatNames[seatA]}`, team: 0 });
    expect(resultText({ ...s, score: [0, 3] }).team).toBe(1);
    expect(scoreLine({ score: [2, 1] })).toBe('Red 2 – 1 Blue');
  });

  it('timer text rounds up', () => {
    expect(timerText(20)).toBe('20');
    expect(timerText(4.01)).toBe('5');
    expect(timerText(0.2)).toBe('1');
    expect(timerText(0)).toBe('0');
  });
});

describe('shot timer (M8.3)', () => {
  it('counts down only while running and fires exactly once at 0', () => {
    const t = createShotTimer(20);
    expect(t.update(5)).toBe(false);
    expect(t.remaining).toBe(20);
    t.start();
    expect(t.running).toBe(true);
    expect(t.update(14)).toBe(false);
    expect(t.warn).toBe(false);
    expect(t.update(1.5)).toBe(false);
    expect(t.warn).toBe(true);
    expect(t.remaining).toBeLessThan(SHOT_TIMER_WARN);
    expect(t.update(10)).toBe(true);
    expect(t.remaining).toBe(0);
    expect(t.running).toBe(false);
    expect(t.update(1)).toBe(false);
  });

  it('stop pauses; start restarts from full', () => {
    const t = createShotTimer(10);
    t.start();
    t.update(3);
    t.stop();
    expect(t.update(100)).toBe(false);
    expect(t.remaining).toBe(7);
    t.start();
    expect(t.remaining).toBe(10);
    expect(t.fraction).toBe(1);
  });

  it('0 seconds = off: never runs or fires', () => {
    const t = createShotTimer(0);
    t.start();
    expect(t.running).toBe(false);
    expect(t.update(100)).toBe(false);
  });
});

describe('match log text (M15.3)', () => {
  const s = draftedMatch(5);
  const line = (o: Outcome, p: Possession = s.possession!) => {
    const next = resolveOutcome(s, p, o);
    return logLine(next.log[0]!, next.players);
  };

  it('names the kicker or the restart, the result and what comes next', () => {
    const goal = line({ kind: 'goal', goalOf: 1, z: 0, lastTouch: touch(0), touches: 0 });
    expect(goal).toMatchObject({ n: 1, team: 0, goal: true, who: 'Red · kickoff', what: 'GOAL — Red', then: 'Kickoff — Blue' });
    const own = line({ kind: 'goal', goalOf: 0, z: 0, lastTouch: touch(0, 3), touches: 1 });
    expect(own.what).toBe('Own goal — Blue score');
    expect(line({ kind: 'out', line: 'touch', x: 3, z: 34, lastTouch: touch(0), touches: 0 })).toMatchObject({ what: 'Out — touchline', then: 'Throw-in — Blue' });
    expect(line({ kind: 'out', line: 'goal', x: 52.5, z: 9, lastTouch: touch(0), touches: 0 })).toMatchObject({ what: 'Shot off target — over the goal line', then: 'Goal kick — Blue' });
    const saved = line({ kind: 'catch', keeperId: gk(s, 1).id });
    expect(saved.what).toBe('Saved by Blue #1 (GK)');
    expect(saved.then).toBe("Keeper's ball — Blue");
    expect(line({ kind: 'stop', x: 0, z: 0, lastTouch: touch(0), touches: 0 }).then).toBe('');
  });
});
