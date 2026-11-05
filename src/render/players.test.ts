// Placeholder figures (M4.2) must stay inside their physics hitboxes (§5.2),
// so what you see never looks thinner or shorter than what the ball hits.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HITBOX, type HitboxShape } from '../sim/constants';
import { buildFigureGeometry, buildHitboxGeometry } from './players';

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

describe('placeholder figures', () => {
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
