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
  renderer.shadowMap.type = THREE.PCFShadowMap;

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

// ---------------------------------------------------------------------------
// Environment: lights, soft sun shadows, sky dome and fog (M1.4).
// ---------------------------------------------------------------------------

export interface EnvironmentOptions {
  /** Shadow map size (square). Lower it for performance mode (M16). */
  shadowMapSize?: number;
}

export interface Environment {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: THREE.Mesh;
  dispose(): void;
}

const SKY_ZENITH = 0x3f86d8;
const SKY_HORIZON = 0xcde2ef;
/** Direction toward the sun (not normalized): high, from the near-left corner. */
const SUN_DIR = new THREE.Vector3(-0.42, 0.82, 0.38).normalize();
const SKY_RADIUS = 1500;

/** Pitch extents the environment needs: half length/width of the area to shadow. */
export interface EnvironmentBounds {
  halfLength: number;
  halfWidth: number;
}

export function createEnvironment(scene: THREE.Scene, bounds: EnvironmentBounds, opts: EnvironmentOptions = {}): Environment {
  const horizon = new THREE.Color(SKY_HORIZON);
  scene.background = horizon.clone();
  scene.fog = new THREE.Fog(horizon.clone(), 140, 760);

  const hemi = new THREE.HemisphereLight(0xd6e8ff, 0x3d5a2e, 1.05);
  hemi.name = 'hemi';
  scene.add(hemi);

  // Sun with a shadow camera fitted to the pitch, apron and goals.
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.name = 'sun';
  const reach = Math.hypot(bounds.halfLength + 9, bounds.halfWidth + 7);
  sun.position.copy(SUN_DIR).multiplyScalar(reach * 2.2);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  const size = opts.shadowMapSize ?? 4096;
  sun.shadow.mapSize.set(size, size);
  const cam = sun.shadow.camera;
  cam.left = -reach;
  cam.right = reach;
  cam.top = reach;
  cam.bottom = -reach;
  cam.near = reach * 0.6;
  cam.far = reach * 3.8;
  cam.updateProjectionMatrix();
  sun.shadow.radius = 3;
  sun.shadow.blurSamples = 12;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  // Gradient sky dome (unfogged, behind everything).
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      zenith: { value: new THREE.Color(SKY_ZENITH) },
      horizon: { value: horizon.clone() },
      sunDir: { value: SUN_DIR.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = wp.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith;
      uniform vec3 horizon;
      uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(horizon, zenith, pow(h, 0.55));
        float s = max(dot(d, sunDir), 0.0);
        col += vec3(1.0, 0.92, 0.75) * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const skyGeo = new THREE.SphereGeometry(SKY_RADIUS, 48, 24);
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.name = 'sky';
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);

  return {
    sun,
    hemi,
    sky,
    dispose() {
      scene.remove(hemi, sun, sun.target, sky);
      sun.shadow.map?.dispose();
      sun.dispose();
      hemi.dispose();
      skyGeo.dispose();
      skyMat.dispose();
      scene.fog = null;
    },
  };
}
