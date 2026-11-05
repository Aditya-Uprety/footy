// Humanoid figures (M4.2, M12.1) must stay inside their physics hitboxes (§5.2),
// so what you see never looks thinner or shorter than what the ball hits.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HITBOX, type HitboxShape } from '../sim/constants';
import { buildFigureGeometry, buildHitboxGeometry, lookFor, swayPose, type Look } from './players';

/** How far a point sticks out of the hitbox (≤ 0 = inside). */
function outside(shape: HitboxShape, x: number, y: number, z: number): number {
  if (y < -1e-6) return -y;
  const rad = Math.sqrt(x * x + z * z);
  if (y <= shape.HC) return rad - shape.R;
  const dy = y - shape.HC;
  return Math.sqrt(rad * rad + dy * dy) - shape.R;
}

function worst(geo: THREE.BufferGeometry, shape: HitboxShape): number {
  const pos = geo.getAttribute('position');
  let w = -Infinity;
  for (let i = 0; i < pos.count; i++) w = Math.max(w, outside(shape, pos.getX(i), pos.getY(i), pos.getZ(i)));
  return w;
}

describe('humanoid figures', () => {
  for (const gk of [false, true]) {
    const shape = gk ? HITBOX.GK : HITBOX.OUTFIELD;
    it(`${gk ? 'keeper' : 'outfield'} figure fits inside its hitbox`, () => {
      const geo = buildFigureGeometry(gk, 0xff0000);
      expect(worst(geo, shape)).toBeLessThanOrEqual(1e-6);
      // …and isn't a tiny blob either: it reaches most of the hitbox height.
      geo.computeBoundingBox();
      expect(geo.boundingBox!.max.y).toBeGreaterThan(0.8 * (shape.HC + shape.R));
    });
  }

  it('keeper arms are spread wider than an outfield player', () => {
    const of = buildFigureGeometry(false, 0);
    const gk = buildFigureGeometry(true, 0);
    of.computeBoundingBox();
    gk.computeBoundingBox();
    expect(gk.boundingBox!.max.z).toBeGreaterThan(0.7 * HITBOX.GK.R);
    expect(gk.boundingBox!.max.z).toBeGreaterThan(of.boundingBox!.max.z * 1.8);
  });

  it('every look (skin, hair, style) stays inside the hitbox and keeps its height', () => {
    for (let id = 1; id <= 22; id++) {
      const look = lookFor(id);
      for (const gk of [false, true]) {
        const shape = gk ? HITBOX.GK : HITBOX.OUTFIELD;
        const geo = buildFigureGeometry(gk, 0x2c63d6, look);
        expect(worst(geo, shape)).toBeLessThanOrEqual(1e-6);
        geo.computeBoundingBox();
        expect(geo.boundingBox!.max.y).toBeGreaterThan(0.8 * (shape.HC + shape.R));
        expect(geo.boundingBox!.min.y).toBeGreaterThanOrEqual(-1e-6);
      }
    }
  });

  it('is a single vertex-coloured mesh with several colours', () => {
    const geo = buildFigureGeometry(false, 0xd8352f, lookFor(3));
    const col = geo.getAttribute('color');
    const seen = new Set<string>();
    for (let i = 0; i < col.count; i++) seen.add(`${col.getX(i).toFixed(3)},${col.getY(i).toFixed(3)},${col.getZ(i).toFixed(3)}`);
    expect(seen.size).toBeGreaterThanOrEqual(5); // kit (shirt + socks), shorts, boots, skin, hair
    expect(geo.getAttribute('position').count).toBeLessThan(6000); // low-poly
  });

  it('keepers wear gloves and a kit of their own (more colours at the hands)', () => {
    const geo = buildFigureGeometry(true, 0xf0cf2a, lookFor(1));
    const pos = geo.getAttribute('position');
    const col = geo.getAttribute('color');
    let glovePts = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getZ(i)) > 0.6 && col.getX(i) > 0.85 && col.getY(i) > 0.85 && col.getZ(i) > 0.85) glovePts++;
    }
    expect(glovePts).toBeGreaterThan(10);
  });

  it('lookFor is deterministic and varied', () => {
    expect(lookFor(5)).toEqual(lookFor(5));
    const skins = new Set<number>();
    const hairs = new Set<number>();
    for (let id = 1; id <= 22; id++) {
      const l: Look = lookFor(id);
      skins.add(l.skin);
      hairs.add(l.hair);
    }
    expect(skins.size).toBeGreaterThanOrEqual(3);
    expect(hairs.size).toBeGreaterThanOrEqual(3);
  });

  it('idle sway is tiny, smooth and out of phase between players', () => {
    let maxLean = 0;
    for (let t = 0; t < 30; t += 0.05) {
      const a = swayPose(t, 0.3);
      maxLean = Math.max(maxLean, Math.abs(a.lean), Math.abs(a.nod));
      expect(Math.abs(a.stretch - 1)).toBeLessThan(0.01);
    }
    expect(maxLean).toBeLessThan(0.03); // under ~1.7°
    expect(maxLean).toBeGreaterThan(0.005); // but it does move
    expect(swayPose(2, 0).lean).not.toBeCloseTo(swayPose(2, 2.4).lean, 3);
  });

  it('hitbox wireframes match the physics shapes', () => {
    for (const shape of [HITBOX.OUTFIELD, HITBOX.GK]) {
      const geo = buildHitboxGeometry(shape);
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      expect(b.max.y).toBeCloseTo(shape.HC + shape.R, 6);
      expect(b.min.y).toBeCloseTo(0, 6);
      expect(b.max.x).toBeCloseTo(shape.R, 6);
      expect(Math.abs(worst(geo, shape))).toBeLessThan(1e-6);
    }
  });
});
