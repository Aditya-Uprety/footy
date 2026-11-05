// Match settings panel (PLAN §2.9, M13.3): sliders for every Settings field,
// shared by the hot-seat setup and the online host lobby. The guest lobby shows
// the same panel read-only, kept in sync by the host's `settings` message.
import { DEFAULT_SETTINGS, sanitizeSettings, settingRange, type Settings } from '../game/settings';
import { h } from './dom';

interface SettingMeta {
  key: keyof Settings;
  label: string;
  unit: string;
  hint: string;
  /** For optional timers: the value used when switched on. */
  onValue?: number;
}

/** Display order and text. Ranges come from `game/settings.ts`. */
export const SETTING_META: readonly SettingMeta[] = [
  { key: 'kicksPerMatch', label: 'Kicks per match', unit: '', hint: 'Shared by both teams. Half-time comes after half of them.' },
  { key: 'shotTimerSec', label: 'Shot timer', unit: 's', hint: 'Time to aim. At zero the ball is kicked as set.', onValue: 20 },
  { key: 'placementTimerSec', label: 'Placement timer', unit: 's', hint: 'Time per draft turn. At zero the rest is filled in for you.', onValue: 60 },
  { key: 'pitchLength', label: 'Pitch length', unit: 'm', hint: 'Goal line to goal line.' },
  { key: 'pitchWidth', label: 'Pitch width', unit: 'm', hint: 'Touchline to touchline.' },
  { key: 'minTeammateDist', label: 'Teammate spacing', unit: 'm', hint: 'Minimum distance between your own players.' },
  { key: 'minOpponentDist', label: 'Opponent spacing', unit: 'm', hint: 'Minimum distance to the other team’s players.' },
];

/** "40 kicks · 20 s shot timer · 105 × 68 m" (shown on the collapsed panel). */
export function settingsSummary(s: Settings): string {
  const parts = [
    `${s.kicksPerMatch} kicks`,
    s.shotTimerSec > 0 ? `${s.shotTimerSec} s shot timer` : 'no shot timer',
    `${s.pitchLength} × ${s.pitchWidth} m`,
  ];
  if (s.placementTimerSec > 0) parts.push(`${s.placementTimerSec} s per placement`);
  return parts.join(' · ');
}

/** Value text for one row ("Off" for a timer at 0). */
export function formatSetting(meta: Pick<SettingMeta, 'unit'>, value: number): string {
  if (value === 0) return 'Off';
  return meta.unit ? `${value} ${meta.unit}` : String(value);
}

/** The settings after the user changed one field (everything re-snapped, Y ≤ X − 1). */
export function changeSetting(cur: Settings, key: keyof Settings, value: number): Settings {
  return sanitizeSettings({ ...cur, [key]: value });
}

export interface SettingsPanel {
  readonly el: HTMLElement;
  get(): Settings;
  /** Shows these settings without firing onChange. */
  set(s: Settings): void;
  setEditable(editable: boolean): void;
}

export interface SettingsPanelOptions {
  settings: Settings;
  editable: boolean;
  onChange?(s: Settings): void;
}

interface Row {
  meta: SettingMeta;
  range: HTMLInputElement;
  value: HTMLElement;
  toggle: HTMLInputElement | null;
}

export function createSettingsPanel(o: SettingsPanelOptions): SettingsPanel {
  let current = sanitizeSettings({ ...o.settings });
  let editable = o.editable;

  const summary = h('span', { class: 'settings-summary' });
  const resetBtn = h('button', { type: 'button', class: 'btn btn-sm' }, 'Reset to defaults');
  const rows: Row[] = SETTING_META.map((meta) => {
    const range = h('input', { type: 'range', class: 'settings-range', name: meta.key, 'aria-label': meta.label });
    const value = h('span', { class: 'settings-value' });
    const toggle = settingRange(meta.key, current).offAllowed ? h('input', { type: 'checkbox', class: 'settings-toggle', 'aria-label': `${meta.label} on` }) : null;
    range.addEventListener('input', () => commit(meta.key, Number(range.value)));
    toggle?.addEventListener('change', () => commit(meta.key, toggle.checked ? (meta.onValue ?? settingRange(meta.key, current).min) : 0));
    return { meta, range, value, toggle };
  });

  function commit(key: keyof Settings, value: number): void {
    current = changeSetting(current, key, value);
    render();
    o.onChange?.({ ...current });
  }

  function render(): void {
    summary.textContent = settingsSummary(current);
    for (const r of rows) {
      const key = r.meta.key;
      const range = settingRange(key, current);
      const v = current[key];
      const off = range.offAllowed === true && v === 0;
      r.range.min = String(range.min);
      r.range.max = String(range.max);
      r.range.step = String(range.step);
      r.range.value = String(off ? (r.meta.onValue ?? range.min) : v);
      r.range.disabled = !editable || off;
      r.value.textContent = formatSetting(r.meta, v);
      if (r.toggle) {
        r.toggle.checked = !off;
        r.toggle.disabled = !editable;
      }
    }
    resetBtn.hidden = !editable;
    resetBtn.disabled = JSON.stringify(current) === JSON.stringify(DEFAULT_SETTINGS);
  }

  resetBtn.addEventListener('click', () => {
    current = sanitizeSettings({});
    render();
    o.onChange?.({ ...current });
  });

  const el = h(
    'details',
    { class: 'settings', 'data-settings': '' },
    h('summary', {}, h('strong', {}, 'Match settings'), summary),
    h(
      'div',
      { class: 'settings-body' },
      ...rows.map((r) =>
        h(
          'div',
          { class: 'settings-row', title: r.meta.hint },
          h('span', { class: 'settings-label' }, r.meta.label),
          h('span', { class: 'settings-control' }, r.toggle, r.range),
          r.value,
        ),
      ),
      h('div', { class: 'settings-foot' }, h('span', { class: 'settings-note' }, editable ? 'Both players play by these.' : 'Set by the host.'), resetBtn),
    ),
  );
  const note = el.querySelector('.settings-note')!;

  render();
  return {
    el,
    get: () => ({ ...current }),
    set(s) {
      current = sanitizeSettings({ ...s });
      render();
    },
    setEditable(on) {
      editable = on;
      note.textContent = on ? 'Both players play by these.' : 'Set by the host.';
      render();
    },
  };
}
