// Map content and orientation (M5.4): positions only, kicker at its own center,
// no ball while aiming, Team A's goal on the left.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../game/settings';
import { derivePitch } from '../shared/pitch';
import { PHYS } from '../sim/constants';
import { kickStart } from '../sim/kick';
import type { KickOrigin } from '../sim/types';
import { minimapTransform, MINIMAP_WIDTH } from '../ui/minimap';
import { mapContent } from './overheadMap';

const pitch = derivePitch(DEFAULT_SETTINGS);
const players = [
  { id: 1, team: 0 as const, gk: true, x: -48, z: 1, shirt: 1 },
  { id: 2, team: 0 as const, gk: false, x: -20, z: 10, shirt: 7 },
  { id: 3, team: 1 as const, gk: false, x: 15, z: -5, shirt: 9 },
];

describe('map content', () => {
  it('rings a player kicker at its own center, not at the ball', () => {
    const kicker: KickOrigin = { kind: 'player', playerId: 2, team: 0, x: -20, z: 10, gk: false };
    const c = mapContent(players, kicker, null);
    expect(c.kicker).toEqual({ x: -20, z: 10, id: 2 });
    const ball = kickStart(kicker, 1.1);
    expect(c.kicker!.x).not.toBeCloseTo(ball.x, 3);
    expect(c.ball).toBeNull();
  });

  it('carries no facing information: only id, team, gk, position and shirt', () => {
    const c = mapContent(players.map((p) => ({ ...p, yaw: 2 })), null, null);
    for (const p of c.players) expect(Object.keys(p).sort()).toEqual(['gk', 'id', 'shirt', 'team', 'x', 'z']);
  });

  it('a ghost taker is ringed at its spot; the ball appears only when given', () => {
    const c = mapContent(players, { kind: 'ghost', x: 0, y: PHYS.BALL_R, z: 0 }, { x: 3, z: 4 });
    expect(c.kicker).toEqual({ x: 0, z: 0, id: null });
    expect(c.ball).toEqual({ x: 3, z: 4 });
  });
});

describe('minimap transform', () => {
  it("puts Team A's goal on the left and +z down; fits the pitch with its margin", () => {
    const t = minimapTransform(pitch);
    expect(t.width).toBe(MINIMAP_WIDTH);
    const a = t.toCanvas(-pitch.halfLength, 0);
    const b = t.toCanvas(pitch.halfLength, 0);
    expect(a.px).toBeLessThan(b.px);
    expect(t.toCanvas(0, 10).py).toBeGreaterThan(t.toCanvas(0, -10).py);
    expect(a.px).toBeGreaterThan(0);
    expect(b.px).toBeLessThan(t.width);
    expect(t.toCanvas(0, pitch.halfWidth).py).toBeLessThan(t.height);
    expect(t.toCanvas(0, 0)).toEqual({ px: t.width / 2, py: t.height / 2 });
  });

  it('orientation −1 rotates the map 180°', () => {
    const t = minimapTransform(pitch, MINIMAP_WIDTH, -1);
    expect(t.toCanvas(-pitch.halfLength, 0).px).toBeGreaterThan(t.toCanvas(pitch.halfLength, 0).px);
    expect(t.toCanvas(0, 10).py).toBeLessThan(t.toCanvas(0, -10).py);
  });
});
