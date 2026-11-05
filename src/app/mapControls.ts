// Hold-Tab overhead map + always-on minimap (PLAN §6.1, M5.4), shared by
// practice and the match views. Positions only: fixed orientation, no facing
// information; the ball shows only during playback (`ballOnMap`).
import type { BallView } from '../render/ball';
import { createOverheadMap, type MapContent, type MapOrientation } from '../render/overheadMap';
import type { Stage } from '../render/scene';
import type { Pitch } from '../shared/pitch';
import { h } from '../ui/dom';
import { createMinimap } from '../ui/minimap';
import { typingInField } from './inspect';

export interface MapControlsOptions {
  stage: Stage;
  pitch: Pitch;
  overlay: HTMLElement;
  orientation: MapOrientation;
  ball: Pick<BallView, 'setVisible'>;
  /** What the maps show right now. */
  content(): MapContent;
  /** True while the ball may appear on the maps (playback, not aiming). */
  ballOnMap(): boolean;
  /** The full-screen map opened/closed: the caller hides its side bar, HUD, … */
  onShow?(on: boolean): void;
}

export interface MapControls {
  readonly shown: boolean;
  /** Opens/closes the overhead map (also hold Tab). */
  show(on: boolean): void;
  /** Hides the minimap (e.g. under a full-screen overlay). */
  setMinimapHidden(hidden: boolean): void;
  dispose(): void;
}

export function createMapControls(opts: MapControlsOptions): MapControls {
  const { stage, pitch } = opts;
  const overhead = createOverheadMap(stage, pitch, opts.orientation);
  const minimap = createMinimap(pitch, opts.orientation);
  const hint = h('div', { class: 'map-hint', hidden: true }, 'MAP · release Tab');
  opts.overlay.append(minimap.el, hint);
  let minimapHidden = false;

  function show(on: boolean): void {
    if (on === overhead.shown) return;
    if (on) overhead.show(opts.content());
    else overhead.hide();
    hint.hidden = !on;
    minimap.el.hidden = on || minimapHidden;
    opts.onShow?.(on);
    opts.ball.setVisible(!on || opts.ballOnMap());
  }

  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Tab' || ev.ctrlKey || ev.metaKey || ev.altKey || typingInField(ev)) return;
    ev.preventDefault();
    show(true);
  };
  const onKeyUp = (ev: KeyboardEvent): void => {
    if (ev.key === 'Tab') show(false);
  };
  const onBlur = (): void => show(false);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  let lastBall = opts.ballOnMap();
  const offFrame = stage.onFrame(() => {
    const c = opts.content();
    const ballOn = opts.ballOnMap();
    if (!minimap.el.hidden) minimap.draw(c);
    if (overhead.shown && (ballOn || lastBall !== ballOn)) {
      overhead.update(c);
      opts.ball.setVisible(ballOn);
    }
    lastBall = ballOn;
  });

  return {
    get shown() {
      return overhead.shown;
    },
    show,
    setMinimapHidden(hidden) {
      minimapHidden = hidden;
      minimap.el.hidden = hidden || overhead.shown;
    },
    dispose() {
      offFrame();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      if (overhead.shown) opts.ball.setVisible(true);
      overhead.dispose();
      minimap.dispose();
      hint.remove();
    },
  };
}
