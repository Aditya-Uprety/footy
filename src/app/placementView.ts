// Placement view (PLAN §2.3, §6.1, §9, M7.3–M7.4): the draft on the 3D pitch.
//
// Camera: the shared orbit camera re-mapped for placement: left-drag pans
// along the ground (also WASD), right-drag rotates/tilts, wheel zooms, T =
// top-down. The view starts on a tilted overview with +x to the right.
//
// The seat whose pick it is hovers the ground: a green/red marker plus a
// tooltip with the reason (rules a–d against everyone standing). Rings show
// X around that team's players and Y around opponents; the center circle and
// the 1 m line margin are tinted as no-go; the own box lights up for the
// keeper. Click places a tentative spot, drag moves one, right-click or Undo
// removes; Confirm sends the pick. Tentative spots exist only on this device
// until Confirm (the opponent sees them after).
import * as THREE from 'three';
import { PICK_COUNT, PLAYERS_PER_TEAM, pickInfo, randomPick } from '../game/draft';
import { createRng } from '../shared/rng';
import { SHOT_TIMER_WARN } from './shotTimer';
import { timerText } from './matchText';
import { activeSeat } from '../game/rules';
import type { GameState, Seat, Team } from '../game/types';
import { placementPose } from '../render/cameras';
import { createPlacementOverlay } from '../render/placementOverlay';
import { createPlayersView, type PlayersView } from '../render/players';
import type { Stage } from '../render/scene';
import { HITBOX } from '../sim/constants';
import { createPlacementPanel } from '../ui/placementPanel';
import { typingInField, type InspectView } from './inspect';
import { createPlacementModel, type PlacementModel } from './placementModel';
import type { Session } from './session';

export interface PlacementViewOptions {
  stage: Stage;
  /** The match backdrop (pitch, goals, orbit camera). */
  world: InspectView;
  session: Session;
  overlay: HTMLElement;
  debug: boolean;
}

export interface PlacementView {
  readonly model: PlacementModel | null;
  /** Hands the state to the view (call on every session state). */
  sync(s: GameState): void;
  dispose(): void;
}

/** Pointer travel below which a press counts as a click, px. */
const CLICK_SLOP = 6;
/** Screen distance from a tentative figure that grabs it, px. */
const GRAB_PX = 16;
/** WASD pan speed, as a fraction of the camera distance per second. */
const PAN_SPEED = 0.9;
/** How far the orbit target may leave the pitch, m. */
const TARGET_SLACK = 6;

export function createPlacementView(opts: PlacementViewOptions): PlacementView {
  const { stage, world, session } = opts;
  const camera = stage.camera;
  const canvas = stage.canvas;
  const controls = world.controls;
  const settings = session.state.settings;
  const pitch = world.pitch;

  // ---- camera mapping ------------------------------------------------------
  const saved = {
    buttons: { ...controls.mouseButtons },
    touches: { ...controls.touches },
    screenSpacePanning: controls.screenSpacePanning,
    maxPolarAngle: controls.maxPolarAngle,
    minDistance: controls.minDistance,
    maxDistance: controls.maxDistance,
  };
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.screenSpacePanning = false;
  controls.maxPolarAngle = THREE.MathUtils.degToRad(75);
  controls.minDistance = 6;
  controls.maxDistance = pitch.length * 1.6;
  controls.autoRotate = false;
  const fov = (): number => ('fov' in camera ? camera.fov : 50);
  const aspect = (): number => stage.size().width / Math.max(1, stage.size().height);
  /** Fraction of the screen width the side panel covers (the pitch is framed in the rest). */
  const inset = (): number => {
    const w = stage.size().width;
    return w > 700 ? (panel.el.getBoundingClientRect().width + 24) / w : 0;
  };
  const overview = (polarDeg?: number) => placementPose(pitch, aspect(), fov(), { inset: inset(), ...(polarDeg !== undefined ? { polarDeg } : {}) });

  // ---- scene pieces ----------------------------------------------------------
  const overlay = createPlacementOverlay(pitch, settings);
  stage.scene.add(overlay.group);
  const tentView: PlayersView = createPlayersView({ hitboxes: opts.debug });
  stage.scene.add(tentView.group);

  const panel = createPlacementPanel();
  opts.overlay.append(panel.banner, panel.el, panel.tooltip);
  world.moveTo(overview(), 1.0);

  // ---- state -----------------------------------------------------------------
  let state: GameState = session.state;
  let model: PlacementModel | null = null;
  let seat: Seat | null = null;
  let team: Team = 0;
  let pickShown = -1;
  let drag: { i: number; x: number; z: number; ok: boolean; reason: string } | null = null;
  let pointer: { x: number; y: number; inside: boolean } = { x: 0, y: 0, inside: false };
  let press: { button: number; x: number; y: number; shift: boolean } | null = null;

  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const tmp = new THREE.Vector3();

  function ground(clientX: number, clientY: number): { x: number; z: number } | null {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.ray.intersectPlane(groundPlane, tmp);
    if (!hit) return null;
    // Round to cm: what the user sees is what gets validated and sent.
    return { x: Math.round(hit.x * 100) / 100, z: Math.round(hit.z * 100) / 100 };
  }

  function toScreen(x: number, y: number, z: number): { x: number; y: number } {
    const r = canvas.getBoundingClientRect();
    const v = tmp.set(x, y, z).project(camera);
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  /** The tentative spot under the cursor (screen distance to the figure's axis), or -1. */
  function grabbed(clientX: number, clientY: number): number {
    if (!model) return -1;
    let best = -1;
    let bestD = GRAB_PX;
    model.spots.forEach((s, i) => {
      const top = (s.gk ? HITBOX.GK.HC + HITBOX.GK.R : HITBOX.OUTFIELD.HC + HITBOX.OUTFIELD.R) + 0.6;
      const a = toScreen(s.x, 0, s.z);
      const b = toScreen(s.x, top, s.z);
      const d = distToSegment(clientX, clientY, a, b);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) {
      // Close-up: fall back to the ground footprint.
      const g = ground(clientX, clientY);
      if (g) best = model.spotAt(g.x, g.z, 1.2);
    }
    return best;
  }

  // ---- rendering -------------------------------------------------------------
  function spotsNow(): { x: number; z: number; gk: boolean }[] {
    if (!model) return [];
    return model.spots.map((s, i) => (drag && drag.i === i ? { ...s, x: drag.x, z: drag.z } : s));
  }

  function refreshScene(): void {
    const spots = spotsNow();
    const preview = model ? model.preview().map((p, i) => ({ ...p, x: spots[i]!.x, z: spots[i]!.z })) : [];
    tentView.setPlayers(preview);
    overlay.setTentative(spots);
    overlay.setPlayers([...state.players, ...preview]);
    const own = state.players.filter((p) => p.team === team).map((p) => ({ x: p.x, z: p.z }));
    const opp = state.players.filter((p) => p.team !== team).map((p) => ({ x: p.x, z: p.z }));
    overlay.setRings([...own, ...spots.filter((_, i) => !drag || drag.i !== i)], opp);
    const gkNext = !!model && (drag ? !!model.spots[drag.i]?.gk : model.gk().next);
    overlay.setGkFocus(gkNext);
  }

  function refreshPanel(): void {
    const info = pickInfo(state.pick);
    if (!info) return;
    const teamBefore = state.players.filter((p) => p.team === info.team).length;
    const gk = model?.gk() ?? { has: false, forced: false, locked: false, next: false, toggleable: false };
    panel.render({
      team: info.team,
      seatName: state.seatNames[seat ?? 0],
      pick: state.pick,
      picks: PICK_COUNT,
      count: info.count,
      placed: model?.spots.length ?? 0,
      teamBefore,
      teamSize: PLAYERS_PER_TEAM,
      gk,
      issues: model ? model.issues().map((v) => v.message) : [],
      x: settings.minTeammateDist,
      y: settings.minOpponentDist,
      ...(model ? {} : { waiting: `Waiting for ${state.seatNames[seat ?? 0]} to place…` }),
    });
  }

  function refresh(): void {
    refreshScene();
    refreshPanel();
    refreshHover();
  }

  function refreshHover(): void {
    if (!model || !pointer.inside) {
      overlay.setHover(null);
      panel.tip(null);
      canvas.style.cursor = '';
      return;
    }
    if (drag) {
      overlay.setHover({ x: drag.x, z: drag.z, ok: drag.ok, gk: !!model.spots[drag.i]?.gk });
      panel.tip({ x: pointer.x, y: pointer.y, text: drag.ok ? 'Drop here' : drag.reason, ok: drag.ok });
      canvas.style.cursor = 'grabbing';
      return;
    }
    const over = grabbed(pointer.x, pointer.y);
    if (over >= 0) {
      overlay.setHover(null);
      panel.tip({ x: pointer.x, y: pointer.y, text: 'Drag to move · right-click to remove', ok: true });
      canvas.style.cursor = 'grab';
      return;
    }
    canvas.style.cursor = '';
    const g = ground(pointer.x, pointer.y);
    if (!g || model.remaining === 0) {
      overlay.setHover(null);
      panel.tip(
        g && model.remaining === 0
          ? { x: pointer.x, y: pointer.y, text: model.issues().length ? model.issues()[0]!.message : 'Pick complete: Confirm (Enter)', ok: model.issues().length === 0 }
          : null,
      );
      return;
    }
    const v = model.check(g.x, g.z);
    const gk = model.gk().next;
    overlay.setHover({ x: g.x, z: g.z, ok: v.length === 0, gk });
    panel.tip({ x: pointer.x, y: pointer.y, text: v.length ? v[0]!.message : gk ? 'Keeper spot ✓' : 'Free spot ✓', ok: v.length === 0 });
  }

  // ---- state sync ----------------------------------------------------------------
  function sync(s: GameState): void {
    state = s;
    if (s.phase !== 'placement') return;
    if (s.pick !== pickShown) {
      pickShown = s.pick;
      const info = pickInfo(s.pick);
      drag = null;
      seat = activeSeat(s);
      team = info?.team ?? 0;
      model = info && seat !== null && session.localSeats.includes(seat) ? createPlacementModel(s, info.team) : null;
      overlay.setTeam(info ? info.team : null);
      controls.enabled = true;
      pickStart = performance.now();
      timedOut = false;
    }
    refresh();
  }

  // ---- placement timer (§2.3.5, §8.4; M10.4) ----------------------------------------
  // Runs on every device (the opponent sees the countdown too); the placing
  // device fills the rest of the pick at 0. The host guard backs it up 15 s later.
  const timerSec = settings.placementTimerSec;
  const rng = createRng((Math.random() * 0x7fffffff) | 0);
  let pickStart = performance.now();
  let timedOut = false;
  function updateTimer(): void {
    if (timerSec <= 0 || state.phase !== 'placement') {
      panel.setTimer(null);
      return;
    }
    const left = Math.max(0, timerSec - (performance.now() - pickStart) / 1000);
    panel.setTimer({ text: timerText(left), warn: left <= SHOT_TIMER_WARN });
    if (left > 0 || timedOut || !model || seat === null) return;
    timedOut = true;
    drag = null;
    controls.enabled = true;
    let spots;
    try {
      // Keep what is placed (if still legal together), fill the rest at random.
      spots = randomPick(state, team, rng, model.spots);
    } catch {
      const intent = session.randomPick(seat);
      if (intent) session.send(seat, intent);
      return;
    }
    session.send(seat, { type: 'place', pick: state.pick, spots });
  }

  // ---- actions -------------------------------------------------------------------
  function place(clientX: number, clientY: number): void {
    if (!model) return;
    const g = ground(clientX, clientY);
    if (!g) return;
    if (model.remaining === 0) {
      panel.flash('This pick is complete: Confirm, or drag a player to move it.');
      return;
    }
    const v = model.add(g.x, g.z);
    if (v.length) panel.flash(`Can’t place there: ${v[0]!.message}`);
    refresh();
  }

  function removeAt(clientX: number, clientY: number): void {
    if (!model) return;
    const i = grabbed(clientX, clientY);
    if (i < 0) return;
    model.remove(i);
    refresh();
  }

  function toggleGk(): void {
    if (!model) return;
    model.toggleGk();
    refresh();
  }

  function undo(): void {
    if (!model || drag) return;
    model.undo();
    refresh();
  }

  function confirm(): void {
    if (!model || drag || seat === null) return;
    const issues = model.issues();
    if (issues.length) {
      panel.flash(issues[0]!.message);
      return;
    }
    session.send(seat, { type: 'place', pick: state.pick, spots: model.spots.map((s) => ({ ...s })) });
  }

  panel.onGk(toggleGk);
  panel.onUndo(undo);
  panel.onConfirm(confirm);
  const offDenied = session.onDenied((d) => {
    if (d.intentType !== 'place') return;
    panel.flash(d.violations?.length ? d.violations[0]!.message : d.reason);
  });

  // ---- pointer -------------------------------------------------------------------
  const onDown = (ev: PointerEvent): void => {
    pointer = { x: ev.clientX, y: ev.clientY, inside: true };
    press = { button: ev.button, x: ev.clientX, y: ev.clientY, shift: ev.shiftKey };
    if (!model || ev.button !== 0 || ev.shiftKey) return;
    const i = grabbed(ev.clientX, ev.clientY);
    if (i < 0) return;
    // Grab a tentative spot: the camera stays put for this gesture.
    const s = model.spots[i]!;
    drag = { i, x: s.x, z: s.z, ok: true, reason: '' };
    controls.enabled = false;
    canvas.setPointerCapture(ev.pointerId);
    press = null;
    refresh();
  };
  const onMove = (ev: PointerEvent): void => {
    pointer = { x: ev.clientX, y: ev.clientY, inside: true };
    if (drag && model) {
      const g = ground(ev.clientX, ev.clientY);
      if (g) {
        const v = model.check(g.x, g.z, drag.i);
        drag = { ...drag, x: g.x, z: g.z, ok: v.length === 0, reason: v[0]?.message ?? '' };
        refreshScene();
      }
    }
    refreshHover();
  };
  const onUp = (ev: PointerEvent): void => {
    if (drag && model) {
      const d = drag;
      drag = null;
      controls.enabled = true;
      if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
      const v = model.move(d.i, d.x, d.z);
      if (v.length) panel.flash(`Can’t move there: ${v[0]!.message}`);
      refresh();
      return;
    }
    const p = press;
    press = null;
    if (!p || p.button !== ev.button || p.shift) return;
    if (Math.abs(ev.clientX - p.x) > CLICK_SLOP || Math.abs(ev.clientY - p.y) > CLICK_SLOP) return;
    if (ev.target !== canvas) return;
    if (ev.button === 0) place(ev.clientX, ev.clientY);
    else if (ev.button === 2) removeAt(ev.clientX, ev.clientY);
  };
  const onLeave = (): void => {
    pointer = { ...pointer, inside: false };
    refreshHover();
  };
  // Capture phase: decide before OrbitControls whether this press grabs a spot.
  canvas.addEventListener('pointerdown', onDown, true);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  window.addEventListener('pointerup', onUp);

  // ---- keys ----------------------------------------------------------------------
  const held = new Set<string>();
  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || typingInField(ev)) return;
    const k = ev.key.toLowerCase();
    if (['w', 'a', 's', 'd'].includes(k)) {
      held.add(k);
      return;
    }
    if (ev.repeat) return;
    if (k === 't') world.moveTo(overview(0), 0.8);
    else if (k === 'g') toggleGk();
    else if (k === 'z' || k === 'backspace') {
      ev.preventDefault();
      undo();
    } else if (k === 'enter') {
      ev.preventDefault();
      confirm();
    } else if (k === 'escape' && drag) {
      drag = null;
      controls.enabled = true;
      refresh();
    }
  };
  const onKeyUp = (ev: KeyboardEvent): void => {
    held.delete(ev.key.toLowerCase());
  };
  const onBlur = (): void => held.clear();
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const delta = new THREE.Vector3();
  const offFrame = stage.onFrame((dt) => {
    overlay.update(dt);
    if (held.size) {
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      right.crossVectors(fwd, camera.up).normalize();
      delta.set(0, 0, 0);
      if (held.has('w')) delta.add(fwd);
      if (held.has('s')) delta.sub(fwd);
      if (held.has('d')) delta.add(right);
      if (held.has('a')) delta.sub(right);
      if (delta.lengthSq() > 0) {
        delta.normalize().multiplyScalar(PAN_SPEED * Math.max(10, camera.position.distanceTo(controls.target)) * dt);
        camera.position.add(delta);
        controls.target.add(delta);
      }
    }
    // Keep the orbit target over the pitch.
    const t = controls.target;
    const cx = THREE.MathUtils.clamp(t.x, -pitch.halfLength - TARGET_SLACK, pitch.halfLength + TARGET_SLACK);
    const cz = THREE.MathUtils.clamp(t.z, -pitch.halfWidth - TARGET_SLACK, pitch.halfWidth + TARGET_SLACK);
    if (cx !== t.x || cz !== t.z || t.y !== 0) {
      delta.set(cx - t.x, -t.y, cz - t.z);
      t.add(delta);
      camera.position.add(delta);
    }
    // The ground under a still cursor changes while the camera moves.
    if (pointer.inside && !press) refreshHover();
    updateTimer();
  });

  sync(state);

  // Scripting hook for checks (webgl-shot): screen positions of ground points, the model.
  Object.assign(window, {
    __placement: {
      get model() {
        return model;
      },
      screenOf: (x: number, z: number) => toScreen(x, 0, z),
      top: () => world.moveTo(overview(0), 0),
    },
  });

  return {
    get model() {
      return model;
    },
    sync,
    dispose() {
      offFrame();
      offDenied();
      canvas.removeEventListener('pointerdown', onDown, true);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      canvas.style.cursor = '';
      controls.enabled = true;
      controls.mouseButtons = saved.buttons;
      controls.touches = saved.touches;
      controls.screenSpacePanning = saved.screenSpacePanning;
      controls.maxPolarAngle = saved.maxPolarAngle;
      controls.minDistance = saved.minDistance;
      controls.maxDistance = saved.maxDistance;
      overlay.dispose();
      tentView.dispose();
      panel.dispose();
      delete (window as { __placement?: unknown }).__placement;
    },
  };
}

function distToSegment(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2)) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}
