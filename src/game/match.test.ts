// M6.6: rules + real physics together (kick() → simulateKick → resolveOutcome).
import { describe, expect, it } from 'vitest';
import { derivePitch } from '../shared/pitch';
import { createRng } from '../shared/rng';
import { PHYS } from '../sim/constants';
import { defaultYaw } from './host';
import { throwInPossession } from './restarts';
import { kick, kickCaps, resolveOutcome } from './rules';
import { draftedMatch } from './testUtil';
import type { GameState, Possession, RestartKind } from './types';

const pitch = derivePitch(draftedMatch(1).settings);

function withBall(s: GameState, possession: Possession, clearLane = false): GameState {
  const players = clearLane ? s.players.filter((p) => !(p.x > 30 && Math.abs(p.z) < 8)) : s.players;
  return { ...s, players, possession };
}

describe('rules with real kicks', () => {
  it('a real shot into B’s goal scores for A; B kicks off', () => {
    const s = withBall(draftedMatch(5), { team: 0, restart: 'open', kicker: { kind: 'ghost', x: 38, y: PHYS.BALL_R, z: 0 } }, true);
    const { result, next } = kick(s, 0, { yaw: 0, power: 0.6, curve: 0, loft: 0 });
    expect(result.outcome).toMatchObject({ kind: 'goal', goalOf: 1 });
    expect(next.score).toEqual([1, 0]);
    expect(next.possession).toMatchObject({ team: 1, restart: 'kickoff' });
  });

  it('a real kick over the touchline gives a throw-in to the other team’s player nearest the exit point', () => {
    const s = withBall(draftedMatch(5), { team: 0, restart: 'open', kicker: { kind: 'ghost', x: 10, y: PHYS.BALL_R, z: 30 } });
    const players = s.players.filter((p) => p.z < 20);
    const { result, next } = kick({ ...s, players }, 0, { yaw: Math.PI / 2, power: 0.5, curve: 0, loft: 0 });
    expect(result.outcome).toMatchObject({ kind: 'out', line: 'touch' });
    expect(result.outcome.kind === 'out' && result.outcome.line === 'touch').toBe(true);
    const out = result.outcome as Extract<typeof result.outcome, { kind: 'out' }>;
    const nearest = players.filter((p) => p.team === 1).sort((a, b) => Math.hypot(a.x - out.x, a.z - out.z) - Math.hypot(b.x - out.x, b.z - out.z))[0]!;
    expect(next.possession).toMatchObject({ team: 1, restart: 'throwin', kicker: { kind: 'player', playerId: nearest.id } });
    expect(kickCaps(next.possession!)).toEqual({});
  });

  it('a goal straight from a throw-in counts (M17: the throw-in is an ordinary kick)', () => {
    const base = draftedMatch(5);
    const s = withBall(base, throwInPossession(pitch, base.players, 0, 40, pitch.halfWidth));
    expect(s.possession!.kicker.kind).toBe('player');
    const next = resolveOutcome(s, s.possession!, { kind: 'goal', goalOf: 1, z: 1, lastTouch: { team: 0, playerId: null }, touches: 0 });
    expect(next.score).toEqual([1, 0]);
    expect(next.last).toMatchObject({ awarded: 'kickoff' });
    expect(next.last!.disallowed).toBeFalsy();
  });

  it('a corner is taken by a ghost taker in the right corner arc', () => {
    const s = withBall(draftedMatch(5), { team: 0, restart: 'open', kicker: { kind: 'ghost', x: 0, y: PHYS.BALL_R, z: 0 } });
    const next = resolveOutcome(s, s.possession!, { kind: 'out', line: 'goal', x: -pitch.halfLength, z: 12, lastTouch: { team: 0, playerId: 3 }, touches: 1 });
    expect(next.possession).toMatchObject({ team: 1, restart: 'corner', kicker: { kind: 'ghost', x: -(pitch.halfLength - 0.5), z: pitch.halfWidth - 0.5 } });
    // Taking it: the ball starts exactly at the corner spot, no caps.
    const { result } = kick(next, 1, { yaw: 0, power: 1, curve: 1, loft: 0.3 });
    expect(result.start).toMatchObject({ x: -(pitch.halfLength - 0.5), z: pitch.halfWidth - 0.5 });
    expect(result.input).toMatchObject({ power: 1, curve: 1 });
  });
});

describe('match invariants over random seeded matches', () => {
  it('every possession is valid and the score adds up', () => {
    const seen = new Set<RestartKind>();
    for (let seed = 1; seed <= 8; seed++) {
      let s = draftedMatch(seed);
      const rng = createRng(seed * 31);
      let goals: [number, number] = [0, 0];
      while (s.phase === 'play') {
        const p = s.possession!;
        if (p.kicker.kind === 'player') {
          const id = p.kicker.playerId;
          const k = s.players.find((q) => q.id === id);
          expect(k?.team).toBe(p.team);
          if (p.restart === 'goalkick' || p.restart === 'catch') expect(k?.gk).toBe(true);
        } else {
          expect(['kickoff', 'throwin', 'corner']).toContain(p.restart);
          expect(Math.abs(p.kicker.x)).toBeLessThanOrEqual(pitch.halfLength);
          expect(Math.abs(p.kicker.z)).toBeLessThanOrEqual(pitch.halfWidth);
        }
        seen.add(p.restart);
        const input = { yaw: defaultYaw(s) + rng.range(-0.6, 0.6), power: rng.range(0.2, 1), curve: rng.range(-1, 1), loft: rng.range(0, 0.7) };
        const { result, next } = kick(s, p.team, input);
        const o = result.outcome;
        if (o.kind === 'goal' && !next.last?.disallowed) goals[o.goalOf === 0 ? 1 : 0]++;
        s = next;
      }
      expect(s.kicksTaken).toBe(40);
      expect(s.score).toEqual(goals);
    }
    // Over several matches every restart kind shows up except possibly the rarer ones.
    expect(seen.has('kickoff') && seen.has('open')).toBe(true);
  });
});
