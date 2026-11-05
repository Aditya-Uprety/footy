// Debug aids shown only under ?debug (and in #/lab). M0.3: FPS + draw calls.
// M1.5 adds axes and the ruler; M4.2 hitboxes.
import * as THREE from 'three';
import type { Stage } from './scene';

export interface FpsCounter {
  readonly el: HTMLElement;
  dispose(): void;
}

/** A small corner readout: frames per second (averaged over 0.5 s) and draw calls. */
export function createFpsCounter(stage: Stage, parent: HTMLElement): FpsCounter {
  const el = document.createElement('div');
  el.className = 'debug-fps';
  el.textContent = 'FPS —';
  parent.appendChild(el);

  let frames = 0;
  let acc = 0;
  const off = stage.onFrame((dt) => {
    frames++;
    acc += dt;
    if (acc >= 0.5) {
      const fps = Math.round(frames / acc);
      // info.render reflects the previous frame (autoReset clears it before each render).
      const calls = stage.renderer.info.render.calls;
      el.textContent = `FPS ${fps} · draw calls ${calls} · ${stage.quality.level}`;
      frames = 0;
      acc = 0;
    }
  });

  return {
    el,
    dispose() {
      off();
      el.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// Axes and ruler (M1.5). ?debug only.
// ---------------------------------------------------------------------------


/** Axes at the center spot: x red, y green, z blue (5 m each), drawn on top. */
export function createAxes(scene: THREE.Scene): { dispose(): void } {
  const axes = new THREE.AxesHelper(5);
  axes.name = 'debug-axes';
  axes.position.y = 0.03;
  const mat = axes.material as THREE.LineBasicMaterial;
  mat.depthTest = false;
  axes.renderOrder = 999;
  scene.add(axes);
  return {
    dispose() {
      axes.removeFromParent();
      axes.dispose();
    },
  };
}

export interface Ruler {
  /** The two measured points (null until set). */
  readonly a: THREE.Vector3 | null;
  readonly b: THREE.Vector3 | null;
  /** Distance between a and b, or null. */
  distance(): number | null;
  clear(): void;
  dispose(): void;
}

/** Objects whose names start with one of these are ignored by the ruler's raycast. */
const RULER_SKIP = ['net-', 'sky', 'debug-'];
const CLICK_SLOP_PX = 5;

/**
 * Shift+click two points (on the pitch, goals, anything in `pickRoots`) to show
 * their distance; a third Shift+click starts a new measurement, Esc clears.
 * A corner readout shows the cursor's ground coordinates.
 */
export function createRuler(stage: Stage, parent: HTMLElement, pickRoots: THREE.Object3D[]): Ruler {
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line = { threshold: 0.02 };
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();

  const group = new THREE.Group();
  group.name = 'debug-ruler';
  group.renderOrder = 1000;
  stage.scene.add(group);

  const lineMat = new THREE.LineBasicMaterial({ color: 0xffe14d, depthTest: false, transparent: true });
  const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(lineGeo, lineMat);
  line.name = 'debug-ruler-line';
  line.renderOrder = 1000;
  line.frustumCulled = false;
  line.visible = false;
  group.add(line);

  const dotGeo = new THREE.SphereGeometry(0.06, 12, 8);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffe14d, depthTest: false, transparent: true });
  const dots = [new THREE.Mesh(dotGeo, dotMat), new THREE.Mesh(dotGeo, dotMat)];
  for (const d of dots) {
    d.name = 'debug-ruler-dot';
    d.renderOrder = 1001;
    d.visible = false;
    group.add(d);
  }

  const label = document.createElement('div');
  label.className = 'debug-ruler-label';
  label.hidden = true;
  parent.appendChild(label);

  const readout = document.createElement('div');
  readout.className = 'debug-ruler-readout';
  readout.textContent = 'Shift+click two points to measure · Esc clears';
  parent.appendChild(readout);

  let a: THREE.Vector3 | null = null;
  let b: THREE.Vector3 | null = null;

  function pick(ev: PointerEvent): THREE.Vector3 | null {
    const rect = stage.canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, stage.camera);
    const hits = raycaster.intersectObjects(pickRoots, true);
    for (const h of hits) {
      if (!h.object.visible || RULER_SKIP.some((p) => h.object.name.startsWith(p))) continue;
      return h.point.clone();
    }
    return raycaster.ray.intersectPlane(ground, new THREE.Vector3());
  }

  const fmt = (v: number): string => (Math.abs(v) < 0.005 ? '0.00' : v.toFixed(2));

  function refresh(): void {
    dots[0]!.visible = a !== null;
    dots[1]!.visible = b !== null;
    if (a) dots[0]!.position.copy(a);
    if (b) dots[1]!.position.copy(b);
    line.visible = a !== null && b !== null;
    if (a && b) {
      lineGeo.setFromPoints([a, b]);
      const d = a.distanceTo(b);
      label.innerHTML = `<strong>${d.toFixed(2)} m</strong><span>Δx ${fmt(b.x - a.x)} · Δy ${fmt(b.y - a.y)} · Δz ${fmt(b.z - a.z)}</span>`;
    }
    label.hidden = !(a && b);
  }

  let down: { x: number; y: number; shift: boolean } | null = null;
  const onDown = (ev: PointerEvent): void => {
    down = ev.button === 0 ? { x: ev.clientX, y: ev.clientY, shift: ev.shiftKey } : null;
  };
  const onUp = (ev: PointerEvent): void => {
    if (!down || ev.button !== 0) return;
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    const shift = down.shift || ev.shiftKey;
    down = null;
    if (!shift || moved > CLICK_SLOP_PX) return;
    const p = pick(ev);
    if (!p) return;
    if (!a || b) {
      a = p;
      b = null;
    } else {
      b = p;
    }
    refresh();
  };
  const onMove = (ev: PointerEvent): void => {
    const p = pick(ev);
    readout.textContent = p
      ? `x ${fmt(p.x)} · y ${fmt(p.y)} · z ${fmt(p.z)}   (Shift+click two points to measure · Esc clears)`
      : 'Shift+click two points to measure · Esc clears';
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      a = null;
      b = null;
      refresh();
    }
  };
  stage.canvas.addEventListener('pointerdown', onDown);
  stage.canvas.addEventListener('pointerup', onUp);
  stage.canvas.addEventListener('pointermove', onMove);
  window.addEventListener('keydown', onKey);

  // Keep the label over the midpoint of the measured segment.
  const mid = new THREE.Vector3();
  const offFrame = stage.onFrame(() => {
    if (!a || !b) return;
    mid.copy(a).add(b).multiplyScalar(0.5).project(stage.camera);
    const behind = mid.z > 1;
    const { width, height } = stage.size();
    label.style.transform = `translate(${((mid.x + 1) / 2) * width}px, ${((1 - mid.y) / 2) * height}px) translate(-50%, -130%)`;
    label.style.visibility = behind ? 'hidden' : 'visible';
  });

  return {
    get a() {
      return a;
    },
    get b() {
      return b;
    },
    distance: () => (a && b ? a.distanceTo(b) : null),
    clear() {
      a = null;
      b = null;
      refresh();
    },
    dispose() {
      offFrame();
      stage.canvas.removeEventListener('pointerdown', onDown);
      stage.canvas.removeEventListener('pointerup', onUp);
      stage.canvas.removeEventListener('pointermove', onMove);
      window.removeEventListener('keydown', onKey);
      group.removeFromParent();
      lineGeo.dispose();
      lineMat.dispose();
      dotGeo.dispose();
      dotMat.dispose();
      label.remove();
      readout.remove();
    },
  };
}
