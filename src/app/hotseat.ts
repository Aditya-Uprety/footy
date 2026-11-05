// Hot-seat mode (#/hotseat, PLAN §3.3): name entry → toss → draft → match,
// all on one device. A LocalSession runs the HostCore in the page; the match
// view follows its phases.
import { defaultSettings, DEFAULT_SETTINGS } from '../game/settings';
import type { Stage } from '../render/scene';
import { derivePitch } from '../shared/pitch';
import { hotseatSetupScreen } from '../ui/menu';
import { createInspectView, type InspectView } from './inspect';
import { createMatchView, type MatchView } from './matchView';
import { LocalSession } from './session';

export interface HotseatOptions {
  debug: boolean;
  seed: number | null;
  autoplace: boolean;
  /** Parent for the mode's DOM overlays. */
  overlay: HTMLElement;
}

export interface HotseatMode {
  readonly session: LocalSession | null;
  dispose(): void;
}

export function createHotseatMode(stage: Stage | null, opts: HotseatOptions): HotseatMode {
  let backdrop: InspectView | null = null;
  let screen: HTMLElement | null = null;
  let session: LocalSession | null = null;
  let match: MatchView | null = null;
  /** Matches started so far: a seeded run (?seed=N) still gets a new toss on "New draft". */
  let started = 0;

  function setup(names?: [string, string]): void {
    if (stage && !backdrop) {
      backdrop = createInspectView(stage, derivePitch(DEFAULT_SETTINGS), { debug: false, overlay: opts.overlay });
      backdrop.controls.autoRotate = true;
      backdrop.controls.autoRotateSpeed = 0.35;
    }
    screen = hotseatSetupScreen({ ...(names ? { names } : {}), onStart: start });
    opts.overlay.append(screen);
  }

  function start(names: [string, string]): void {
    screen?.remove();
    screen = null;
    backdrop?.dispose();
    backdrop = null;
    const seed = opts.seed !== null ? opts.seed + started : Math.floor(Math.random() * 0x7fffffff);
    started += 1;
    session = new LocalSession({ settings: defaultSettings(), names, seed });
    match = createMatchView({
      stage,
      session,
      overlay: opts.overlay,
      debug: opts.debug,
      autoplace: opts.autoplace,
      onRestart: () => restart(names),
    });
    if (opts.debug || import.meta.env.DEV) Object.assign(window, { __hotseat: { session, match } });
  }

  /** A fresh toss and draft with the same names (new seed unless ?seed is set). */
  function restart(names: [string, string]): void {
    match?.dispose();
    session?.dispose();
    match = null;
    session = null;
    start(names);
  }

  setup();

  return {
    get session() {
      return session;
    },
    dispose() {
      screen?.remove();
      backdrop?.dispose();
      match?.dispose();
      session?.dispose();
      delete (window as { __hotseat?: unknown }).__hotseat;
    },
  };
}
