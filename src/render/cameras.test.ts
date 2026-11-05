// Inspect presets (M1.5): the top-down view frames the whole pitch with +x to the right.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../game/settings';
import { derivePitch } from '../shared/pitch';
import { inspectPose, type InspectPreset } from './cameras';
import { APRON } from './pitch';

function ndc(preset: InspectPreset, aspect: number, x: number, z: number, size = DEFAULT_SETTINGS): THREE.Vector3 {
  const pitch = derivePitch(size);
  const cam = new THREE.PerspectiveCamera(50, aspect, 0.1, 3000);
  const pose = inspectPose(preset, pitch, aspect, 50);
  cam.position.copy(pose.position);
  cam.lookAt(pose.target);
  cam.updateMatrixWorld();
  return new THREE.Vector3(x, 0, z).project(cam);
}

describe('inspectPose', () => {
  for (const aspect of [16 / 9, 4 / 3, 1, 0.6]) {
    for (const size of [DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, pitchLength: 120, pitchWidth: 90 }]) {
      it(`top-down frames the pitch + apron (aspect ${aspect.toFixed(2)}, ${size.pitchLength}×${size.pitchWidth})`, () => {
        const hl = size.pitchLength / 2 + APRON;
        const hw = size.pitchWidth / 2 + APRON;
        for (const [x, z] of [
          [-hl, -hw],
          [hl, -hw],
          [hl, hw],
          [-hl, hw],
        ] as const) {
          const p = ndc('top', aspect, x, z, size);
          expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
        }
      });
    }
  }

  it('top-down: +x is screen right, +z is screen down, centered', () => {
    const c = ndc('top', 16 / 9, 0, 0);
    expect(c.x).toBeCloseTo(0, 6);
    expect(c.y).toBeCloseTo(0, 6);
    expect(ndc('top', 16 / 9, 10, 0).x).toBeGreaterThan(0.05);
    expect(ndc('top', 16 / 9, 0, 10).y).toBeLessThan(-0.05);
  });

  it('behind-goal presets sit behind their goal lines looking toward the center', () => {
    const pitch = derivePitch(DEFAULT_SETTINGS);
    const a = inspectPose('behindA', pitch, 16 / 9, 50);
    const b = inspectPose('behindB', pitch, 16 / 9, 50);
    expect(a.position.x).toBeLessThan(-pitch.halfLength);
    expect(a.target.x).toBeGreaterThan(a.position.x);
    expect(b.position.x).toBeGreaterThan(pitch.halfLength);
    expect(b.target.x).toBeLessThan(b.position.x);
  });
});
