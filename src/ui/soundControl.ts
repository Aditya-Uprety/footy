// Sound control (PLAN §12 M14.2): a small speaker button (click or M mutes) and
// a volume slider, fixed in the bottom-right corner of every screen. It talks to
// an audio-manager-shaped object so this file stays free of app/ imports.
import { h } from './dom';

export interface SoundTarget {
  readonly volume: number;
  readonly muted: boolean;
  setVolume(v: number): void;
  setMuted(m: boolean): void;
  onChange(cb: () => void): () => void;
}

export interface SoundControl {
  readonly el: HTMLElement;
  dispose(): void;
}

const NS = 'http://www.w3.org/2000/svg';

/** The speaker icon: waves for the volume level, a cross when muted. */
function iconSvg(level: 'off' | 'low' | 'high'): SVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  const path = (d: string, fill = false): SVGPathElement => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', fill ? 'currentColor' : 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    return p;
  };
  svg.append(path('M4 9.5h3.5L12 5.5v13l-4.5-4H4z', true));
  if (level === 'off') svg.append(path('M16 9.5l5 5M21 9.5l-5 5'));
  else {
    svg.append(path('M15.5 9.5a3.5 3.5 0 0 1 0 5'));
    if (level === 'high') svg.append(path('M18 7a7 7 0 0 1 0 10'));
  }
  return svg;
}

export function createSoundControl(audio: SoundTarget, parent: HTMLElement): SoundControl {
  const btn = h('button', { type: 'button', class: 'sound-btn', 'data-sound-toggle': '' });
  const slider = h('input', { type: 'range', class: 'sound-slider', min: 0, max: 100, step: 1, 'aria-label': 'Volume', 'data-sound-volume': '' });
  const el = h('div', { class: 'sound-ctl', 'data-sound': '' }, btn, slider);
  parent.append(el);

  function render(): void {
    const off = audio.muted || audio.volume === 0;
    btn.replaceChildren(iconSvg(off ? 'off' : audio.volume < 0.5 ? 'low' : 'high'));
    btn.setAttribute('aria-pressed', String(audio.muted));
    btn.setAttribute('aria-label', audio.muted ? 'Unmute sound (M)' : 'Mute sound (M)');
    btn.title = audio.muted ? 'Unmute (M)' : 'Mute (M)';
    slider.value = String(Math.round(audio.volume * 100));
    slider.style.setProperty('--fill', `${audio.muted ? 0 : Math.round(audio.volume * 100)}%`);
    el.classList.toggle('muted', off);
  }

  btn.addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    btn.blur();
  });
  slider.addEventListener('input', () => {
    const v = Number(slider.value) / 100;
    // Dragging the slider up while muted is an obvious "turn it on".
    if (audio.muted && v > 0) audio.setMuted(false);
    audio.setVolume(v);
  });
  // Keep game keys (arrows, W/S …) from nudging the slider after a drag.
  slider.addEventListener('change', () => slider.blur());
  slider.addEventListener('pointerup', () => slider.blur());

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.code !== 'KeyM' || ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const t = ev.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && (t as HTMLInputElement).type !== 'range')) return;
    audio.setMuted(!audio.muted);
  };
  window.addEventListener('keydown', onKey);
  const off = audio.onChange(render);
  render();

  return {
    el,
    dispose() {
      off();
      window.removeEventListener('keydown', onKey);
      el.remove();
    },
  };
}
