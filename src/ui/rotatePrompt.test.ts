import { describe, expect, it } from 'vitest';
import { needsRotatePrompt, PORTRAIT_PHONE_MAX_WIDTH } from './rotatePrompt';

describe('rotate prompt', () => {
  it('asks a phone held upright to turn sideways', () => {
    expect(needsRotatePrompt({ width: 390, height: 844, touch: true })).toBe(true);
    expect(needsRotatePrompt({ width: 360, height: 640, touch: true })).toBe(true);
  });
  it('leaves landscape phones alone', () => {
    expect(needsRotatePrompt({ width: 844, height: 390, touch: true })).toBe(false);
    expect(needsRotatePrompt({ width: 667, height: 375, touch: true })).toBe(false);
  });
  it('leaves tablets upright and desktop windows alone', () => {
    expect(needsRotatePrompt({ width: 768, height: 1024, touch: true })).toBe(false);
    expect(needsRotatePrompt({ width: PORTRAIT_PHONE_MAX_WIDTH, height: 900, touch: true })).toBe(false);
    expect(needsRotatePrompt({ width: 500, height: 900, touch: false })).toBe(false);
  });
  it('treats a square screen as landscape', () => {
    expect(needsRotatePrompt({ width: 500, height: 500, touch: true })).toBe(false);
  });
});
