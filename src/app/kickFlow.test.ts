// Kick flow (M5.3): aim → wind-up → playback → hold → next turn → eased
// transition → aim, with the kicker hidden only while aiming.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../game/settings';
import { AIM_HEIGHT_MIN } from '../render/cameras';
import { sampleFrames } from '../render/playback';
import { derivePitch } from '../shared/pitch';
import { PHYS } from '../sim/constants';
import { simulateKick } from '../sim/simulate';
import type { KickInput, KickOrigin, KickResult } from '../sim/types';
import { buildWorld } from '../sim/world';
import { AIM, aimBall, aimStatePose, defaultAimPitch, type AimState } from './aimController';
import { AUTO_REPLAY_HOLD } from './replayModel';
import { createKickFlow, END_HOLD_TIME, kickerBlocksView, TRANSITION_TIME, WINDUP_TIME, type FlowPhase, type Turn } from './kickFlow';

const pitch = derivePitch(DEFAULT_SETTINGS);
const players = [
  { id: 1, team: 0 as const, x: -10, z: 0, gk: false },
  { id: 2, team: 1 as const, x: 8, z: 0.3, gk: false },
];

function rig() {
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 2000);
  const cbs: ((dt: number, t: number) => void)[] = [];
  const stage = {
    camera,
    onFrame(cb: (dt: number, t: number) => void) {
      cbs.push(cb);
      return () => void cbs.splice(cbs.indexOf(cb), 1);
    },
  };
  const tick = (seconds: number, dt = 1 / 60): void => {
    for (let t = 0; t < seconds - 1e-9; t += dt) for (const cb of [...cbs]) cb(dt, 0);
  };

  let state: AimState = { yaw: 0, pitch: defaultAimPitch(AIM_HEIGHT_MIN), fov: AIM.FOV_DEFAULT, height: AIM_HEIGHT_MIN };
  let origin: KickOrigin = { kind: 'ghost', x: 0, y: PHYS.BALL_R, z: 0 };
  const aim = {
    get state() {
      return state;
    },
    get origin() {
      return origin;
    },
    setOrigin(o: KickOrigin, yaw: number) {
      origin = o;
      state = { ...state, yaw };
    },
    setYaw(yaw: number) {
      state = { ...state, yaw };
    },
    pose: () => aimStatePose(origin, state),
    ballPos: () => aimBall(origin, state.yaw),
    active: false,
    inputEnabled: false,
  };

  let kickCb: (() => void) | null = null;
  const panel = {
    enabled: false,
    caps: {},
    setEnabled(on: boolean) {
      this.enabled = on;
    },
    setCaps(c: object) {
      this.caps = c;
    },
    input: (yaw: number): KickInput => ({ yaw, power: 0.5, curve: 0, loft: 0 }),
    onKick(cb: () => void) {
      kickCb = cb;
    },
    update() {},
  };
  const view = {
    hidden: null as number | null,
    yaws: new Map<number, number>(),
    setHidden(id: number | null) {
      this.hidden = id;
    },
    setYaw(id: number, yaw: number) {
      this.yaws.set(id, yaw);
    },
  };
  const ballPos = new THREE.Vector3();
  const ball = {
    setPosition: (x: number, y: number, z: number) => void ballPos.set(x, y, z),
    roll() {},
    spin() {},
    resetRotation() {},
  };
  const log: { requested: KickInput[]; ended: KickResult[]; phases: FlowPhase[] } = { requested: [], ended: [], phases: [] };
  let currentTurn: Turn | null = null;
  const flow = createKickFlow({
    stage,
    pitch,
    ball,
    players: view,
    aim,
    panel,
    keys: false,
    requestKick(input, turn) {
      log.requested.push(input);
      currentTurn = turn;
      const res = simulateKick({
        input,
        origin: turn.origin,
        team: turn.origin.kind === 'player' ? (players.find((p) => p.id === (turn.origin as { playerId: number }).playerId)!.team) : 0,
        world: buildWorld(pitch, players, turn.origin.kind === 'player' ? turn.origin : null),
      });
      flow.play(res); // synchronously, as practice does
    },
    onPlaybackEnd(res) {
      log.ended.push(res);
    },
    onPhase: (p) => log.phases.push(p),
  });
  return { flow, tick, aim, panel, view, ballPos, camera, log, pressKick: () => kickCb?.(), turn: () => currentTurn };
}

const kicker1: Turn = { origin: { kind: 'player', playerId: 1, team: 0, x: -10, z: 0, gk: false }, yaw: 0 };

describe('kick flow', () => {
  it('runs aim → windup → playback → hold → end, then eases to the next kicker', () => {
    const r = rig();
    r.flow.startTurn(kicker1, { instant: true });
    expect(r.flow.phase).toBe('aim');
    expect(r.view.hidden).toBe(1); // kicker hidden while aiming
    expect(r.aim.active && r.aim.inputEnabled && r.panel.enabled).toBe(true);
    // Ball at the kicker's feet.
    expect(r.ballPos.x).toBeCloseTo(-10 + 0.4 + PHYS.BALL_R + PHYS.KICK_GAP, 9);

    r.pressKick();
    expect(r.flow.phase).toBe('windup');
    expect(r.log.requested).toHaveLength(1);
    expect(r.aim.inputEnabled || r.panel.enabled).toBe(false);
    r.tick(WINDUP_TIME * 0.5);
    expect(r.flow.phase).toBe('windup'); // the result waits for the wind-up
    r.tick(WINDUP_TIME * 0.6);
    expect(r.flow.phase).toBe('playback');
    // The chase camera starts right behind the kicker: hidden until it has pulled away.
    expect(r.view.hidden).toBe(1);
    expect(r.view.yaws.get(1)).toBe(0);
    r.tick(0.3);
    expect(r.view.hidden).toBe(1); // the camera backs off along the kick line: still in the way
    r.tick(2.5);
    // By now the chase camera has passed the kicker.
    expect(r.camera.position.x).toBeGreaterThan(-10);
    expect(r.view.hidden).toBeNull();

    // A kick during playback is ignored.
    r.pressKick();
    expect(r.log.requested).toHaveLength(1);

    const res = r.flow.playback!.result;
    // The ball hits #2 (straight along +x) — rolling ends somewhere; play to the end.
    r.tick(res.duration - 2.8 + 0.5);
    expect(['hold', 'idle']).toContain(r.flow.phase);
    r.tick(END_HOLD_TIME + 0.1);
    expect(r.log.ended).toEqual([res]);
    expect(r.flow.phase).toBe('idle');

    // Next turn: player #2 facing −x.
    const next: Turn = { origin: { kind: 'player', playerId: 2, team: 1, x: 8, z: 0.3, gk: false }, yaw: Math.PI };
    r.flow.startTurn(next);
    expect(r.flow.phase).toBe('transition');
    expect(r.view.hidden).toBeNull();
    r.tick(TRANSITION_TIME * 0.4);
    expect(r.view.hidden).toBeNull();
    r.tick(TRANSITION_TIME * 0.3);
    expect(r.view.hidden).toBe(2);
    r.tick(TRANSITION_TIME * 0.4);
    expect(r.flow.phase).toBe('aim');
    // The camera ended exactly at the aim pose.
    const pose = r.aim.pose();
    expect(r.camera.position.distanceTo(pose.position)).toBeLessThan(1e-6);
    expect(r.camera.fov).toBe(AIM.FOV_DEFAULT);
    expect(r.log.phases).toEqual(['aim', 'windup', 'playback', 'hold', 'idle', 'transition', 'aim']);
  });

  it('a ghost kickoff has no hidden figure; caps reach the panel', () => {
    const r = rig();
    r.flow.startTurn({ origin: { kind: 'ghost', x: 0, y: PHYS.BALL_R, z: 0 }, yaw: 0, caps: { throwIn: true } }, { instant: true });
    expect(r.view.hidden).toBeNull();
    expect(r.panel.caps).toEqual({ throwIn: true });
  });

  it('a late result (online) starts playback as soon as it arrives', () => {
    const r = rig();
    // Swallow the synchronous play: re-create with a requestKick that defers.
    r.flow.startTurn(kicker1, { instant: true });
    const realPlay = r.flow.play.bind(r.flow);
    let deferred: KickResult | null = null;
    r.flow.play = (res) => {
      deferred = res;
    };
    r.pressKick();
    r.tick(WINDUP_TIME + 0.5);
    expect(r.flow.phase).toBe('windup');
    realPlay(deferred!);
    expect(r.flow.phase).toBe('playback');
  });
});

describe('kickerBlocksView', () => {
  it('hides a kicker right at the camera or on the sight line to the ball', () => {
    expect(kickerBlocksView(0, 0, 20, 0, 1, 0.5)).toBe(true); // close to the camera
    expect(kickerBlocksView(0, 0, 20, 0, 5, 0.8)).toBe(true); // on the line
    expect(kickerBlocksView(0, 0, 20, 0, 5, 2)).toBe(false); // off to the side
    expect(kickerBlocksView(0, 0, 20, 0, -5, 0)).toBe(false); // behind the camera
    expect(kickerBlocksView(0, 0, 20, 0, 25, 0)).toBe(false); // beyond the ball
  });
});

describe('spectating (online, the other seat kicks)', () => {
  it('keeps the controls off, never kicks, and eases toward the streamed yaw', () => {
    const r = rig();
    r.flow.startTurn(kicker1, { instant: true, spectate: true });
    expect(r.flow.phase).toBe('aim');
    expect(r.flow.spectating).toBe(true);
    expect(r.aim.active).toBe(true); // the view follows the aim rig
    expect(r.aim.inputEnabled || r.panel.enabled).toBe(false);
    expect(r.flow.kick()).toBe(false);
    r.pressKick();
    expect(r.log.requested).toHaveLength(0);

    r.flow.followYaw(1);
    r.tick(0.1);
    const mid = r.aim.state.yaw;
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(1);
    r.tick(1.5);
    expect(r.aim.state.yaw).toBeCloseTo(1, 4);
    // Shortest arc across ±π.
    r.flow.followYaw(-3.1);
    r.tick(0.05);
    expect(r.aim.state.yaw).toBeGreaterThan(1);
  });

  it('plays the result that arrives from the host, and a new local turn re-enables the controls', () => {
    const r = rig();
    r.flow.startTurn(kicker1, { instant: true, spectate: true });
    const res = simulateKick({ input: { yaw: 0, power: 0.3, curve: 0, loft: 0 }, origin: kicker1.origin, team: 0 });
    r.flow.play(res);
    expect(r.flow.phase).toBe('playback');
    r.tick(20);
    expect(r.log.ended).toHaveLength(1);
    r.flow.startTurn(kicker1, { instant: true });
    expect(r.flow.spectating).toBe(false);
    expect(r.aim.inputEnabled && r.panel.enabled).toBe(true);
  });

  it('C switches the spectator between the kicker view and broadcast (kept for the next spectated turn)', () => {
    const r = rig();
    r.flow.startTurn(kicker1, { instant: true, spectate: true });
    r.flow.toggleCamera();
    expect(r.flow.spectatorBroadcast).toBe(true);
    expect(r.aim.active).toBe(false);
    expect(r.view.hidden).toBe(null); // the kicker is visible from the stand
    r.tick(2);
    expect(r.camera.position.y).toBeGreaterThan(10);
    r.flow.startTurn(kicker1, { spectate: true });
    expect(r.flow.phase).toBe('aim');
    expect(r.aim.active).toBe(false);
    r.flow.toggleCamera();
    expect(r.flow.phase).toBe('transition');
    r.tick(1.2);
    expect(r.flow.phase).toBe('aim');
    expect(r.aim.active).toBe(true);
    expect(r.view.hidden).toBe(1);
  });
});

describe('replay (M15.1)', () => {
  /** Plays one kick to its end and returns to a fresh aim turn. */
  function playOne(r: ReturnType<typeof rig>): KickResult {
    r.flow.startTurn(kicker1, { instant: true });
    r.pressKick();
    r.tick(WINDUP_TIME + 0.1);
    const res = r.flow.playback!.result;
    r.tick(res.duration + END_HOLD_TIME + 1);
    expect(r.log.ended).toHaveLength(1);
    r.flow.startTurn({ origin: { kind: 'player', playerId: 2, team: 1, x: 8, z: 0.3, gk: false }, yaw: Math.PI }, { instant: true });
    expect(r.flow.phase).toBe('aim');
    return res;
  }

  it('has nothing to replay before the first kick, and refuses to start outside the aim phase', () => {
    const r = rig();
    r.flow.startTurn(kicker1, { instant: true });
    expect(r.flow.canReplay).toBe(false);
    expect(r.flow.startReplay()).toBe(false);
    expect(r.flow.phase).toBe('aim');
  });

  it('replays the last kick on exactly the recorded path, then cuts back to the same aim view', () => {
    const r = rig();
    const res = playOne(r);
    expect(r.flow.canReplay).toBe(true);
    const ballBefore = r.ballPos.clone();

    expect(r.flow.startReplay()).toBe(true);
    expect(r.flow.phase).toBe('replay');
    expect(r.flow.replay).toEqual({ cam: 'chase', speed: 1, done: false, auto: false });
    expect(r.aim.active || r.aim.inputEnabled || r.panel.enabled).toBe(false);
    expect(r.view.hidden).toBe(1); // the replayed kicker (#1) hides only while it blocks the view

    // The ball follows the recorded frames, sample by sample.
    let t = 0;
    let worst = 0;
    while (t < res.duration - 0.02) {
      r.tick(1 / 60);
      t += 1 / 60;
      expect(r.flow.replayPlayback?.result).toBe(res);
      const ref = sampleFrames(res.frames, r.flow.replayPlayback!.t, { x: 0, y: 0, z: 0 });
      worst = Math.max(worst, Math.hypot(r.ballPos.x - ref.x, r.ballPos.y - ref.y, r.ballPos.z - ref.z));
    }
    expect(worst).toBeLessThan(1e-4);
    r.tick(res.duration + 1);
    expect(r.flow.replay?.done).toBe(true);

    r.flow.stopReplay();
    expect(r.flow.phase).toBe('aim');
    expect(r.flow.replay).toBeNull();
    expect(r.aim.active && r.aim.inputEnabled && r.panel.enabled).toBe(true);
    expect(r.view.hidden).toBe(2); // the current kicker is hidden again
    expect(r.ballPos.distanceTo(ballBefore)).toBeLessThan(1e-9);
    expect(r.log.ended).toHaveLength(1); // replaying never ends a turn again
  });

  it('slow motion stretches the replay; the camera can be switched at any time', () => {
    const r = rig();
    const res = playOne(r);
    r.flow.startReplay();
    r.flow.setReplaySpeed(0.25);
    r.flow.setReplayCamera('goal');
    expect(r.flow.replay).toMatchObject({ cam: 'goal', speed: 0.25 });
    r.tick(2);
    // 2 s of real time at ¼× covers at most 0.5 s of the kick (slow-roll auto-speed can add up to 2×).
    expect(r.flow.replayPlayback!.t).toBeGreaterThan(0.45);
    expect(r.flow.replayPlayback!.t).toBeLessThan(1.05);
    r.flow.toggleCamera(); // C cycles in a replay: goal → chase
    expect(r.flow.replay?.cam).toBe('chase');
    r.flow.restartReplay();
    expect(r.flow.replayPlayback!.t).toBe(0);
    expect(res.duration).toBeGreaterThan(1);
  });

  it('a result that arrives meanwhile (guard kick, the other seat) ends the replay and plays', () => {
    const r = rig();
    const res = playOne(r);
    r.flow.startReplay();
    r.tick(0.5);
    r.flow.play(res);
    expect(r.flow.phase).toBe('playback');
    expect(r.flow.replay).toBeNull();
  });

  it('a new turn or forgetLast drops the replay', () => {
    const r = rig();
    playOne(r);
    r.flow.startReplay();
    r.flow.startTurn(kicker1, { instant: true });
    expect(r.flow.phase).toBe('aim');
    expect(r.flow.replay).toBeNull();
    r.flow.forgetLast();
    expect(r.flow.canReplay).toBe(false);
  });

  it('the automatic goal replay is 1× only, closes itself shortly after the ball stops, and can be skipped', () => {
    const r = rig();
    const res = playOne(r);
    expect(r.flow.startReplay({ auto: true })).toBe(true);
    r.flow.setReplaySpeed(0.25); // ignored: the goal replay is always 1×
    expect(r.flow.replay).toEqual({ cam: 'chase', speed: 1, done: false, auto: true });
    r.flow.restartReplay(); // no "Again" in the automatic replay
    expect(r.flow.replayPlayback!.t).toBeLessThan(0.1);
    for (let i = 0; i < 60 * (res.duration + 2) && !r.flow.replay?.done; i++) r.tick(1 / 60);
    expect(r.flow.phase).toBe('replay');
    expect(r.flow.replay?.done).toBe(true);
    r.tick(AUTO_REPLAY_HOLD * 0.5);
    expect(r.flow.phase).toBe('replay'); // it lingers on the final position
    r.tick(AUTO_REPLAY_HOLD * 0.5 + 0.1);
    expect(r.flow.phase).toBe('aim');
    expect(r.flow.replay).toBeNull();
    expect(r.aim.active && r.panel.enabled).toBe(true);

    // Skippable at any time, and a manual replay afterwards is a normal one again.
    expect(r.flow.startReplay({ auto: true })).toBe(true);
    r.tick(0.3);
    r.flow.stopReplay();
    expect(r.flow.phase).toBe('aim');
    expect(r.flow.startReplay()).toBe(true);
    r.flow.setReplaySpeed(0.5);
    expect(r.flow.replay).toEqual({ cam: 'chase', speed: 0.5, done: false, auto: false });
    r.tick(res.duration * 3);
    expect(r.flow.phase).toBe('replay'); // a manual replay waits for Close
  });
});
