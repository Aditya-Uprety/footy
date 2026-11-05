// Ground overlay for the draft (PLAN §9, M7.3–M7.4): no-go zones (center
// circle + hitbox, the 1 m line margin), the active team's own penalty area
// (where its keeper must stand), exclusion rings (X around the active team's
// players, Y around opponents), the hover marker (green = legal, red = not)
// and rings under tentative spots. Everything lies flat just above the grass,
// except the goal labels (M17): a kit-coloured sign over each goal ("RED
// GOAL · Alice defends") plus a faint kit tint on each team's own half, so it
// is clear which side is whose.
import * as THREE from 'three';
import type { Point2, Pitch, Rect2 } from '../shared/pitch';
import { HITBOX } from '../sim/constants';
import type { Team } from '../sim/types';
import { kitOf } from '../shared/kits';
import { KIT_COLORS } from './players';

export interface PlacementOverlay {
  readonly group: THREE.Group;
  /** The team placing now (own box, ring colours), or null to hide team-specific parts. */
  setTeam(team: Team | null): void;
  /** Emphasise the own box (the next spot is a keeper). */
  setGkFocus(on: boolean): void;
  /** X rings around `own` (the active team's players), Y rings around `opp`. */
  setRings(own: readonly Point2[], opp: readonly Point2[]): void;
  /** Rings under the pick's tentative spots. */
  setTentative(spots: readonly Point2[]): void;
  /** Team-coloured discs under players (confirmed and tentative), so they read from far above. */
  setPlayers(list: readonly { x: number; z: number; team: Team; gk: boolean }[]): void;
  /** The hover marker at (x, z): ok = legal, null = hidden. `gk` sizes it for a keeper. */
  setHover(h: { x: number; z: number; ok: boolean; gk: boolean } | null): void;
  /** Labels the goals and tints the halves: `names[t]` = the seat playing team t. */
  setSides(names: readonly [string, string]): void;
  /** Animates the tentative rings; call every frame. */
  update(dt: number): void;
  dispose(): void;
}

export interface Spacing {
  minTeammateDist: number;
  minOpponentDist: number;
}

const MAX_RINGS = 32;
const RING_W = 0.22;
const Y_LIFT = 0.03;
const OK = new THREE.Color(0x3ddc84);
const BAD = new THREE.Color(0xff4d4d);
const NO_GO = 0xff3b30;
const BOX = 0xffd34d;

/** Lighter kit colour for rings (they sit on green grass). */
function ringColor(team: Team): THREE.Color {
  return new THREE.Color(KIT_COLORS[team].outfield).lerp(new THREE.Color(0xffffff), 0.35);
}

function flat(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function overlayMat(color: THREE.ColorRepresentation, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    side: THREE.DoubleSide,
    // True colours: the overlay is UI, not lit scenery.
    toneMapped: false,
  });
}

/** A sign over a goal: kit-coloured plate, big "RED GOAL", the defender's name under it. */
function goalSignTexture(kit: string, color: number, name: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 200;
  const g = c.getContext('2d')!;
  const hex = `#${color.toString(16).padStart(6, '0')}`;
  g.fillStyle = 'rgba(10, 14, 20, 0.72)';
  g.beginPath();
  g.roundRect(4, 4, 504, 192, 28);
  g.fill();
  g.fillStyle = hex;
  g.beginPath();
  g.roundRect(4, 4, 30, 192, [28, 0, 0, 28]);
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = hex;
  g.beginPath();
  g.roundRect(7, 7, 498, 186, 26);
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.font = '800 76px system-ui, sans-serif';
  g.fillText(`${kit.toUpperCase()} GOAL`, 270, 78, 440);
  g.font = '600 40px system-ui, sans-serif';
  g.fillStyle = 'rgba(255, 255, 255, 0.85)';
  g.fillText(name ? `${name} defends` : 'defends this end', 270, 150, 440);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function rectGeo(r: Rect2): THREE.BufferGeometry {
  const g = flat(new THREE.PlaneGeometry(r.xMax - r.xMin, r.zMax - r.zMin));
  g.translate((r.xMin + r.xMax) / 2, 0, (r.zMin + r.zMax) / 2);
  return g;
}

/** The band between the outer rect and the inner rect (both axis-aligned, inner inside outer). */
function frameGeo(outer: Rect2, inner: Rect2): THREE.BufferGeometry {
  const parts = [
    { xMin: outer.xMin, xMax: outer.xMax, zMin: outer.zMin, zMax: inner.zMin },
    { xMin: outer.xMin, xMax: outer.xMax, zMin: inner.zMax, zMax: outer.zMax },
    { xMin: outer.xMin, xMax: inner.xMin, zMin: inner.zMin, zMax: inner.zMax },
    { xMin: inner.xMax, xMax: outer.xMax, zMin: inner.zMin, zMax: inner.zMax },
  ];
  const pos: number[] = [];
  for (const p of parts) {
    pos.push(p.xMin, 0, p.zMin, p.xMin, 0, p.zMax, p.xMax, 0, p.zMax, p.xMin, 0, p.zMin, p.xMax, 0, p.zMax, p.xMax, 0, p.zMin);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

export function createPlacementOverlay(pitch: Pitch, spacing: Spacing): PlacementOverlay {
  const group = new THREE.Group();
  group.name = 'placement-overlay';
  group.position.y = Y_LIFT;
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, order: number, name: string): THREE.Mesh => {
    const m = new THREE.Mesh(keep(geo), keep(mat));
    m.renderOrder = order;
    m.name = name;
    group.add(m);
    return m;
  };

  // ---- no-go zones ---------------------------------------------------------
  const ccR = pitch.centerCircleR + HITBOX.OUTFIELD.R;
  mesh(flat(new THREE.CircleGeometry(ccR, 96)), overlayMat(NO_GO, 0.3), 1, 'nogo-center');
  mesh(flat(new THREE.RingGeometry(ccR - 0.12, ccR, 96)), overlayMat(NO_GO, 0.75), 2, 'nogo-center-edge');
  mesh(frameGeo(pitch.field, pitch.placementBounds), overlayMat(NO_GO, 0.45), 1, 'nogo-margin');

  // ---- sides: half tints + goal signs (M17) ---------------------------------
  const halfMats = pitch.ends.map(() => keep(overlayMat(0xffffff, 0.1)));
  pitch.ends.forEach((end, i) => {
    const x0 = Math.min(end.goalLineX, 0);
    const x1 = Math.max(end.goalLineX, 0);
    mesh(rectGeo({ xMin: x0, xMax: x1, zMin: pitch.field.zMin, zMax: pitch.field.zMax }), halfMats[i]!, 0, `half-tint-${end.team}`);
  });
  const signs = pitch.ends.map((end) => {
    const mat = new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false });
    keep(mat);
    const sprite = new THREE.Sprite(mat);
    sprite.name = `goal-sign-${end.team}`;
    sprite.scale.set(19, 19 * (200 / 512), 1);
    // Above the goal, a little behind the line so it doesn't hide the box.
    sprite.position.set(end.goalLineX + end.side * 4, 7.5, 0);
    sprite.renderOrder = 20;
    sprite.visible = false;
    group.add(sprite);
    return { sprite, mat, tex: null as THREE.CanvasTexture | null };
  });
  keep({ dispose: () => signs.forEach((s) => s.tex?.dispose()) });

  // ---- own box -------------------------------------------------------------
  const boxMat = keep(overlayMat(BOX, 0.1));
  const boxes = pitch.ends.map((end) => {
    const m = new THREE.Mesh(keep(rectGeo(end.penaltyArea)), boxMat);
    m.renderOrder = 1;
    m.name = `own-box-${end.team}`;
    m.visible = false;
    group.add(m);
    return m;
  });

  // ---- exclusion rings -----------------------------------------------------
  const ringSet = (radius: number, name: string) => {
    const lineMat = keep(overlayMat(0xffffff, 0.85));
    const fillMat = keep(overlayMat(0xffffff, 0.07));
    const line = new THREE.InstancedMesh(keep(flat(new THREE.RingGeometry(radius - RING_W / 2, radius + RING_W / 2, 72))), lineMat, MAX_RINGS);
    const fill = new THREE.InstancedMesh(keep(flat(new THREE.CircleGeometry(radius, 72))), fillMat, MAX_RINGS);
    line.name = `${name}-ring`;
    fill.name = `${name}-fill`;
    line.renderOrder = 4;
    fill.renderOrder = 3;
    line.count = fill.count = 0;
    line.frustumCulled = fill.frustumCulled = false;
    group.add(fill, line);
    const m4 = new THREE.Matrix4();
    return {
      set(points: readonly Point2[]) {
        const n = Math.min(points.length, MAX_RINGS);
        for (let i = 0; i < n; i++) {
          m4.makeTranslation(points[i]!.x, 0, points[i]!.z);
          line.setMatrixAt(i, m4);
          fill.setMatrixAt(i, m4);
        }
        line.count = fill.count = n;
        line.instanceMatrix.needsUpdate = fill.instanceMatrix.needsUpdate = true;
      },
      color(c: THREE.Color) {
        lineMat.color.copy(c);
        fillMat.color.copy(c);
      },
      dispose() {
        line.dispose();
        fill.dispose();
      },
    };
  };
  const ownRings = keep(ringSet(spacing.minTeammateDist, 'x'));
  const oppRings = keep(ringSet(spacing.minOpponentDist, 'y'));

  // ---- tentative rings -----------------------------------------------------
  const tentMat = keep(overlayMat(0xffffff, 0.9));
  const tent = new THREE.InstancedMesh(keep(flat(new THREE.RingGeometry(1.05, 1.4, 48))), tentMat, MAX_RINGS);
  tent.name = 'tentative-rings';
  tent.renderOrder = 6;
  tent.count = 0;
  tent.frustumCulled = false;
  group.add(tent);
  keep({ dispose: () => tent.dispose() });

  // ---- player discs --------------------------------------------------------
  const discMat = keep(overlayMat(0xffffff, 0.95));
  const discs = new THREE.InstancedMesh(keep(flat(new THREE.CircleGeometry(1, 32))), discMat, MAX_RINGS * 2);
  const discEdgeMat = keep(overlayMat(0xffffff, 0.9));
  const discEdges = new THREE.InstancedMesh(keep(flat(new THREE.RingGeometry(1, 1.18, 32))), discEdgeMat, MAX_RINGS * 2);
  discs.name = 'player-discs';
  discEdges.name = 'player-disc-edges';
  discs.renderOrder = 5;
  discEdges.renderOrder = 5;
  discs.count = discEdges.count = 0;
  discs.frustumCulled = discEdges.frustumCulled = false;
  group.add(discs, discEdges);
  keep({ dispose: () => (discs.dispose(), discEdges.dispose()) });

  // ---- hover marker --------------------------------------------------------
  const hover = new THREE.Group();
  hover.name = 'hover-marker';
  hover.visible = false;
  const hoverFillMat = keep(overlayMat(OK, 0.35));
  const hoverRingMat = keep(overlayMat(OK, 0.95));
  const hoverFill = new THREE.Mesh(keep(flat(new THREE.CircleGeometry(1, 48))), hoverFillMat);
  const hoverRing = new THREE.Mesh(keep(flat(new THREE.RingGeometry(1, 1.3, 48))), hoverRingMat);
  hoverFill.renderOrder = 7;
  hoverRing.renderOrder = 8;
  hover.add(hoverFill, hoverRing);
  group.add(hover);

  let pulse = 0;
  let gkFocus = false;
  let team: Team | null = null;

  function refreshBox(): void {
    boxes.forEach((b, i) => (b.visible = team === i));
    boxMat.opacity = gkFocus ? 0.26 : 0.1;
  }

  return {
    group,
    setTeam(t) {
      team = t;
      if (t !== null) {
        ownRings.color(ringColor(t));
        oppRings.color(ringColor(t === 0 ? 1 : 0));
        tentMat.color.copy(ringColor(t));
      }
      refreshBox();
    },
    setGkFocus(on) {
      gkFocus = on;
      refreshBox();
    },
    setRings(own, opp) {
      ownRings.set(own);
      oppRings.set(opp);
    },
    setTentative(spots) {
      const m4 = new THREE.Matrix4();
      const n = Math.min(spots.length, MAX_RINGS);
      for (let i = 0; i < n; i++) tent.setMatrixAt(i, m4.makeTranslation(spots[i]!.x, 0, spots[i]!.z));
      tent.count = n;
      tent.instanceMatrix.needsUpdate = true;
    },
    setPlayers(list) {
      const m4 = new THREE.Matrix4();
      const c = new THREE.Color();
      const n = Math.min(list.length, MAX_RINGS * 2);
      for (let i = 0; i < n; i++) {
        const p = list[i]!;
        const r = p.gk ? 1.25 : 0.85;
        m4.makeScale(r, 1, r).setPosition(p.x, 0, p.z);
        discs.setMatrixAt(i, m4);
        discEdges.setMatrixAt(i, m4);
        discs.setColorAt(i, c.setHex(p.gk ? KIT_COLORS[p.team].gk : KIT_COLORS[p.team].outfield));
      }
      discs.count = discEdges.count = n;
      discs.instanceMatrix.needsUpdate = discEdges.instanceMatrix.needsUpdate = true;
      if (discs.instanceColor) discs.instanceColor.needsUpdate = true;
    },
    setSides(names) {
      pitch.ends.forEach((end, i) => {
        const kit = kitOf(end.team);
        halfMats[i]!.color.setHex(kit.outfield);
        const sign = signs[i]!;
        sign.tex?.dispose();
        sign.tex = typeof document === 'undefined' ? null : goalSignTexture(kit.name, kit.outfield, names[end.team]);
        sign.mat.map = sign.tex;
        sign.mat.needsUpdate = true;
        sign.sprite.visible = !!sign.tex;
      });
    },
    setHover(hv) {
      hover.visible = !!hv;
      if (!hv) return;
      hover.position.set(hv.x, 0, hv.z);
      // A keeper's hitbox is wider (0.9 m vs 0.4 m); the marker is a little larger than the hitbox to read from above.
      hover.scale.setScalar(hv.gk ? 1.6 : 1);
      const c = hv.ok ? OK : BAD;
      hoverFillMat.color.copy(c);
      hoverRingMat.color.copy(c);
    },
    update(dt) {
      pulse += dt;
      tentMat.opacity = 0.65 + 0.3 * Math.sin(pulse * 4);
    },
    dispose() {
      group.removeFromParent();
      for (const d of disposables) d.dispose();
    },
  };
}
