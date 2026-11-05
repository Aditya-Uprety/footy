// Overhead map (PLAN §6.1, M5.4): hold Tab for an orthographic top-down view
// of the whole pitch with player discs and numbers. Positions only: fixed
// orientation, no facing direction or view cone, the kicker ringed at its own
// center (never at the ball's offset spot, which would give away the aim),
// and no ball while aiming.
//
// `mapContent` builds what both maps show (this view and ui/minimap). It takes
// no yaw at all, so turning the aim can never change a map.
import * as THREE from 'three';
import type { Pitch } from '../shared/pitch';
import type { KickOrigin, Team } from '../sim/types';
import { APRON } from './pitch';
import { KIT_COLORS } from './players';
import type { Stage } from './scene';

export interface MapPlayer {
  id: number;
  team: Team;
  gk: boolean;
  x: number;
  z: number;
  shirt: number;
}

export interface MapContent {
  players: MapPlayer[];
  /** Where the kicker is ringed: a player's center, or a ghost taker's spot. Null = no kicker. */
  kicker: { x: number; z: number; id: number | null } | null;
  /** The ball, or null (hidden while aiming). */
  ball: { x: number; z: number } | null;
}

/**
 * Map content from game data. `ball` should be null while aiming (§6.1).
 * There is deliberately no yaw parameter.
 */
export function mapContent(
  players: readonly { id: number; team: Team; gk: boolean; x: number; z: number; shirt?: number }[],
  kicker: KickOrigin | null,
  ball: { x: number; z: number } | null,
): MapContent {
  let k: MapContent['kicker'] = null;
  if (kicker?.kind === 'player') {
    const p = players.find((q) => q.id === kicker.playerId);
    k = { x: p?.x ?? kicker.x, z: p?.z ?? kicker.z, id: kicker.playerId };
  } else if (kicker?.kind === 'ghost') {
    k = { x: kicker.x, z: kicker.z, id: null };
  }
  return {
    players: players.map((p) => ({ id: p.id, team: p.team, gk: p.gk, x: p.x, z: p.z, shirt: p.shirt ?? p.id })),
    kicker: k,
    ball: ball ? { x: ball.x, z: ball.z } : null,
  };
}

/**
 * Map orientation (§6.1): +1 = Team A's goal on the left (+x right, +z down);
 * −1 = rotated 180° (online, when you are Team B, so your team attacks left→right).
 */
export type MapOrientation = 1 | -1;

/** Disc radii on the overhead map, m. */
const DISC_R = { outfield: 1.15, gk: 1.4 };
const NUMBER_SIZE = 1.7;
const MARK_Y = 6;

export interface OverheadMap {
  readonly shown: boolean;
  /** Switches the stage to the map camera and draws `content`. */
  show(content: MapContent): void;
  /** Redraws while shown (e.g. the ball during playback). */
  update(content: MapContent): void;
  hide(): void;
  setOrientation(o: MapOrientation): void;
  readonly camera: THREE.OrthographicCamera;
  dispose(): void;
}

export function createOverheadMap(stage: Stage, pitch: Pitch, orientation: MapOrientation = 1): OverheadMap {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 300);
  camera.name = 'overhead-map';
  let orient = orientation;
  const group = new THREE.Group();
  group.name = 'overhead-markers';
  group.visible = false;
  stage.scene.add(group);

  function fit(): void {
    const { width, height } = stage.size();
    const aspect = width / Math.max(1, height);
    const margin = Math.min(APRON, 4) + 2;
    const hl = pitch.halfLength + margin;
    const hw = pitch.halfWidth + margin;
    // Fit L × W into the view (x across the screen, z down it).
    const halfH = Math.max(hw, hl / aspect);
    camera.left = -halfH * aspect;
    camera.right = halfH * aspect;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.position.set(0, 100, 0);
    camera.up.set(0, 0, -orient);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }
  fit();
  const offResize = stage.onResize(() => fit());

  // Shared geometry and materials.
  const discGeo = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);
  const rimGeo = new THREE.RingGeometry(1, 1.16, 28).rotateX(-Math.PI / 2);
  const kickerGeo = new THREE.RingGeometry(1.75, 2.2, 36).rotateX(-Math.PI / 2);
  const flat = (color: number, order: number): THREE.MeshBasicMaterial => {
    const m = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, fog: false, transparent: true });
    m.userData.order = order;
    return m;
  };
  const mats = {
    rim: flat(0xffffff, 2),
    kicker: flat(0xffe14d, 3),
    ball: flat(0xffffff, 4),
    ballRim: flat(0x111111, 4),
    team: new Map<string, THREE.MeshBasicMaterial>(),
  };
  const teamMat = (team: Team, gk: boolean): THREE.MeshBasicMaterial => {
    const key = `${team}${gk ? 'g' : 'o'}`;
    let m = mats.team.get(key);
    if (!m) {
      m = flat(gk ? KIT_COLORS[team].gk : KIT_COLORS[team].outfield, 1);
      mats.team.set(key, m);
    }
    return m;
  };
  const numberMats = new Map<number, THREE.SpriteMaterial>();
  const numberMat = (n: number): THREE.SpriteMaterial => {
    let m = numberMats.get(n);
    if (!m) {
      m = new THREE.SpriteMaterial({ map: numberTexture(n), depthTest: false, depthWrite: false, transparent: true, fog: false });
      numberMats.set(n, m);
    }
    return m;
  };

  function mesh(geo: THREE.BufferGeometry, mat: THREE.MeshBasicMaterial, x: number, z: number, s: number, dy = 0): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, MARK_Y + dy, z);
    m.scale.setScalar(s);
    m.renderOrder = 100 + (mat.userData.order as number);
    m.frustumCulled = false;
    group.add(m);
    return m;
  }

  function draw(content: MapContent): void {
    group.clear();
    for (const p of content.players) {
      const r = p.gk ? DISC_R.gk : DISC_R.outfield;
      mesh(discGeo, teamMat(p.team, p.gk), p.x, p.z, r);
      mesh(rimGeo, mats.rim, p.x, p.z, r);
      const s = new THREE.Sprite(numberMat(p.shirt));
      s.position.set(p.x, MARK_Y + 0.2, p.z);
      s.scale.set(NUMBER_SIZE, NUMBER_SIZE, 1);
      s.renderOrder = 110;
      group.add(s);
    }
    if (content.kicker) mesh(kickerGeo, mats.kicker, content.kicker.x, content.kicker.z, 1, 0.1);
    if (content.ball) {
      mesh(discGeo, mats.ballRim, content.ball.x, content.ball.z, 0.75, 0.3);
      mesh(discGeo, mats.ball, content.ball.x, content.ball.z, 0.55, 0.35);
    }
  }

  let shown = false;
  let prevCamera: Stage['camera'] | null = null;

  return {
    camera,
    get shown() {
      return shown;
    },
    show(content) {
      draw(content);
      if (shown) return;
      shown = true;
      fit();
      prevCamera = stage.camera;
      stage.setCamera(camera);
      group.visible = true;
    },
    update(content) {
      if (shown) draw(content);
    },
    hide() {
      if (!shown) return;
      shown = false;
      group.visible = false;
      if (prevCamera) stage.setCamera(prevCamera);
      prevCamera = null;
    },
    setOrientation(o) {
      orient = o;
      fit();
    },
    dispose() {
      if (shown && prevCamera) stage.setCamera(prevCamera);
      offResize();
      group.clear();
      group.removeFromParent();
      discGeo.dispose();
      rimGeo.dispose();
      kickerGeo.dispose();
      for (const m of [mats.rim, mats.kicker, mats.ball, mats.ballRim, ...mats.team.values()]) m.dispose();
      for (const m of numberMats.values()) {
        m.map?.dispose();
        m.dispose();
      }
    },
  };
}

function numberTexture(n: number): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.font = `bold ${n >= 10 ? 34 : 40}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(String(n), size / 2, size / 2 + 2);
  ctx.fillStyle = '#fff';
  ctx.fillText(String(n), size / 2, size / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
