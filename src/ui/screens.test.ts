// Full-time Rematch button latch (M17.3 bug bash: repeated rematch clicks).
import { describe, expect, it } from 'vitest';
import { REMATCH_PENDING_MS, rematchDisabled } from './screens';

describe('rematch button', () => {
  it('is enabled before a vote, disabled once this device voted', () => {
    expect(rematchDisabled(false, null, 1000)).toBe(false);
    expect(rematchDisabled(true, null, 1000)).toBe(true);
  });

  it('stays disabled while a click is pending, even if a state without our vote arrives', () => {
    // Clicked at t = 1000; the other seat's vote arrives first (voted still false).
    expect(rematchDisabled(false, 1000, 1001)).toBe(true);
    expect(rematchDisabled(false, 1000, 1000 + REMATCH_PENDING_MS - 1)).toBe(true);
  });

  it('re-enables after the pending window if the vote never arrived (lost on a reconnect)', () => {
    expect(rematchDisabled(false, 1000, 1000 + REMATCH_PENDING_MS)).toBe(false);
    expect(rematchDisabled(true, 1000, 1000 + REMATCH_PENDING_MS)).toBe(true);
  });
});
