import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../game/settings';
import { KEY_ROWS, RULE_SECTIONS } from './help';

const text = RULE_SECTIONS.flatMap((s) => [...(s.paragraphs ?? []), ...(s.bullets ?? [])]).join('\n');

describe('help content', () => {
  it('quotes the default settings, not stale numbers', () => {
    expect(text).toContain(`${DEFAULT_SETTINGS.minTeammateDist} m from your own players`);
    expect(text).toContain(`${DEFAULT_SETTINGS.minOpponentDist} m from the opponent`);
    expect(text).toContain(`${DEFAULT_SETTINGS.kicksPerMatch} kicks`);
    expect(text).toContain(`${DEFAULT_SETTINGS.shotTimerSec} s per kick`);
    expect(text).toContain('closest to where it went out');
    expect(text).toContain('up to 55°');
  });

  it('lists every PLAN §6.2 control', () => {
    const actions = KEY_ROWS.map((r) => r.action);
    for (const a of ['Turn (yaw)', 'Zoom', 'Camera height', 'Power', 'Curve', 'Loft', 'Kick', 'Overhead map', 'Fast-forward playback', 'Playback camera']) {
      expect(actions).toContain(a);
    }
  });

  it('never mentions an aim aid as a feature', () => {
    expect(text.toLowerCase()).not.toMatch(/crosshair|landing marker is/);
  });
});
