// Inspect presets (M1.5): the top-down view frames the whole pitch with +x to the right.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../game/settings';
import { derivePitch } from '../shared/pitch';
import { simulateKick } from '../sim/simulate';
import { buildWorld } from '../sim/world';
import {
  aimBackDistance,
  aimPose,
  CHASE_MIN_HEIGHT,
  createPlaybackCamera,
  inspectPose,
  PLAYBACK_FOV,
  type InspectPreset,
  type PlaybackCamMode,
} from './cameras';
import { KickPlayback } from './playback';
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

describe('aim pose (§6.1)', () => {
  it('sits on the kick line behind the ball with the ball ≈ 22° below center', () => {
    for (const [yaw, h] of [
      [0, 1.7],
      [2.1, 1.7],
      [-0.7, 5],
      [Math.PI, 8],
    ] as const) {
      const ball = { x: 4, y: 0.11, z: -3 };
      const pose = aimPose(ball, yaw, h);
      const back = aimBackDistance(h);
      expect(pose.position.x).toBeCloseTo(ball.x - Math.cos(yaw) * back, 9);
      expect(pose.position.z).toBeCloseTo(ball.z - Math.sin(yaw) * back, 9);
      expect(pose.position.y).toBe(h);
      const view = pose.target.clone().sub(pose.position).normalize();
      const toBall = new THREE.Vector3(ball.x, ball.y, ball.z).sub(pose.position).normalize();
      expect(THREE.MathUtils.radToDeg(view.angleTo(toBall))).toBeCloseTo(22, 6);
      // Ball straight ahead horizontally: same yaw as the view.
      expect(Math.atan2(view.z, view.x)).toBeCloseTo(Math.atan2(Math.sin(yaw), Math.cos(yaw)), 9);
    }
  });
});

describe('playback cameras (M4.4)', () => {
  const pitch = derivePitch(DEFAULT_SETTINGS);
  const world = buildWorld(pitch, [{ id: 1, team: 1, x: 20, z: 0, gk: false }], null);

  function play(mode: PlaybackCamMode, input: { yaw: number; power: number; loft: number }, toggleAt = -1) {
    const res = simulateKick({ input: { ...input, curve: 0 }, origin: { kind: 'ghost', x: 0, y: 0.11, z: 0 }, team: 0, world });
    const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 2000);
    cam.position.set(0, 30, 60);
    cam.lookAt(0, 0, 0);
    const rig = createPlaybackCamera(cam, pitch, mode);
    const pb = new KickPlayback(res, { autoSlowRolls: false });
    rig.start(pb.pos, input.yaw);
    const poses: THREE.Vector3[] = [cam.position.clone()];
    const ballOnScreen: boolean[] = [];
    let frames = 0;
    while (!pb.done && frames < 3000) {
      pb.update(1 / 60);
      if (frames === toggleAt) rig.toggle();
      rig.update(1 / 60, pb.pos, pb.vel);
      cam.updateMatrixWorld();
      poses.push(cam.position.clone());
      const ndc = new THREE.Vector3(pb.pos.x, pb.pos.y, pb.pos.z).project(cam);
      ballOnScreen.push(Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z < 1);
      frames++;
    }
    return { cam, rig, poses, ballOnScreen, res };
  }

  it('chase starts at the aim pose and never drops below 1.5 m', () => {
    const { poses } = play('chase', { yaw: 0.3, power: 0.9, loft: 0.6 });
    const start = aimPose({ x: 0, y: 0.11, z: 0 }, 0.3);
    expect(poses[0]!.distanceTo(start.position)).toBeLessThan(1e-9);
    for (const p of poses) expect(p.y).toBeGreaterThanOrEqual(CHASE_MIN_HEIGHT - 1e-9);
  });

  it('chase rises with a high ball and keeps it in view, incl. a rebound off a player', () => {
    const lob = play('chase', { yaw: 0, power: 1, loft: 0.65 });
    const apexCam = Math.max(...lob.poses.map((p) => p.y));
    expect(apexCam).toBeGreaterThan(5);
    expect(lob.ballOnScreen.filter(Boolean).length / lob.ballOnScreen.length).toBeGreaterThan(0.97);
    const rebound = play('chase', { yaw: 0, power: 0.6, loft: 0 });
    expect(rebound.res.events.some((e) => e.kind === 'player')).toBe(true);
    expect(rebound.ballOnScreen.filter(Boolean).length / rebound.ballOnScreen.length).toBeGreaterThan(0.95);
  });

  it('broadcast stays high on the near touchline and keeps the ball in view', () => {
    const { poses, ballOnScreen, cam } = play('broadcast', { yaw: 2.4, power: 0.8, loft: 0.3 });
    const settled = poses.slice(90);
    for (const p of settled) {
      expect(p.z).toBeGreaterThan(pitch.halfWidth);
      expect(p.y).toBeGreaterThan(10);
    }
    expect(ballOnScreen.slice(90).every(Boolean)).toBe(true);
    expect(cam.fov).toBe(PLAYBACK_FOV.broadcast);
  });

  it('toggling eases between rigs without a jump', () => {
    const { poses, rig } = play('chase', { yaw: 0, power: 0.7, loft: 0.3 }, 20);
    expect(rig.mode).toBe('broadcast');
    // Per-frame camera movement (m) at 60 fps: no instant jump at the toggle (frame 21),
    // and the speed changes smoothly (an eased move, not a cut).
    const steps = poses.slice(1).map((p, i) => p.distanceTo(poses[i]!));
    expect(steps[21]!).toBeLessThan(0.5);
    for (let i = 1; i < steps.length; i++) expect(Math.abs(steps[i]! - steps[i - 1]!)).toBeLessThan(0.4);
  });
});
