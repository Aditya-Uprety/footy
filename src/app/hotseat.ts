// Hot-seat mode (#/hotseat, PLAN §3.3): name entry → toss → draft → match,
// all on one device. A LocalSession runs the HostCore in the page; the match
// view follows its phases.
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '../game/settings';
import type { Stage } from '../render/scene';
import { derivePitch } from '../shared/pitch';
import { hotseatSetupScreen } from '../ui/menu';
import { createInspectView, type InspectView } from './inspect';
import { createMatchView, type MatchView } from './matchView';
import { LocalSession } from './session';
import { loadUserPrefs, saveUserPrefs, startingSettings } from './userPrefs';

export interface HotseatOptions {
  debug: boolean;
  seed: number | null;
  autoplace: boolean;
  /** Initial setting overrides (query flags); the setup panel can change them. */
  settings?: Partial<Settings>;
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

  /** The settings shown in the setup panel; kept across restarts of the setup. */
  let chosen: Settings = startingSettings(opts.settings);

  function setup(names?: [string, string]): void {
    if (stage && !backdrop) {
      backdrop = createInspectView(stage, derivePitch(DEFAULT_SETTINGS), { debug: false, overlay: opts.overlay });
      backdrop.controls.autoRotate = true;
      backdrop.controls.autoRotateSpeed = 0.35;
    }
    const remembered = names ?? loadUserPrefs().hotseatNames;
    screen = hotseatSetupScreen({ names: remembered, settings: chosen, onStart: start });
    opts.overlay.append(screen);
  }

  function start(names: [string, string], settings: Settings = chosen): void {
    chosen = settings;
    if (!opts.autoplace) saveUserPrefs({ hotseatNames: names, settings: sanitizeSettings(settings) });
    screen?.remove();
    screen = null;
    backdrop?.dispose();
    backdrop = null;
    const seed = opts.seed ?? Math.floor(Math.random() * 0x7fffffff);
    session = new LocalSession({ settings: sanitizeSettings(settings), names, seed });
    match = createMatchView({
      stage,
      session,
      overlay: opts.overlay,
      debug: opts.debug,
      autoplace: opts.autoplace,
    });
    if (opts.debug || import.meta.env.DEV) Object.assign(window, { __hotseat: { session, match } });
  }

  // ?autoplace is the fast test route: default names, straight to the toss.
  if (opts.autoplace) start(['', '']);
  else setup();

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
