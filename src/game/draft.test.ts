import { describe, expect, it } from 'vitest';
import { derivePitch } from '../shared/pitch';
import { createRng } from '../shared/rng';
import {
  DRAFT_SCHEDULE,
  findGkSpot,
  gkForced,
  gkSpotExists,
  PICK_COUNT,
  PLAYERS_PER_TEAM,
  randomPick,
  spotsToPlayers,
  validateSpots,
} from './draft';
import { defaultSettings } from './settings';
import type { PlayerSpot, SpotInput, Team } from './types';

const settings = defaultSettings();
const pitch = derivePitch(settings);

function pl(id: number, team: Team, x: number, z: number, gk = false): PlayerSpot {
  return { id, team, x, z, gk, shirt: gk ? 1 : id + 1 };
}
function st(pick: number, players: PlayerSpot[] = []) {
  return { settings, pick, players };
}
const codes = (vs: { code: string }[]) => vs.map((v) => v.code);

describe('draft schedule (§2.3.1)', () => {
  it('is A1 B2 A2 B2 A2 B2 A2 B2 A2 B2 A2 B1 = 11 each', () => {
    expect(PICK_COUNT).toBe(12);
    expect(DRAFT_SCHEDULE.map((p) => `${'AB'[p.team]}${p.count}`).join(' ')).toBe('A1 B2 A2 B2 A2 B2 A2 B2 A2 B2 A2 B1');
    for (const t of [0, 1] as Team[]) {
      expect(DRAFT_SCHEDULE.filter((p) => p.team === t).reduce((n, p) => n + p.count, 0)).toBe(PLAYERS_PER_TEAM);
    }
  });
});

describe('validateSpots (§2.3.4)', () => {
  it('accepts a legal first pick', () => {
    expect(validateSpots(st(0), 0, [{ x: -20, z: 5, gk: false }])).toEqual([]);
  });

  it('needs exactly the scheduled number of spots', () => {
    expect(codes(validateSpots(st(1), 1, [{ x: 20, z: 0, gk: false }]))).toContain('count');
    expect(codes(validateSpots(st(0), 0, []))).toEqual(['count']);
    expect(codes(validateSpots(st(12), 0, [{ x: 20, z: 0, gk: false }]))).toEqual(['count']);
  });

  it('a: 1 m line margin', () => {
    const half = pitch.halfLength;
    expect(codes(validateSpots(st(0), 0, [{ x: -(half - 0.5), z: 20, gk: false }]))).toEqual(['bounds']);
    expect(codes(validateSpots(st(0), 0, [{ x: 0 + 20, z: pitch.halfWidth - 0.99, gk: false }]))).toEqual(['bounds']);
    expect(validateSpots(st(0), 0, [{ x: -(half - 1), z: pitch.halfWidth - 1, gk: false }])).toEqual([]);
  });

  it('b: hitbox fully outside the center circle', () => {
    const r = pitch.centerCircleR;
    expect(codes(validateSpots(st(0), 0, [{ x: r + 0.3, z: 0, gk: false }]))).toEqual(['centerCircle']);
    expect(validateSpots(st(0), 0, [{ x: r + 0.4, z: 0, gk: false }])).toEqual([]);
  });

  it('c: keeper only inside its own penalty area; outfield anywhere incl. boxes', () => {
    expect(codes(validateSpots(st(0), 0, [{ x: -30, z: 0, gk: true }]))).toEqual(['gkBox']);
    expect(codes(validateSpots(st(0), 0, [{ x: 45, z: 0, gk: true }]))).toEqual(['gkBox']);
    expect(validateSpots(st(0), 0, [{ x: -48, z: 3, gk: true }])).toEqual([]);
    expect(validateSpots(st(0), 0, [{ x: 45, z: 0, gk: false }])).toEqual([]);
  });

  it('d: ≥ X from teammates, ≥ Y from opponents (incl. the same pick)', () => {
    const players = [pl(1, 0, -20, 0)];
    const v1 = validateSpots(st(1, players), 1, [{ x: -20, z: 3.9, gk: false }, { x: 20, z: 0, gk: false }]);
    expect(codes(v1)).toEqual(['opponent']);
    expect(v1[0]!.spot).toBe(0);
    expect(v1[0]!.message).toMatch(/opponent \(3\.9 m, needs 4 m\)/);
    expect(validateSpots(st(1, players), 1, [{ x: -20, z: 4, gk: false }, { x: 20, z: 0, gk: false }])).toEqual([]);
    const v2 = validateSpots(st(1, players), 1, [{ x: 20, z: 0, gk: false }, { x: 20, z: 7, gk: false }]);
    expect(codes(v2)).toEqual(['teammate', 'teammate']);
    expect(codes(validateSpots(st(2, [...players, pl(2, 1, 30, 0), pl(3, 1, 30, 10)]), 0, [{ x: -20, z: 7.5, gk: false }, { x: -40, z: 0, gk: false }]))).toEqual(['teammate']);
  });

  it('only one keeper per team', () => {
    const players = [pl(1, 0, -48, 0, true)];
    expect(codes(validateSpots(st(2, players), 0, [{ x: -45, z: 15, gk: true }, { x: -20, z: 0, gk: false }]))).toContain('gkCount');
    expect(codes(validateSpots(st(1), 1, [{ x: 48, z: 15, gk: true }, { x: 45, z: -5, gk: true }]))).toContain('gkCount');
  });

  it('reports non-finite numbers without crashing', () => {
    expect(codes(validateSpots(st(0), 0, [{ x: Number.NaN, z: 0, gk: false }]))).toEqual(['notFinite']);
  });
});

describe('forced keeper (§2.3.3)', () => {
  // A's nine outfielders, then pick 10 = A's last pick (A2) with no keeper yet.
  const nine: PlayerSpot[] = [];
  for (const x of [-40, -30, -20]) for (const z of [-20, 0, 20]) nine.push(pl(nine.length + 1, 0, x, z));
  it('is forced only on the team’s last pick', () => {
    expect(gkForced(st(10, nine), 0)).toBe(true);
    expect(gkForced(st(8, nine), 0)).toBe(false);
    expect(gkForced(st(11, []), 1)).toBe(true);
    expect(gkForced(st(11, [pl(1, 1, 48, 0, true)]), 1)).toBe(false);
  });
  it('rejects a last pick without a keeper, accepts one with', () => {
    const out: SpotInput = { x: -10, z: 25, gk: false };
    expect(codes(validateSpots(st(10, nine), 0, [out, { x: -48, z: 10, gk: false }]))).toEqual(['gkForced']);
    expect(validateSpots(st(10, nine), 0, [out, { x: -48, z: 10, gk: true }])).toEqual([]);
  });
});

describe('keeper feasibility guard (§2.3.4e)', () => {
  // Nine of B's outfielders tile its own box on an 8 m grid; one corner is still open.
  const tiles: PlayerSpot[] = [];
  for (const z of [-16, -8, 0, 8, 16]) tiles.push(pl(tiles.length + 1, 1, 40, z));
  for (const z of [-16, -8, 0, 8]) tiles.push(pl(tiles.length + 1, 1, 48, z));

  it('finds the last open keeper spot', () => {
    expect(gkSpotExists(pitch, settings, tiles, 1)).toBe(true);
    const s = findGkSpot(pitch, settings, tiles, 1)!;
    expect(s.x).toBeGreaterThan(48);
    expect(s.z).toBeGreaterThan(12);
  });

  it('blocks a pick that seals the team’s own box', () => {
    const v = validateSpots(st(9, tiles), 1, [{ x: 48, z: 16, gk: false }, { x: -20, z: 0, gk: false }]);
    expect(codes(v)).toEqual(['gkGuard']);
    expect(v[0]!.message).toMatch(/your keeper/);
    expect(gkSpotExists(pitch, settings, [...tiles, pl(99, 1, 48, 16)], 1)).toBe(false);
  });

  it('blocks a pick that seals the opponent’s box', () => {
    // A stands in the open corner; every remaining keeper spot is then < Y from it.
    const v = validateSpots(st(2, tiles), 0, [{ x: 50, z: 18, gk: false }, { x: -20, z: 0, gk: false }]);
    expect(codes(v)).toEqual(['gkGuard']);
    expect(v[0]!.message).toMatch(/other team's keeper/);
    // In the corner but leaving a gap is fine.
    expect(validateSpots(st(2, tiles), 0, [{ x: 51.5, z: 20, gk: false }, { x: -20, z: 0, gk: false }])).toEqual([]);
  });

  it('does not apply once the team has its keeper', () => {
    const withGk = [...tiles, pl(50, 1, 51, 19, true)];
    expect(validateSpots(st(9, withGk), 1, [{ x: 30, z: -25, gk: false }, { x: -20, z: 0, gk: false }])).toEqual([]);
  });
});

describe('randomPick + spotsToPlayers', () => {
  it('drafts a full legal 22-player layout for many seeds', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const rng = createRng(seed);
      let players: PlayerSpot[] = [];
      for (let pick = 0; pick < PICK_COUNT; pick++) {
        const { team } = DRAFT_SCHEDULE[pick]!;
        const spots = randomPick({ settings, pick, players }, team, rng);
        expect(validateSpots({ settings, pick, players }, team, spots)).toEqual([]);
        players = [...players, ...spotsToPlayers(players, team, spots)];
      }
      expect(players.map((p) => p.id)).toEqual(Array.from({ length: 22 }, (_, i) => i + 1));
      for (const t of [0, 1] as Team[]) {
        const mine = players.filter((p) => p.team === t);
        expect(mine).toHaveLength(11);
        expect(mine.filter((p) => p.gk)).toHaveLength(1);
        expect(mine.map((p) => p.shirt).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      }
    }
  });

  it('keeps the seat’s own legal spots', () => {
    const spots = randomPick(st(1), 1, createRng(3), [{ x: 25, z: 10, gk: false }]);
    expect(spots[0]).toEqual({ x: 25, z: 10, gk: false });
    expect(spots).toHaveLength(2);
  });
});
