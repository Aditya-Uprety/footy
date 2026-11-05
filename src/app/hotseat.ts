// Hot-seat mode (#/hotseat, PLAN §3.3): name entry → toss → draft → match,
// all on one device. M7.1: name entry.
import { DEFAULT_SETTINGS } from '../game/settings';
import type { Stage } from '../render/scene';
import { derivePitch } from '../shared/pitch';
import { h } from '../ui/dom';
import { hotseatSetupScreen } from '../ui/menu';
import { createInspectView, type InspectView } from './inspect';

export interface HotseatOptions {
  debug: boolean;
  seed: number | null;
  autoplace: boolean;
  /** Parent for the mode's DOM overlays. */
  overlay: HTMLElement;
}

export interface HotseatMode {
  dispose(): void;
}

export function createHotseatMode(stage: Stage | null, opts: HotseatOptions): HotseatMode {
  let backdrop: InspectView | null = null;
  let screen: HTMLElement | null = null;

  function show(el: HTMLElement): void {
    screen?.remove();
    screen = el;
    opts.overlay.append(el);
  }

  function setup(names?: [string, string]): void {
    if (stage && !backdrop) {
      backdrop = createInspectView(stage, derivePitch(DEFAULT_SETTINGS), { debug: false, overlay: opts.overlay });
      backdrop.controls.autoRotate = true;
      backdrop.controls.autoRotateSpeed = 0.35;
    }
    show(hotseatSetupScreen({ ...(names ? { names } : {}), onStart: start }));
  }

  function start(names: [string, string]): void {
    show(h('div', { class: 'panel card', 'data-screen': 'toss' }, h('h1', {}, 'Coin toss'), h('p', {}, `${names[0]} vs ${names[1]}`)));
  }

  setup();

  return {
    dispose() {
      screen?.remove();
      backdrop?.dispose();
    },
  };
}
