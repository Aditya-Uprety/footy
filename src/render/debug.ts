// Debug aids shown only under ?debug (and in #/lab). M0.3: FPS + draw calls.
// M1.5 adds axes and the ruler; M4.2 hitboxes.
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
      el.textContent = `FPS ${fps} · draw calls ${calls}`;
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
