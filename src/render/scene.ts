// Three.js stage: one renderer, scene and active camera for the whole app,
// plus resize handling and the render loop. PLAN §3.2, M0.3.
import * as THREE from 'three';

export type FrameCallback = (dt: number, time: number) => void;

export interface Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly canvas: HTMLCanvasElement;
  /** The camera currently rendered. Swap with setCamera(). */
  readonly camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  setCamera(cam: THREE.PerspectiveCamera | THREE.OrthographicCamera): void;
  /** Runs every frame before rendering. Returns an unsubscribe function. */
  onFrame(cb: FrameCallback): () => void;
  /** Runs after each resize with the new CSS pixel size. */
  onResize(cb: (w: number, h: number) => void): () => void;
  size(): { width: number; height: number };
  dispose(): void;
}

const MAX_DPR = 2;
/** Clamp per-frame dt so a backgrounded tab doesn't produce a giant step. */
const MAX_FRAME_DT = 0.1;

export function createStage(container: HTMLElement): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const canvas = renderer.domElement;
  canvas.className = 'stage-canvas';
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);

  let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);

  const frameCbs = new Set<FrameCallback>();
  const resizeCbs = new Set<(w: number, h: number) => void>();

  let width = 1;
  let height = 1;

  function applyCameraAspect(): void {
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  }

  function resize(): void {
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    renderer.setSize(width, height, false);
    applyCameraAspect();
    for (const cb of resizeCbs) cb(width, height);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  const timer = new THREE.Timer();
  timer.connect(document);
  let running = true;

  renderer.setAnimationLoop((now: number) => {
    if (!running) return;
    timer.update(now);
    const dt = Math.min(timer.getDelta(), MAX_FRAME_DT);
    const t = timer.getElapsed();
    for (const cb of frameCbs) cb(dt, t);
    renderer.render(scene, camera);
  });

  return {
    renderer,
    scene,
    canvas,
    get camera() {
      return camera;
    },
    setCamera(cam) {
      camera = cam;
      applyCameraAspect();
    },
    onFrame(cb) {
      frameCbs.add(cb);
      return () => frameCbs.delete(cb);
    },
    onResize(cb) {
      resizeCbs.add(cb);
      return () => resizeCbs.delete(cb);
    },
    size: () => ({ width, height }),
    dispose() {
      running = false;
      renderer.setAnimationLoop(null);
      ro.disconnect();
      timer.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
