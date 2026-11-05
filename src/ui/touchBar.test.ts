// Touch UI detection (M16.1). The DOM parts are checked in the browser; here only the pure bits.
import { describe, expect, it } from 'vitest';
import { parseFlags } from '../app/router';
import { HEIGHT_TAP_STEP, isTouchUi } from './touchBar';
import { DOUBLE_TAP_MS } from './kickPanel';

describe('touch UI', () => {
  it('?touch forces it on; without a window (Node) it is off', () => {
    expect(isTouchUi(true)).toBe(true);
    expect(isTouchUi(false)).toBe(false);
    expect(isTouchUi(parseFlags('?touch').touch)).toBe(true);
    expect(isTouchUi(parseFlags('').touch)).toBe(false);
  });
  it('tap steps are sensible', () => {
    expect(HEIGHT_TAP_STEP).toBeGreaterThan(0);
    expect(HEIGHT_TAP_STEP).toBeLessThanOrEqual(1);
    expect(DOUBLE_TAP_MS).toBeGreaterThan(150);
  });
});
