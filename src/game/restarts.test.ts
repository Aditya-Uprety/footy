import { describe, expect, it } from 'vitest';
import { derivePitch } from '../shared/pitch';
import { PHYS } from '../sim/constants';
import { decideRestart } from './restarts';
import { defaultSettings } from './settings';
import type { Outcome, PlayerSpot, RestartKind, Team } from './types';

const settings = defaultSettings();
const pitch = derivePitch(settings);
const L2 = pitch.halfLength;
const W2 = pitch.halfWidth;
const players: PlayerSpot[] = [
  { id: 1, team: 0, x: -50, z: 2, gk: true, shirt: 1 },
  { id: 2, team: 1, x: 49, z: -3, gk: true, shirt: 1 },
  { id: 3, team: 0, x: -10, z: 20, gk: false, shirt: 2 },
  { id: 4, team: 1, x: 10, z: -20, gk: false, shirt: 2 },
];
const state = { settings, players };
const touch = (team: Team, n = 1) => ({ lastTouch: { team, playerId: n ? 99 : null }, touches: n });
const decide = (team: Team, outcome: Outcome, restart: RestartKind = 'open') => decideRestart(state, { team, restart }, outcome);

describe('goals (§2.6.1–2)', () => {
  it('counts for the attacking team; the conceding team kicks off from the center', () => {
    const d = decide(0, { kind: 'goal', goalOf: 1, z: 1, ...touch(0, 0) });
    expect(d.scored).toBe(0);
    expect(d.disallowed).toBe(false);
    expect(d.possession).toEqual({ team: 1, kicker: { kind: 'ghost', x: 0, y: PHYS.BALL_R, z: 0 }, restart: 'kickoff' });
  });
  it('an own goal counts for the opponent', () => {
    const d = decide(0, { kind: 'goal', goalOf: 0, z: -1, ...touch(0) });
    expect(d.scored).toBe(1);
    expect(d.possession.team).toBe(0);
    expect(d.awarded).toBe('kickoff');
  });
  it('a kickoff may score directly', () => {
    expect(decide(1, { kind: 'goal', goalOf: 0, z: 0, ...touch(1, 0) }, 'kickoff').scored).toBe(1);
  });
});

describe('throw-in goal exception (§2.6.1)', () => {
  it('straight into the opponent’s goal → goal kick to the defenders', () => {
    const d = decide(0, { kind: 'goal', goalOf: 1, z: 2, ...touch(0, 0) }, 'throwin');
    expect(d.scored).toBeNull();
    expect(d.disallowed).toBe(true);
    expect(d.possession).toEqual({ team: 1, kicker: { kind: 'player', playerId: 2 }, restart: 'goalkick' });
  });
  it('straight into the thrower’s own goal → corner to the opponent on that side', () => {
    const d = decide(1, { kind: 'goal', goalOf: 1, z: -2, ...touch(1, 0) }, 'throwin');
    expect(d.scored).toBeNull();
    expect(d.disallowed).toBe(true);
    expect(d.possession.team).toBe(0);
    expect(d.possession.restart).toBe('corner');
    expect(d.possession.kicker).toMatchObject({ kind: 'ghost', x: L2 - 0.5, z: -(W2 - 0.5) });
  });
  it('counts after a touch', () => {
    const d = decide(0, { kind: 'goal', goalOf: 1, z: 2, ...touch(1, 1) }, 'throwin');
    expect(d.scored).toBe(0);
    expect(d.disallowed).toBe(false);
  });
});

describe('touchline (§2.6.3)', () => {
  it('throw-in to the team that did not touch last, at the exit point', () => {
    const d = decide(0, { kind: 'out', line: 'touch', x: 12.5, z: W2, ...touch(0, 0) });
    expect(d.possession.team).toBe(1);
    expect(d.awarded).toBe('throwin');
    expect(d.possession.kicker).toEqual({ kind: 'ghost', x: 12.5, y: PHYS.THROW_HEIGHT, z: W2 - PHYS.BALL_R });
    const e = decide(0, { kind: 'out', line: 'touch', x: -L2 + 0.2, z: -W2, ...touch(1) });
    expect(e.possession.team).toBe(0);
    expect(e.possession.kicker).toMatchObject({ x: -(L2 - 1), z: -(W2 - PHYS.BALL_R) });
  });
  it('a throw straight back out goes to the other team', () => {
    expect(decide(1, { kind: 'out', line: 'touch', x: 0, z: W2, ...touch(1, 0) }, 'throwin').possession.team).toBe(0);
  });
});

describe('goal line, not a goal (§2.6.4): both ends × last-touch team', () => {
  const cases: { x: number; z: number; last: Team; team: Team; restart: RestartKind; kicker: object }[] = [
    // B's goal (x > 0), defended by B.
    { x: L2, z: 10, last: 0, team: 1, restart: 'goalkick', kicker: { kind: 'player', playerId: 2 } },
    { x: L2, z: 10, last: 1, team: 0, restart: 'corner', kicker: { kind: 'ghost', x: L2 - 0.5, z: W2 - 0.5 } },
    { x: L2, z: -10, last: 1, team: 0, restart: 'corner', kicker: { kind: 'ghost', x: L2 - 0.5, z: -(W2 - 0.5) } },
    // A's goal (x < 0), defended by A.
    { x: -L2, z: -8, last: 1, team: 0, restart: 'goalkick', kicker: { kind: 'player', playerId: 1 } },
    { x: -L2, z: -8, last: 0, team: 1, restart: 'corner', kicker: { kind: 'ghost', x: -(L2 - 0.5), z: -(W2 - 0.5) } },
    { x: -L2, z: 8, last: 0, team: 1, restart: 'corner', kicker: { kind: 'ghost', x: -(L2 - 0.5), z: W2 - 0.5 } },
  ];
  for (const c of cases) {
    it(`x=${c.x} z=${c.z} last touch ${'AB'[c.last]} → ${c.restart} to ${'AB'[c.team]}`, () => {
      for (const kicking of [0, 1] as Team[]) {
        const d = decide(kicking, { kind: 'out', line: 'goal', x: c.x, z: c.z, ...touch(c.last) });
        expect(d.possession.team).toBe(c.team);
        expect(d.awarded).toBe(c.restart);
        expect(d.possession.kicker).toMatchObject(c.kicker);
        expect(d.scored).toBeNull();
      }
    });
  }
});

describe('catch and stop (§2.5)', () => {
  it('a catch gives the keeper’s team the ball at the keeper', () => {
    const d = decide(0, { kind: 'catch', keeperId: 2 });
    expect(d.possession).toEqual({ team: 1, kicker: { kind: 'player', playerId: 2 }, restart: 'catch' });
  });
  it('a stop gives the ball to the closest player, ties to the non-kicking team', () => {
    expect(decide(0, { kind: 'stop', x: -9, z: 18, ...touch(0) }).possession).toEqual({ team: 0, kicker: { kind: 'player', playerId: 3 }, restart: 'open' });
    // Equidistant from #3 (−10, 20) and #4 (10, −20) → the non-kicking team.
    expect(decide(0, { kind: 'stop', x: 0, z: 0, ...touch(0) }).possession.kicker).toEqual({ kind: 'player', playerId: 4 });
    expect(decide(1, { kind: 'stop', x: 0, z: 0, ...touch(1) }).possession.kicker).toEqual({ kind: 'player', playerId: 3 });
  });
});
