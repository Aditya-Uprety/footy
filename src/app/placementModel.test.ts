import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../game/settings';
import type { PlayerSpot, Team } from '../game/types';
import { createPlacementModel, type PickState } from './placementModel';

const settings = defaultSettings();
function pl(id: number, team: Team, x: number, z: number, gk = false): PlayerSpot {
  return { id, team, x, z, gk, shirt: gk ? 1 : id + 1 };
}
function st(pick: number, players: PlayerSpot[] = []): PickState {
  return { settings, pick, players };
}
const codes = (vs: { code: string }[]) => vs.map((v) => v.code);

describe('placement model: tentative spots (M7.4)', () => {
  it('places up to the pick count, then refuses', () => {
    const m = createPlacementModel(st(1), 1);
    expect(m.count).toBe(2);
    expect(m.add(20, 10)).toEqual([]);
    expect(m.add(20, -10)).toEqual([]);
    expect(m.remaining).toBe(0);
    expect(codes(m.add(30, 0))).toEqual(['count']);
    expect(m.spots).toHaveLength(2);
  });

  it('refuses illegal spots with the reason and keeps the list unchanged', () => {
    const m = createPlacementModel(st(1, [pl(1, 0, -20, 0)]), 1);
    expect(codes(m.add(0, 3))).toEqual(['centerCircle']);
    expect(codes(m.add(-17, 0))).toEqual(['opponent']);
    expect(codes(m.add(60, 0))).toEqual(['bounds']);
    expect(m.spots).toHaveLength(0);
    // The pick's own spots count as teammates.
    m.add(20, 0);
    expect(codes(m.add(25, 0))).toEqual(['teammate']);
    expect(m.check(25, 0)[0]!.message).toMatch(/teammate \(5 m, needs 8 m\)/);
  });

  it('moves a spot (ignoring itself), undoes, removes', () => {
    const m = createPlacementModel(st(1), 1);
    m.add(20, 0);
    m.add(30, 0);
    expect(m.move(0, 22, 0)).toEqual([]); // 8 m from the other spot, ignoring its own old place
    expect(codes(m.move(0, 25, 0))).toEqual(['teammate']);
    expect(m.spots[0]).toMatchObject({ x: 22, z: 0 });
    expect(m.spotAt(22.5, 0.5, 1.5)).toBe(0);
    expect(m.spotAt(26, 0, 1.5)).toBe(-1);
    m.undo();
    expect(m.spots).toHaveLength(1);
    m.remove(0);
    expect(m.spots).toHaveLength(0);
  });

  it('Confirm is blocked until the pick is full and legal', () => {
    const m = createPlacementModel(st(1), 1);
    expect(m.issues()[0]!.message).toBe('Place 2 more players');
    m.add(20, 10);
    expect(m.issues()[0]!.message).toBe('Place 1 more player');
    m.add(20, -10);
    expect(m.issues()).toEqual([]);
    expect(m.preview().map((p) => [p.id, p.team, p.shirt])).toEqual([
      [1, 1, 2],
      [2, 1, 3],
    ]);
  });
});

describe('placement model: keeper toggle (M7.3)', () => {
  it('the toggle makes the next spot a keeper, which must stand in its own box', () => {
    const m = createPlacementModel(st(0), 0);
    expect(m.gk()).toMatchObject({ has: false, forced: false, locked: false, next: false, toggleable: true });
    m.toggleGk();
    expect(m.gk().next).toBe(true);
    expect(codes(m.check(-20, 0))).toEqual(['gkBox']);
    expect(m.add(-48, 0)).toEqual([]);
    expect(m.spots[0]!.gk).toBe(true);
    // One keeper per team: the toggle switches off and can't come back.
    expect(m.gk()).toMatchObject({ has: true, next: false, toggleable: false });
    expect(m.toggleGk()).toBe(false);
  });

  it('is disabled once the team has a confirmed keeper', () => {
    const m = createPlacementModel(st(2, [pl(1, 0, -48, 0, true), pl(2, 1, 20, 5), pl(3, 1, 20, -5)]), 0);
    expect(m.gk()).toMatchObject({ has: true, toggleable: false });
  });

  it('forced keeper: the last slot of the team’s last pick locks to keeper', () => {
    const nine: PlayerSpot[] = [];
    for (const x of [-34, -24, -14]) for (const z of [-20, 0, 20]) nine.push(pl(nine.length + 1, 0, x, z));
    const m = createPlacementModel(st(10, nine), 0);
    expect(m.gk()).toMatchObject({ forced: true, locked: false, next: false, toggleable: true });
    m.add(-4, 30); // outfield first
    expect(m.gk()).toMatchObject({ forced: true, locked: true, next: true, toggleable: false });
    expect(codes(m.check(-4, -30))).toEqual(['gkBox']);
    expect(m.add(-48, 10)).toEqual([]);
    expect(m.spots[1]!.gk).toBe(true);
    expect(m.issues()).toEqual([]);
    // Undoing the keeper puts the lock back.
    m.undo();
    expect(m.gk().locked).toBe(true);
  });

  it('dragging a keeper keeps it a keeper', () => {
    const m = createPlacementModel(st(0), 0);
    m.toggleGk();
    m.add(-48, 0);
    expect(codes(m.move(0, -30, 0))).toEqual(['gkBox']);
    expect(m.move(0, -45, 5)).toEqual([]);
    expect(m.spots[0]).toEqual({ x: -45, z: 5, gk: true });
  });

  it("refuses spots in the opponent's box (M17)", () => {
    const m = createPlacementModel(st(0), 0);
    expect(codes(m.check(48, 0))).toEqual(['opponentBox']);
    expect(m.check(30, 0)).toEqual([]);
  });

  it('no forced keeper when an outfield teammate already stands in the own box (M17)', () => {
    const nine: PlayerSpot[] = [];
    for (const x of [-34, -24, -14]) for (const z of [-20, 0, 20]) nine.push(pl(nine.length + 1, 0, x, z));
    nine[8] = pl(9, 0, -45, 0);
    const m = createPlacementModel(st(10, nine), 0);
    expect(m.gk()).toMatchObject({ forced: false, locked: false, toggleable: true });
    m.add(-4, 30);
    expect(m.add(-4, -30)).toEqual([]);
    expect(m.issues()).toEqual([]);
  });

  it('refuses a pick that is not this team’s', () => {
    expect(() => createPlacementModel(st(0), 1)).toThrow();
  });
});
