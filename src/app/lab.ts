// Physics Lab (#/lab, PLAN M4.5): a dev tool to poke the simulation.
// Click to add/remove dummies (team, GK), set the kick origin (ground spot =
// ghost taker, dummy = player kicker), type yaw / power / curve / loft, Kick
// and Replay, read the event log, and live-edit the §5.3 constants in a
// lazy-loaded lil-gui panel. This is the ONLY place debug lines (trajectory,
// aim arrow) may appear (CLAUDE.md: no aim aids in game modes).
//
// Keys: K / Enter kick · R replay · hold F fast-forward · C chase ↔ broadcast
// · 1–4 inspect cameras (when not following the ball).
import * as THREE from 'three';
import type GUI from 'lil-gui';
import { closestPlayer } from '../game/possession';
import { createPlaybackCamera, type PlaybackCamMode } from '../render/cameras';
import { KickPlayback } from '../render/playback';
import { createPlayersView } from '../render/players';
import type { Stage } from '../render/scene';
import type { Pitch } from '../shared/pitch';
import { deriveConstants, PHYS, type PhysicsConstants } from '../sim/constants';
import { cornerSpot, kickSpeed, kickStart, throwInSpot } from '../sim/kick';
import { simulateKick } from '../sim/simulate';
import type { KickInput, KickOrigin, KickResult, SimEvent, Team } from '../sim/types';
import { buildWorld, type WorldPlayer } from '../sim/world';
import { h } from '../ui/dom';
import { createInspectView, INSPECT_FOV, typingInField } from './inspect';

const DEG = Math.PI / 180;
const CLICK_SLOP_PX = 5;
/** Seconds the follow camera lingers after the ball stops before orbit resumes. */
const END_HOLD = 1.0;
const TEAM_NAME: Record<Team, string> = { 0: 'A', 1: 'B' };

type Tool = 'dummy' | 'origin' | 'aim' | 'orbit';
type LabOrigin = { kind: 'ghost'; x: number; y: number; z: number } | { kind: 'player'; id: number };

export interface LabOptions {
  debug: boolean;
  /** Parent for the lab's DOM panels. */
  overlay: HTMLElement;
}

export interface LabView {
  dispose(): void;
}

const TOOL_HINT: Record<Tool, string> = {
  dummy: 'Click the pitch to add a dummy; click a dummy to remove it.',
  origin: 'Click the pitch for a ghost kicker there, or a dummy to make it the kicker.',
  aim: 'Click the pitch to aim the kick at that point.',
  orbit: 'Clicks do nothing; drag to orbit, wheel to zoom.',
};

const fmt = (v: number, d = 2): string => (Math.abs(v) < 0.5 * 10 ** -d ? (0).toFixed(d) : v.toFixed(d));

/** One log line for a sim event. */
export function describeEvent(ev: SimEvent): string {
  const tail = 'tail' in ev && ev.tail ? ' (tail)' : '';
  switch (ev.kind) {
    case 'kick':
      return `kick ${fmt(ev.speed, 1)} m/s`;
    case 'ground':
    case 'post':
    case 'bar':
    case 'net':
      return `${ev.kind} ${fmt(ev.speed, 1)} m/s${tail}`;
    case 'player':
      return `player #${ev.playerId} (${TEAM_NAME[ev.team]}) ${fmt(ev.speed, 1)} m/s${tail}`;
    case 'goal':
      return `GOAL into ${TEAM_NAME[ev.goalOf]}'s goal`;
    case 'out':
      return ev.line === 'touch' ? `OUT touch x=${fmt(ev.x)}` : `OUT goal z=${fmt(ev.z)}`;
    case 'catch':
      return `CATCH #${ev.keeperId}`;
    case 'stop':
      return `stop at (${fmt(ev.x)}, ${fmt(ev.z)})`;
  }
}

/** Editable constants: PHYS with LOFT_MAX shown in degrees. */
type EditableConsts = PhysicsConstants & { LOFT_MAX_DEG: number };

export function createLabView(stage: Stage, pitch: Pitch, opts: LabOptions): LabView {
  const inspect = createInspectView(stage, pitch, { debug: opts.debug, overlay: opts.overlay });
  const ball = inspect.ball;
  const r = PHYS.BALL_R;
  const camera = stage.camera as THREE.PerspectiveCamera;
  const pcam = createPlaybackCamera(camera, pitch, 'chase');
  inspect.goTo('tv', true);

  const players = createPlayersView({ hitboxes: true, stage });
  stage.scene.add(players.group);

  // ---- state -------------------------------------------------------------
  const state = {
    tool: 'dummy' as Tool,
    team: 1 as Team,
    gk: false,
    dummies: [] as WorldPlayer[],
    nextId: 1,
    origin: { kind: 'ghost', x: 0, y: r, z: 0 } as LabOrigin,
    yawDeg: 0,
    powerPct: 60,
    curvePct: 0,
    loftDeg: 0,
    throwIn: false,
    follow: true,
    trail: true,
    hitboxes: true,
    autoSlow: true,
    camMode: 'chase' as PlaybackCamMode,
  };
  const edit: EditableConsts = { ...PHYS, LOFT_MAX_DEG: PHYS.LOFT_MAX / DEG };
  let consts: PhysicsConstants = deriveConstants({ ...edit });
  let kickNo = 0;
  let lastResult: KickResult | null = null;
  let pb: KickPlayback | null = null;
  let following = false;
  let endHold = 0;
  let fastForward = false;

  // ---- lab-only debug lines: trajectory + aim arrow ------------------------
  const trailGeo = new THREE.BufferGeometry();
  const trailMat = new THREE.LineBasicMaterial({ color: 0xff8a1f });
  const trail = new THREE.Line(trailGeo, trailMat);
  trail.name = 'debug-trail';
  trail.frustumCulled = false;
  trail.visible = false;
  stage.scene.add(trail);

  const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 3, 0xffe14d, 0.5, 0.3);
  arrow.name = 'debug-aim-arrow';
  stage.scene.add(arrow);

  function setTrail(res: KickResult | null): void {
    if (!res) {
      trail.visible = false;
      return;
    }
    const n = res.frames.length / 4;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = res.frames[i * 4 + 1]!;
      pos[i * 3 + 1] = res.frames[i * 4 + 2]!;
      pos[i * 3 + 2] = res.frames[i * 4 + 3]!;
    }
    trailGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    trailGeo.computeBoundingSphere();
    trail.visible = state.trail;
  }

  // ---- kick setup ----------------------------------------------------------
  function kickOrigin(): KickOrigin {
    const o = state.origin;
    if (o.kind === 'player') {
      const d = state.dummies.find((p) => p.id === o.id);
      if (d) return { kind: 'player', playerId: d.id, team: d.team, x: d.x, z: d.z, gk: d.gk };
    }
    return o.kind === 'ghost' ? { kind: 'ghost', x: o.x, y: o.y, z: o.z } : { kind: 'ghost', x: 0, y: r, z: 0 };
  }

  function kickingTeam(origin: KickOrigin): Team {
    return origin.kind === 'player' ? origin.team : state.team;
  }

  function kickInput(): KickInput {
    const loftMax = consts.LOFT_MAX / DEG;
    return {
      yaw: state.yawDeg * DEG,
      power: state.powerPct / 100,
      curve: state.curvePct / 100,
      loft: loftMax > 0 ? state.loftDeg / loftMax : 0,
    };
  }

  function refreshPlayers(): void {
    const kickerId = state.origin.kind === 'player' ? state.origin.id : null;
    players.setPlayers(
      state.dummies.map((d) => ({ ...d, shirt: d.id, yaw: d.id === kickerId ? state.yawDeg * DEG : undefined })),
    );
    players.setHitboxesVisible(state.hitboxes);
  }

  /** Not playing: put the ball at the next kick's start and point the aim arrow. */
  function preview(): void {
    const origin = kickOrigin();
    const s = kickStart(origin, state.yawDeg * DEG, consts);
    arrow.position.set(s.x, Math.max(s.y, 0.15), s.z);
    arrow.setDirection(new THREE.Vector3(Math.cos(state.yawDeg * DEG), 0, Math.sin(state.yawDeg * DEG)));
    if (!pb || pb.done) {
      pb = null;
      ball.setPosition(s.x, s.y, s.z);
    }
    ui.v0.textContent = `v0 ${fmt(kickSpeed(Math.min(state.powerPct / 100, state.throwIn ? consts.THROW_POWER_CAP : 1), consts), 1)} m/s`;
    ui.origin.textContent =
      origin.kind === 'player'
        ? `Kicker: dummy #${origin.playerId} (${TEAM_NAME[origin.team]}${origin.gk ? ', GK' : ''})`
        : `Kicker: ghost at (${fmt(origin.x)}, ${fmt(origin.y)}, ${fmt(origin.z)}) · team ${TEAM_NAME[state.team]}`;
  }

  function changed(): void {
    refreshPlayers();
    preview();
    syncInputs();
  }

  // ---- kick + playback -----------------------------------------------------
  function kick(): KickResult {
    const origin = kickOrigin();
    const world = buildWorld(pitch, state.dummies, origin.kind === 'player' ? origin : null);
    const res = simulateKick({
      input: kickInput(),
      origin,
      team: kickingTeam(origin),
      world,
      caps: { throwIn: state.throwIn },
      consts,
      turnId: ++kickNo,
    });
    lastResult = res;
    play(res);
    return res;
  }

  function play(res: KickResult): void {
    ball.resetRotation();
    pb = new KickPlayback(res, {
      onEvent: (ev) => markEvent(res, ev),
      onEnd: () => {
        endHold = END_HOLD;
      },
      autoSlowRolls: state.autoSlow,
      keeperAt: (id) => state.dummies.find((d) => d.id === id) ?? null,
      consts,
    });
    pb.applyTo(ball, 0);
    renderLog(res);
    setTrail(res);
    arrow.visible = false;
    if (state.follow) {
      inspect.suspend();
      pcam.setMode(state.camMode);
      pcam.start(res.start, res.input.yaw);
      following = true;
    }
    endHold = 0;
  }

  function replay(): void {
    if (lastResult) play(lastResult);
  }

  function stopFollowing(): void {
    if (!following) return;
    following = false;
    inspect.resume(pcam.target.clone(), INSPECT_FOV);
  }

  const offFrame = stage.onFrame((dt) => {
    if (pb) {
      const simDt = pb.update(dt, { fastForward });
      pb.applyTo(ball, simDt);
      if (following) pcam.update(dt, pb.pos, pb.vel);
      if (pb.done) {
        arrow.visible = true;
        if (following) {
          endHold -= dt;
          if (endHold <= 0) stopFollowing();
        }
      }
      ui.status.textContent = `${pb.done ? 'Finished' : 'Playing'} ${fmt(pb.t)} / ${fmt(pb.duration)} s · ${pb.rate}×${fastForward ? ' (F)' : ''} · camera ${following ? pcam.mode : 'orbit'}`;
    } else {
      ui.status.textContent = `Ready · camera ${following ? pcam.mode : 'orbit'} (C: ${state.camMode} next)`;
    }
  });

  // ---- clicks on the pitch -------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  function pick(ev: PointerEvent): { id: number | null; point: THREE.Vector3 | null } {
    const rect = stage.canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, stage.camera);
    const hit = raycaster.intersectObjects(players.pickTargets(), false)[0];
    if (hit) return { id: players.idOf(hit.object), point: hit.point };
    return { id: null, point: raycaster.ray.intersectPlane(ground, new THREE.Vector3()) };
  }

  function addDummy(team: Team, x: number, z: number, gk = false): number {
    const id = state.nextId++;
    state.dummies.push({ id, team, x, z, gk });
    changed();
    return id;
  }

  function removeDummy(id: number): void {
    const d = state.dummies.find((p) => p.id === id);
    if (!d) return;
    state.dummies = state.dummies.filter((p) => p.id !== id);
    if (state.origin.kind === 'player' && state.origin.id === id) state.origin = { kind: 'ghost', x: d.x, y: r, z: d.z };
    changed();
  }

  function aimAt(x: number, z: number): void {
    // From the kicker's center (player) or the ball spot (ghost).
    const o = kickOrigin();
    state.yawDeg = Math.round((Math.atan2(z - o.z, x - o.x) / DEG) * 10) / 10;
    changed();
  }

  function onClick(ev: PointerEvent): void {
    const { id, point } = pick(ev);
    switch (state.tool) {
      case 'dummy':
        if (id !== null) removeDummy(id);
        else if (point) addDummy(state.team, round2(point.x), round2(point.z), state.gk);
        break;
      case 'origin':
        if (id !== null) state.origin = { kind: 'player', id };
        else if (point) state.origin = { kind: 'ghost', x: round2(point.x), y: r, z: round2(point.z) };
        changed();
        break;
      case 'aim':
        if (point) aimAt(point.x, point.z);
        break;
      case 'orbit':
        break;
    }
  }

  let down: { x: number; y: number } | null = null;
  const onDown = (ev: PointerEvent): void => {
    down = ev.button === 0 && !ev.shiftKey ? { x: ev.clientX, y: ev.clientY } : null;
  };
  const onUp = (ev: PointerEvent): void => {
    if (!down || ev.button !== 0) return;
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    down = null;
    if (moved <= CLICK_SLOP_PX) onClick(ev);
  };
  stage.canvas.addEventListener('pointerdown', onDown);
  stage.canvas.addEventListener('pointerup', onUp);

  // ---- keys ----------------------------------------------------------------
  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || typingInField(ev)) return;
    const k = ev.key.toLowerCase();
    if (k === 'f') fastForward = true;
    if (ev.repeat) return;
    if (k === 'k' || k === 'enter') kick();
    else if (k === 'r') replay();
    else if (k === 'c') toggleCamera();
  };
  const onKeyUp = (ev: KeyboardEvent): void => {
    if (ev.key.toLowerCase() === 'f') fastForward = false;
  };
  const onBlur = (): void => {
    fastForward = false;
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  function toggleCamera(): void {
    state.camMode = state.camMode === 'chase' ? 'broadcast' : 'chase';
    if (following) pcam.setMode(state.camMode);
  }

  // ---- presets -------------------------------------------------------------
  const pitchSize = { pitchLength: pitch.length, pitchWidth: pitch.width };
  const presets: Record<string, () => void> = {
    Kickoff: () => {
      state.origin = { kind: 'ghost', x: 0, y: r, z: 0 };
      state.throwIn = false;
      state.yawDeg = 0;
    },
    Corner: () => {
      const c = cornerSpot(pitchSize, 1, 1, consts);
      state.origin = { kind: 'ghost', ...c };
      state.throwIn = false;
      const pen = pitch.ends[1].penaltyMark;
      state.yawDeg = Math.round(Math.atan2(pen.z - c.z, pen.x - c.x) / DEG);
    },
    'Throw-in': () => {
      const t = throwInSpot(pitchSize, 15, 1, consts);
      state.origin = { kind: 'ghost', ...t };
      state.throwIn = true;
      state.yawDeg = -90;
    },
    Penalty: () => {
      const pen = pitch.ends[1].penaltyMark;
      state.origin = { kind: 'ghost', x: pen.x, y: r, z: pen.z };
      state.throwIn = false;
      state.yawDeg = 0;
    },
  };

  // ---- DOM -----------------------------------------------------------------
  const num = (label: string, key: 'yawDeg' | 'powerPct' | 'curvePct' | 'loftDeg', min: number, max: number, step: number) => {
    const input = h('input', { type: 'number', min, max, step, value: state[key], 'data-key': key });
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      state[key] = Math.min(max, Math.max(min, v));
      preview();
      refreshPlayers();
    });
    return { el: h('label', { class: 'lab-num' }, h('span', {}, label), input), input };
  };
  const check = (label: string, key: 'gk' | 'throwIn' | 'follow' | 'trail' | 'hitboxes' | 'autoSlow', onChange?: () => void) => {
    const input = h('input', { type: 'checkbox', 'data-key': key });
    input.checked = state[key];
    input.addEventListener('change', () => {
      state[key] = input.checked;
      onChange?.();
      preview();
    });
    return { el: h('label', { class: 'lab-check' }, input, label), input };
  };

  const toolInputs = (['dummy', 'origin', 'aim', 'orbit'] as Tool[]).map((t) => {
    const input = h('input', { type: 'radio', name: 'lab-tool', value: t });
    input.checked = state.tool === t;
    input.addEventListener('change', () => {
      state.tool = t;
      ui.hint.textContent = TOOL_HINT[t];
    });
    return h('label', { class: 'lab-check' }, input, { dummy: 'Dummy', origin: 'Origin', aim: 'Aim', orbit: 'Orbit' }[t]);
  });

  const teamSel = h('select', { 'data-key': 'team' }, h('option', { value: '0' }, 'Team A (red)'), h('option', { value: '1' }, 'Team B (blue)'));
  teamSel.value = String(state.team);
  teamSel.addEventListener('change', () => {
    state.team = teamSel.value === '0' ? 0 : 1;
    preview();
  });

  const nums = [
    num('Yaw °', 'yawDeg', -360, 360, 0.5),
    num('Power %', 'powerPct', 0, 100, 1),
    num('Curve %', 'curvePct', -100, 100, 1),
    num('Loft °', 'loftDeg', 0, 90, 0.5),
  ];
  const checks = {
    gk: check('GK', 'gk'),
    throwIn: check('Throw-in caps (power ≤ 45 %, curve 0)', 'throwIn'),
    follow: check('Follow ball', 'follow', () => {
      if (!state.follow) stopFollowing();
    }),
    trail: check('Trajectory line', 'trail', () => {
      trail.visible = state.trail && trail.geometry.getAttribute('position') !== undefined;
    }),
    hitboxes: check('Hitboxes', 'hitboxes', () => players.setHitboxesVisible(state.hitboxes)),
    autoSlow: check('Auto 2× slow rolls', 'autoSlow'),
  };

  function syncInputs(): void {
    for (const n of nums) {
      const key = n.input.dataset.key as 'yawDeg' | 'powerPct' | 'curvePct' | 'loftDeg';
      if (document.activeElement !== n.input) n.input.value = String(state[key]);
    }
    for (const [key, c] of Object.entries(checks)) c.input.checked = state[key as keyof typeof checks];
    teamSel.value = String(state.team);
  }

  const btn = (label: string, onclick: () => void, cls = '') => h('button', { type: 'button', class: cls, onclick: () => onclick() }, label);

  const ui = {
    hint: h('p', { class: 'lab-hint' }, TOOL_HINT[state.tool]),
    origin: h('div', { class: 'lab-origin' }),
    v0: h('span', { class: 'lab-v0' }),
    status: h('div', { class: 'lab-status' }),
    summary: h('div', { class: 'lab-summary' }),
    log: h('ol', { class: 'lab-log' }),
    history: h('ul', { class: 'lab-history' }),
  };

  const panel = h(
    'div',
    { class: 'panel lab-panel', 'data-screen': 'lab' },
    h('div', { class: 'lab-title' }, h('h1', {}, 'Physics Lab'), h('a', { href: '#/' }, '← Menu')),
    h('div', { class: 'lab-row' }, ...toolInputs),
    ui.hint,
    h('div', { class: 'lab-row' }, teamSel, checks.gk.el, btn('Clear dummies', () => {
      state.dummies = [];
      if (state.origin.kind === 'player') state.origin = { kind: 'ghost', x: 0, y: r, z: 0 };
      changed();
    })),
    ui.origin,
    h('div', { class: 'lab-row' }, ...Object.entries(presets).map(([name, fn]) => btn(name, () => {
      fn();
      changed();
    }))),
    checks.throwIn.el,
    h('div', { class: 'lab-grid' }, ...nums.map((n) => n.el)),
    h('div', { class: 'lab-row' }, btn('Kick (K)', () => kick(), 'primary'), btn('Replay (R)', replay), ui.v0),
    h('div', { class: 'lab-row' }, checks.follow.el, checks.trail.el, checks.hitboxes.el, checks.autoSlow.el),
    h('p', { class: 'lab-hint' }, 'Hold F = 3× · C = chase / broadcast · 1–4 = views'),
    ui.status,
    h('h2', {}, 'Event log'),
    ui.summary,
    ui.log,
    ui.history,
  );
  const guiBox = h('div', { class: 'lab-gui' });
  opts.overlay.append(panel, guiBox);

  let shownTurn: number | null = null;
  function renderLog(res: KickResult): void {
    ui.log.replaceChildren(
      ...res.events.map((ev, i) =>
        h('li', { 'data-i': i, class: `ev-${ev.kind}${'tail' in ev && ev.tail ? ' tail' : ''}` }, h('span', { class: 't' }, `${fmt(ev.t)}s`), describeEvent(ev)),
      ),
    );
    const o = res.outcome;
    const touch = 'lastTouch' in o ? `last touch ${TEAM_NAME[o.lastTouch.team]}${o.lastTouch.playerId !== null ? ` #${o.lastTouch.playerId}` : ' (kicker)'} · touches ${o.touches}` : '';
    let next = '';
    if (o.kind === 'stop') {
      const p = closestPlayer(state.dummies, o.x, o.z, kickingTeam(kickOrigin()));
      next = p ? ` · → closest: #${p.id} (${TEAM_NAME[p.team]})` : '';
    }
    const line = `#${res.turnId}: ${o.kind.toUpperCase()} · ${fmt(res.duration)} s${touch ? ' · ' + touch : ''}${next}`;
    // History lists earlier kicks only (a replay doesn't add one).
    if (shownTurn !== null && shownTurn !== res.turnId && ui.summary.textContent) {
      ui.history.prepend(h('li', {}, ui.summary.textContent));
      while (ui.history.children.length > 8) ui.history.lastElementChild?.remove();
    }
    shownTurn = res.turnId;
    ui.summary.textContent = line;
  }

  function markEvent(res: KickResult, ev: SimEvent): void {
    if (res !== pb?.result) return;
    const i = res.events.indexOf(ev);
    ui.log.querySelector(`[data-i="${i}"]`)?.classList.add('past');
  }

  // ---- lil-gui (lazy) ------------------------------------------------------
  let gui: GUI | null = null;
  let disposed = false;
  const derived = { K_D: consts.K_D, K_M: consts.K_M };
  function recompute(): void {
    consts = deriveConstants({ ...edit, LOFT_MAX: edit.LOFT_MAX_DEG * DEG });
    derived.K_D = consts.K_D;
    derived.K_M = consts.K_M;
    gui?.controllersRecursive().forEach((c) => c.updateDisplay());
    preview();
  }
  void import('lil-gui').then(({ default: GUIClass }) => {
    if (disposed) return;
    gui = new GUIClass({ container: guiBox, title: 'Physics constants (§5.3)', width: 300 });
    const groups: [string, [keyof EditableConsts, number, number, number][]][] = [
      ['Air', [['RHO', 0, 3, 0.005], ['CD', 0, 0.8, 0.005], ['BALL_M', 0.2, 0.8, 0.005], ['W_MAX', 0, 150, 1], ['TAU_AIR', 0.2, 30, 0.1]]],
      ['Ground', [['E_GROUND', 0, 1, 0.01], ['MU_GROUND', 0, 1, 0.01], ['BOUNCE_KEEP_MIN', 0, 1, 0.01], ['SPIN_KEEP_GROUND', 0, 1, 0.01], ['V_SETTLE', 0, 3, 0.05], ['MU_ROLL', 0, 0.5, 0.005], ['TAU_GROUND', 0.05, 5, 0.05], ['V_STOP', 0.01, 0.5, 0.01]]],
      ['Players', [['E_PLAYER', 0, 1, 0.01], ['MU_PLAYER', 0, 1, 0.01], ['SPIN_KEEP_PLAYER', 0, 1, 0.01]]],
      ['Frame & net', [['E_FRAME', 0, 1, 0.01], ['MU_FRAME', 0, 1, 0.01], ['SPIN_KEEP_FRAME', 0, 1, 0.01], ['E_NET', 0, 1, 0.01], ['NET_TANGENT_KEEP', 0, 1, 0.01]]],
      ['Kick', [['V_MIN', 0, 10, 0.1], ['V_MAX', 5, 50, 0.5], ['LOFT_MAX_DEG', 10, 89, 0.5], ['THROW_POWER_CAP', 0.05, 1, 0.01], ['THROW_HEIGHT', 0.5, 3, 0.05], ['KICK_GAP', 0, 0.5, 0.01], ['GRACE_DIST', 0, 2, 0.05]]],
      ['Simulation', [['T_MAX', 1, 60, 1], ['TAIL_GOAL', 0, 5, 0.1], ['TAIL_OUT', 0, 5, 0.1], ['FRAME_EVERY', 1, 16, 1]]],
    ];
    for (const [title, items] of groups) {
      const f = gui.addFolder(title);
      for (const [key, min, max, step] of items) f.add(edit, key, min, max, step).onChange(recompute);
      if (title !== 'Air') f.close();
    }
    const d = gui.addFolder('Derived (read-only)');
    d.add(derived, 'K_D').disable().decimals(5);
    d.add(derived, 'K_M').disable().decimals(5);
    gui.add({ reset: () => {
      Object.assign(edit, PHYS, { LOFT_MAX_DEG: PHYS.LOFT_MAX / DEG });
      recompute();
    } }, 'reset').name('Reset to §5.3 defaults');
  });

  // ---- scripting hook for checks (dev tool) --------------------------------
  const api = {
    state,
    addDummy,
    removeDummy,
    clearDummies: () => {
      state.dummies = [];
      changed();
    },
    setOrigin(o: LabOrigin) {
      state.origin = o;
      changed();
    },
    setInput(p: Partial<Pick<typeof state, 'yawDeg' | 'powerPct' | 'curvePct' | 'loftDeg' | 'throwIn' | 'team'>>) {
      Object.assign(state, p);
      changed();
    },
    aimAt,
    preset: (name: string) => {
      presets[name]?.();
      changed();
    },
    kick: () => {
      const res = kick();
      return { outcome: res.outcome, events: res.events.map(describeEvent), duration: res.duration };
    },
    replay,
    toggleCamera,
    setFastForward: (on: boolean) => {
      fastForward = on;
    },
    get consts() {
      return consts;
    },
    setConst(key: keyof EditableConsts, value: number) {
      (edit as unknown as Record<string, number>)[key] = value;
      recompute();
    },
    log: () => [...ui.log.children].map((li) => li.textContent ?? ''),
    get playback() {
      return pb ? { t: pb.t, duration: pb.duration, done: pb.done, rate: pb.rate, pos: { ...pb.pos } } : null;
    },
    get camera() {
      return { mode: following ? pcam.mode : 'orbit', position: camera.position.toArray(), fov: camera.fov };
    },
  };
  Object.assign(window, { __lab: api });

  changed();

  return {
    dispose() {
      disposed = true;
      offFrame();
      stage.canvas.removeEventListener('pointerdown', onDown);
      stage.canvas.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      if (following) inspect.resume(pcam.target.clone(), INSPECT_FOV);
      gui?.destroy();
      panel.remove();
      guiBox.remove();
      trail.removeFromParent();
      trailGeo.dispose();
      trailMat.dispose();
      arrow.removeFromParent();
      arrow.dispose();
      players.dispose();
      inspect.dispose();
      delete (window as { __lab?: unknown }).__lab;
    },
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
