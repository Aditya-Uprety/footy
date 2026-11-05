// Kick side bar (PLAN §2.4.2, §6.2, §9, M5.2): vertical Power, Curve (center
// detent) and Loft sliders, a camera-height slider and KICK.
// Keys: W·S power, A·D curve, Q·E loft, Space kick (PageUp/PageDown height is
// handled by the aim rig and mirrored here). Restart caps are shown on the
// sliders: a throw-in greys power above 45 % and locks curve at 0.
//
// The pure helpers (clampSliders, stepSlider, toKickInput, …) hold the
// rules so they can be unit-tested; createKickPanel builds the DOM.
import { AIM_HEIGHT_MAX, AIM_HEIGHT_MIN } from '../render/cameras';
import { clamp, DEG } from '../shared/math';
import { PHYS, type PhysicsConstants } from '../sim/constants';
import type { KickCaps } from '../sim/kick';
import type { KickInput } from '../sim/types';
import { h } from './dom';

/** Slider values as shown: power %, curve % (+ = bends right), loft degrees. */
export interface KickSliders {
  power: number;
  curve: number;
  loft: number;
}

export type SliderKey = keyof KickSliders;

interface SliderSpec {
  min: number;
  max: number;
  /** Step (§6.2: power 1 %, curve 1 %, loft 0.5°). */
  step: number;
  /** Change per second while a key is held. */
  rate: number;
  unit: string;
}

/** LOFT_MAX in degrees (§5.3). */
export const LOFT_MAX_DEG = Math.round((PHYS.LOFT_MAX / DEG) * 10) / 10;

export const SLIDERS: Readonly<Record<SliderKey, SliderSpec>> = Object.freeze({
  power: { min: 0, max: 100, step: 1, rate: 45, unit: '%' },
  curve: { min: -100, max: 100, step: 1, rate: 90, unit: '%' },
  loft: { min: 0, max: LOFT_MAX_DEG, step: 0.5, rate: 22, unit: '°' },
});

/** Curve values within this of 0 snap to 0 when dragged (center detent), %. */
export const CURVE_DETENT = 4;
/** Holding A/D pauses at 0 for this long when crossing it, s. */
export const CURVE_DETENT_HOLD = 0.3;
/** A held key starts repeating after this delay, s (a tap is one step). */
export const KEY_REPEAT_DELAY = 0.22;
/** Two taps on the curve slider within this reset it to 0 (touch), ms. */
export const DOUBLE_TAP_MS = 320;
/** Camera-height step for the slider, m. */
export const HEIGHT_STEP = 0.1;

export const DEFAULT_SLIDERS: Readonly<KickSliders> = Object.freeze({ power: 50, curve: 0, loft: 0 });

/** The power cap under the given restart caps, % (§2.6.3: throw-in 45 %; §2.7.1: kickoff 50 %). */
export function powerCap(caps: KickCaps, c: PhysicsConstants = PHYS): number {
  if (caps.throwIn) return Math.round(c.THROW_POWER_CAP * 100);
  if (caps.kickoff) return Math.round(c.KICKOFF_POWER_CAP * 100);
  return SLIDERS.power.max;
}

/** True when the curve slider is locked (throw-in). */
export function curveLocked(caps: KickCaps): boolean {
  return !!caps.throwIn;
}

/** Rounds to a slider's step and clamps to its range. */
export function snap(key: SliderKey, v: number): number {
  const s = SLIDERS[key];
  const r = Math.round(v / s.step) * s.step;
  // Keep values like 12.5 exact and avoid -0.
  return clamp(Math.round(r * 1000) / 1000, s.min, s.max) + 0;
}

/** Applies the ranges and the restart caps (power ≤ cap, curve locked). */
export function clampSliders(v: KickSliders, caps: KickCaps = {}, c: PhysicsConstants = PHYS): KickSliders {
  const power = Math.min(clamp(v.power, SLIDERS.power.min, SLIDERS.power.max), powerCap(caps, c));
  const curve = curveLocked(caps) ? 0 : clamp(v.curve, SLIDERS.curve.min, SLIDERS.curve.max);
  const loft = clamp(v.loft, SLIDERS.loft.min, SLIDERS.loft.max);
  return { power, curve, loft };
}

/** Drag detent: curve values near 0 snap to 0. */
export function curveDetent(v: number): number {
  return Math.abs(v) <= CURVE_DETENT ? 0 : v;
}

/**
 * Moves a slider by `delta` (keys). Curve stops at 0 when it crosses it;
 * returns whether that happened so the caller can pause there.
 */
export function stepSlider(v: KickSliders, key: SliderKey, delta: number, caps: KickCaps = {}): { value: KickSliders; detent: boolean } {
  let next = v[key] + delta;
  let detent = false;
  if (key === 'curve' && v.curve !== 0 && Math.sign(next) !== Math.sign(v.curve)) {
    next = 0;
    detent = true;
  }
  return { value: clampSliders({ ...v, [key]: next }, caps), detent };
}

/** Slider values → physics input fractions (§5.6), with the caps applied. */
export function toKickInput(v: KickSliders, yaw: number, caps: KickCaps = {}, c: PhysicsConstants = PHYS): KickInput {
  const s = clampSliders(v, caps, c);
  const loftMaxDeg = c.LOFT_MAX / DEG;
  return {
    yaw,
    power: s.power / 100,
    curve: s.curve / 100,
    loft: loftMaxDeg > 0 ? Math.min(1, s.loft / loftMaxDeg) : 0,
  };
}

/** Value → 0..1 along a slider's track (0 = bottom). */
export function sliderFraction(key: SliderKey | 'height', v: number): number {
  const [min, max] = key === 'height' ? [AIM_HEIGHT_MIN, AIM_HEIGHT_MAX] : [SLIDERS[key].min, SLIDERS[key].max];
  return clamp((v - min) / (max - min), 0, 1);
}

export function formatSlider(key: SliderKey | 'height', v: number): string {
  switch (key) {
    case 'power':
      return `${Math.round(v)}%`;
    case 'curve':
      return v === 0 ? '0' : `${v > 0 ? 'R' : 'L'} ${Math.abs(Math.round(v))}`;
    case 'loft':
      return `${v.toFixed(1)}°`;
    case 'height':
      return `${v.toFixed(1)} m`;
  }
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

export interface KickPanel {
  readonly el: HTMLElement;
  readonly values: Readonly<KickSliders>;
  readonly caps: Readonly<KickCaps>;
  setValues(v: Partial<KickSliders>): void;
  setCaps(caps: KickCaps): void;
  /** Mirrors the aim rig's camera height. */
  setHeight(h: number): void;
  /** Enables the sliders, keys and KICK (off during wind-up and playback). */
  setEnabled(on: boolean): void;
  readonly enabled: boolean;
  /** Slider values as a physics input for this yaw. */
  input(yaw: number): KickInput;
  /** Called when the user moves the height slider. */
  onHeight(cb: (h: number) => void): void;
  /** Called on KICK / Space. */
  onKick(cb: () => void): void;
  /** Advances held keys; call every frame. */
  update(dt: number): void;
  dispose(): void;
}

interface SliderEl {
  root: HTMLElement;
  track: HTMLElement;
  fill: HTMLElement;
  thumb: HTMLElement;
  value: HTMLElement;
  cap?: HTMLElement;
}

const KEY_BINDINGS: Readonly<Record<string, [SliderKey, 1 | -1]>> = {
  w: ['power', 1],
  s: ['power', -1],
  d: ['curve', 1],
  a: ['curve', -1],
  e: ['loft', 1],
  q: ['loft', -1],
};

const LABELS: Record<SliderKey | 'height', [string, string]> = {
  power: ['Power', 'W S'],
  curve: ['Curve', 'A D'],
  loft: ['Loft', 'Q E'],
  height: ['Camera', 'PgUp PgDn'],
};

function typing(ev: KeyboardEvent): boolean {
  const t = ev.target as HTMLElement | null;
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

export function createKickPanel(): KickPanel {
  let values: KickSliders = { ...DEFAULT_SLIDERS };
  let caps: KickCaps = {};
  let height = AIM_HEIGHT_MIN;
  let enabled = true;
  const heightCbs: ((h: number) => void)[] = [];
  const kickCbs: (() => void)[] = [];

  function makeSlider(key: SliderKey | 'height'): SliderEl {
    const [label, keysHint] = LABELS[key];
    const fill = h('div', { class: 'kp-fill' });
    const thumb = h('div', { class: 'kp-thumb' });
    const cap = key === 'power' ? h('div', { class: 'kp-cap', title: 'Throw-in: power is capped' }) : undefined;
    const track = h(
      'div',
      { class: 'kp-track', role: 'slider', tabindex: -1, 'aria-label': label },
      cap ?? null,
      fill,
      key === 'curve' ? h('div', { class: 'kp-zero' }) : null,
      thumb,
    );
    const value = h('div', { class: 'kp-value' });
    const ends =
      key === 'curve'
        ? [h('div', { class: 'kp-end' }, 'R'), h('div', { class: 'kp-end' }, 'L')]
        : [null, null];
    const root = h(
      'div',
      { class: `kp-slider kp-${key}`, 'data-key': key },
      h('div', { class: 'kp-label' }, label),
      ends[0],
      track,
      ends[1],
      value,
      h('div', { class: 'kp-keys' }, keysHint),
    );
    attachDrag(key, track);
    return { root, track, fill, thumb, value, cap };
  }

  function attachDrag(key: SliderKey | 'height', track: HTMLElement): void {
    let id: number | null = null;
    const fromEvent = (ev: PointerEvent): void => {
      const r = track.getBoundingClientRect();
      const f = clamp(1 - (ev.clientY - r.top) / r.height, 0, 1);
      if (key === 'height') {
        const v = Math.round((AIM_HEIGHT_MIN + f * (AIM_HEIGHT_MAX - AIM_HEIGHT_MIN)) / HEIGHT_STEP) * HEIGHT_STEP;
        height = clamp(Math.round(v * 100) / 100, AIM_HEIGHT_MIN, AIM_HEIGHT_MAX);
        for (const cb of heightCbs) cb(height);
        render();
        return;
      }
      const s = SLIDERS[key];
      let v = snap(key, s.min + f * (s.max - s.min));
      if (key === 'curve') v = curveDetent(v);
      values = clampSliders({ ...values, [key]: v }, caps);
      render();
    };
    let lastTap = 0;
    track.addEventListener('pointerdown', (ev) => {
      if (!enabled || ev.button !== 0) return;
      if (key === 'curve' && curveLocked(caps)) return;
      // Double tap on the curve slider = back to straight (dblclick is unreliable on touch).
      if (key === 'curve' && ev.pointerType !== 'mouse') {
        if (ev.timeStamp - lastTap < DOUBLE_TAP_MS) {
          lastTap = 0;
          values = { ...values, curve: 0 };
          render();
          ev.preventDefault();
          return;
        }
        lastTap = ev.timeStamp;
      }
      id = ev.pointerId;
      track.setPointerCapture?.(ev.pointerId);
      fromEvent(ev);
      ev.preventDefault();
    });
    track.addEventListener('pointermove', (ev) => {
      if (id === ev.pointerId && enabled) fromEvent(ev);
    });
    const end = (ev: PointerEvent): void => {
      if (id !== ev.pointerId) return;
      id = null;
      track.releasePointerCapture?.(ev.pointerId);
    };
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
    if (key === 'curve') {
      track.addEventListener('dblclick', () => {
        if (!enabled) return;
        values = { ...values, curve: 0 };
        render();
      });
    }
  }

  const sliders = {
    power: makeSlider('power'),
    curve: makeSlider('curve'),
    loft: makeSlider('loft'),
    height: makeSlider('height'),
  };
  const kickBtn = h('button', { type: 'button', class: 'kp-kick' }, 'KICK', h('small', {}, 'Space'));
  kickBtn.addEventListener('click', () => fireKick());
  const capNote = h('div', { class: 'kp-note' });
  const el = h(
    'div',
    { class: 'panel kick-panel', 'data-panel': 'kick' },
    h('div', { class: 'kp-row' }, sliders.power.root, sliders.curve.root, sliders.loft.root, h('div', { class: 'kp-sep' }), sliders.height.root),
    capNote,
    kickBtn,
  );

  function place(s: SliderEl, f: number, from = 0): void {
    const lo = Math.min(f, from);
    const hi = Math.max(f, from);
    s.fill.style.bottom = `${lo * 100}%`;
    s.fill.style.height = `${(hi - lo) * 100}%`;
    s.thumb.style.bottom = `${f * 100}%`;
  }

  function render(): void {
    place(sliders.power, sliderFraction('power', values.power));
    place(sliders.curve, sliderFraction('curve', values.curve), 0.5);
    place(sliders.loft, sliderFraction('loft', values.loft));
    place(sliders.height, sliderFraction('height', height));
    (['power', 'curve', 'loft'] as const).forEach((k) => {
      sliders[k].value.textContent = formatSlider(k, values[k]);
      sliders[k].track.setAttribute('aria-valuenow', String(values[k]));
    });
    sliders.height.value.textContent = formatSlider('height', height);
    const pc = powerCap(caps);
    const capped = pc < SLIDERS.power.max;
    if (sliders.power.cap) {
      sliders.power.cap.style.bottom = `${sliderFraction('power', pc) * 100}%`;
      sliders.power.cap.hidden = !capped;
    }
    sliders.power.root.classList.toggle('capped', capped);
    sliders.curve.root.classList.toggle('locked', curveLocked(caps));
    capNote.textContent = caps.throwIn ? `Throw-in: power max ${pc}%, curve locked` : caps.kickoff ? `Kickoff: power max ${pc}%` : '';
    capNote.hidden = !caps.throwIn && !caps.kickoff;
    el.classList.toggle('disabled', !enabled);
    kickBtn.disabled = !enabled;
  }

  function fireKick(): void {
    if (!enabled) return;
    for (const cb of kickCbs) cb();
  }

  // ---- keys ----------------------------------------------------------------
  interface Held {
    key: SliderKey;
    dir: 1 | -1;
    /** Seconds held. */
    t: number;
    /** Unsnapped value while repeating. */
    acc: number;
  }
  const held = new Map<string, Held>();
  let detentHold = 0;

  function nudge(key: SliderKey, delta: number): void {
    if (key === 'curve' && curveLocked(caps)) return;
    const r = stepSlider(values, key, delta, caps);
    values = r.value;
    if (r.detent) detentHold = CURVE_DETENT_HOLD;
    render();
  }

  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || typing(ev)) return;
    if (ev.code === 'Space' || ev.key === ' ') {
      ev.preventDefault();
      if (!ev.repeat) fireKick();
      return;
    }
    const b = KEY_BINDINGS[ev.key.toLowerCase()];
    if (!b) return;
    ev.preventDefault();
    if (ev.repeat || !enabled) return;
    const id = ev.key.toLowerCase();
    nudge(b[0], b[1] * SLIDERS[b[0]].step);
    held.set(id, { key: b[0], dir: b[1], t: 0, acc: values[b[0]] });
  };
  const onKeyUp = (ev: KeyboardEvent): void => {
    held.delete(ev.key.toLowerCase());
  };
  const onBlur = (): void => held.clear();
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  render();

  return {
    el,
    get values() {
      return values;
    },
    get caps() {
      return caps;
    },
    setValues(v) {
      values = clampSliders({ ...values, ...v }, caps);
      render();
    },
    setCaps(c) {
      caps = { ...c };
      values = clampSliders(values, caps);
      render();
    },
    setHeight(hgt) {
      const v = clamp(hgt, AIM_HEIGHT_MIN, AIM_HEIGHT_MAX);
      if (v === height) return;
      height = v;
      render();
    },
    setEnabled(on) {
      enabled = on;
      if (!on) held.clear();
      render();
    },
    get enabled() {
      return enabled;
    },
    input: (yaw) => toKickInput(values, yaw, caps),
    onHeight(cb) {
      heightCbs.push(cb);
    },
    onKick(cb) {
      kickCbs.push(cb);
    },
    update(dt) {
      if (!enabled || held.size === 0) return;
      if (detentHold > 0) {
        detentHold -= dt;
        // Only the curve keys pause at the detent.
        for (const st of held.values()) if (st.key !== 'curve') step(st, dt);
        return;
      }
      for (const st of held.values()) step(st, dt);
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      el.remove();
    },
  };

  function step(st: Held, dt: number): void {
    const before = st.t;
    st.t += dt;
    if (st.t <= KEY_REPEAT_DELAY) return;
    const run = st.t - Math.max(before, KEY_REPEAT_DELAY);
    // Move a float accumulator continuously; the slider shows it snapped to its step.
    const prev = st.acc;
    st.acc += st.dir * SLIDERS[st.key].rate * run;
    if (st.key === 'curve' && prev !== 0 && Math.sign(st.acc) !== Math.sign(prev)) {
      st.acc = 0;
      detentHold = CURVE_DETENT_HOLD;
    }
    const spec = SLIDERS[st.key];
    st.acc = clamp(st.acc, spec.min, st.key === 'power' ? powerCap(caps) : spec.max);
    const v = snap(st.key, st.acc);
    if (v !== values[st.key]) {
      values = clampSliders({ ...values, [st.key]: v }, caps);
      render();
    }
  }
}
