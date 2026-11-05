// Aim rig maths (M5.1): drag/key sensitivity, clamps, height keeps the ball
// on screen, and the ball always sits at the horizontal center of the view.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AIM_HEIGHT_MAX, AIM_HEIGHT_MIN, AIM_BALL_BELOW } from '../render/cameras';
import { DEG } from '../shared/math';
import { PHYS } from '../sim/constants';
import type { KickOrigin } from '../sim/types';
import {
  AIM,
  aimBall,
  aimStatePose,
  applyDrag,
  defaultAimPitch,
  noAimKeys,
  pinchFov,
  stepAimKeys,
  withHeight,
  zoomFov,
  type AimState,
} from './aimController';

const base = (): AimState => ({ yaw: 0, pitch: defaultAimPitch(AIM_HEIGHT_MIN), fov: AIM.FOV_DEFAULT, height: AIM_HEIGHT_MIN });

function project(origin: KickOrigin, s: AimState, aspect = 16 / 9): THREE.Vector3 {
  const pose = aimStatePose(origin, s);
  const cam = new THREE.PerspectiveCamera(s.fov, aspect, 0.05, 2000);
  cam.position.copy(pose.position);
  cam.lookAt(pose.target);
  cam.updateMatrixWorld();
  const b = aimBall(origin, s.yaw);
  return new THREE.Vector3(b.x, b.y, b.z).project(cam);
}

describe('aim drag and keys (§6.2)', () => {
  it('drag: 0.15°/px, Shift 0.03°/px; right turns right (toward r̂), up looks up', () => {
    const s = applyDrag(base(), 100, 0, false);
    expect(s.yaw).toBeCloseTo(15 * DEG, 10);
    expect(applyDrag(base(), 100, 0, true).yaw).toBeCloseTo(3 * DEG, 10);
    expect(applyDrag(base(), 0, -50, false).pitch).toBeGreaterThan(base().pitch);
  });

  it('a full 360° turn wraps the yaw', () => {
    let s = base();
    for (let i = 0; i < 24; i++) s = applyDrag(s, 100, 0, false); // 24 × 15° = 360°
    expect(Math.abs(s.yaw)).toBeLessThan(1e-9);
    s = applyDrag(base(), 1300, 0, false); // 195°
    expect(s.yaw).toBeCloseTo(-165 * DEG, 9);
  });

  it('pitch is clamped to −60°…+15°', () => {
    expect(applyDrag(base(), 0, 1e5, false).pitch).toBeCloseTo(AIM.PITCH_MIN, 12);
    expect(applyDrag(base(), 0, -1e5, false).pitch).toBeCloseTo(AIM.PITCH_MAX, 12);
  });

  it('arrow keys: 40°/s, Shift 6°/s', () => {
    const keys = { ...noAimKeys(), right: true };
    expect(stepAimKeys(base(), keys, 0.5, false).yaw).toBeCloseTo(20 * DEG, 10);
    expect(stepAimKeys(base(), keys, 0.5, true).yaw).toBeCloseTo(3 * DEG, 10);
    expect(stepAimKeys(base(), { ...noAimKeys(), left: true }, 0.25, false).yaw).toBeCloseTo(-10 * DEG, 10);
  });

  it('no keys held leaves the state untouched', () => {
    const s = base();
    expect(stepAimKeys(s, noAimKeys(), 1, false)).toBe(s);
  });

  it('zoom: wheel and +/− stay within 20°–75°', () => {
    expect(zoomFov(60, 1e6)).toBe(AIM.FOV_MAX);
    expect(zoomFov(60, -1e6)).toBe(AIM.FOV_MIN);
    expect(zoomFov(60, -100)).toBeLessThan(60);
    const s = stepAimKeys(base(), { ...noAimKeys(), zoomIn: true }, 10, false);
    expect(s.fov).toBe(AIM.FOV_MIN);
  });

  it('camera height stays within 1.7–8 m (PageUp/PageDown)', () => {
    expect(stepAimKeys(base(), { ...noAimKeys(), higher: true }, 100, false).height).toBe(AIM_HEIGHT_MAX);
    expect(stepAimKeys(base(), { ...noAimKeys(), lower: true }, 100, false).height).toBe(AIM_HEIGHT_MIN);
    expect(withHeight(base(), 99).height).toBe(AIM_HEIGHT_MAX);
  });
});

describe('aim view (§6.1)', () => {
  const ghost: KickOrigin = { kind: 'ghost', x: 0, y: PHYS.BALL_R, z: 0 };
  const player: KickOrigin = { kind: 'player', playerId: 7, team: 0, x: 12, z: -5, gk: false };
  const keeper: KickOrigin = { kind: 'player', playerId: 1, team: 1, x: 48, z: 2, gk: true };

  it('the ball sits at the horizontal center, about 22° below the view center, at every yaw', () => {
    for (const origin of [ghost, player, keeper]) {
      for (const yawDeg of [0, 37, 90, 180, -123]) {
        const s = { ...base(), yaw: yawDeg * DEG, pitch: defaultAimPitch(AIM_HEIGHT_MIN) };
        const p = project(origin, s);
        expect(Math.abs(p.x)).toBeLessThan(1e-6);
        // NDC y of a point θ below center = −tan θ / tan(fov/2).
        const want = -Math.tan(AIM_BALL_BELOW) / Math.tan((s.fov * DEG) / 2);
        expect(p.y).toBeCloseTo(want, 4);
      }
    }
  });

  it('changing the height keeps the ball at the same place on screen', () => {
    const s0 = base();
    const y0 = project(player, s0).y;
    for (const h of [3, 5, AIM_HEIGHT_MAX]) {
      const s = withHeight(s0, h);
      expect(project(player, s).y).toBeCloseTo(y0, 4);
      expect(Math.abs(project(player, s).x)).toBeLessThan(1e-6);
    }
  });

  it('the camera is on the kick line behind the ball, outside the kicker', () => {
    const s = { ...base(), yaw: 30 * DEG };
    const pose = aimStatePose(player, s);
    const b = aimBall(player, s.yaw);
    const dx = b.x - pose.position.x;
    const dz = b.z - pose.position.z;
    // Behind the ball along d̂.
    expect(Math.atan2(dz, dx)).toBeCloseTo(s.yaw, 9);
    expect(pose.position.y).toBeCloseTo(AIM_HEIGHT_MIN, 9);
    // Far enough behind the kicker's center that the hidden figure isn't in the way.
    const kd = Math.hypot(pose.position.x - player.x, pose.position.z - player.z);
    expect(kd).toBeGreaterThan(1);
  });

  it('a player kicker gets the ball at their feet along d̂ (it orbits them as the yaw turns)', () => {
    const off = 0.4 + PHYS.BALL_R + PHYS.KICK_GAP;
    for (const yawDeg of [0, 90, -45]) {
      const b = aimBall(player, yawDeg * DEG);
      expect(b.x).toBeCloseTo(player.x + Math.cos(yawDeg * DEG) * off, 9);
      expect(b.z).toBeCloseTo(player.z + Math.sin(yawDeg * DEG) * off, 9);
    }
  });
});

describe('pinch zoom (M16.1)', () => {
  it('spreading the fingers zooms in (smaller FOV), pinching zooms out', () => {
    expect(pinchFov(60, 100, 200)).toBeCloseTo(30, 10);
    expect(pinchFov(30, 200, 100)).toBeCloseTo(60, 10);
  });
  it('is clamped to the FOV range and ignores a degenerate distance', () => {
    expect(pinchFov(60, 100, 1000)).toBe(AIM.FOV_MIN);
    expect(pinchFov(60, 100, 10)).toBe(AIM.FOV_MAX);
    expect(pinchFov(60, 0, 100)).toBe(60);
    expect(pinchFov(60, 100, 0)).toBe(60);
  });
});
