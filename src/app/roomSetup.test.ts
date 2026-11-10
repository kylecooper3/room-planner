import { describe, expect, test, vi } from 'vitest';

// Fake parser: "<n><unit>" or bare "<n>" using the `bare` unit.
vi.mock('../core/units', () => ({
  parseLength: (text: string, _u: string, bare = 'cm') => {
    const m = /^\s*(\d+(?:\.\d+)?)\s*(ft|'|m|cm)?\s*$/.exec(text);
    if (!m || Number(m[1]) <= 0) return null;
    const unit = m[2] === "'" ? 'ft' : (m[2] ?? bare);
    return Number(m[1]) * ({ ft: 30.48, m: 100, cm: 1 } as Record<string, number>)[unit];
  },
}));
const { validateRoomSetup } = await import('./roomSetup');

describe('validateRoomSetup', () => {
  test('bare numbers are feet (imperial) and metres (metric); empty height defaults', () => {
    expect(validateRoomSetup({ width: '10', length: '12', height: '' }, 'imperial'))
      .toEqual({ ok: true, width: 304.8, length: 365.76, height: 243.84 });
    expect(validateRoomSetup({ width: '3', length: '4.5', height: '' }, 'metric'))
      .toEqual({ ok: true, width: 300, length: 450, height: 240 });
  });

  test('reports missing, unreadable and out-of-range fields', () => {
    const r = validateRoomSetup({ width: '', length: 'abc', height: '20cm' }, 'metric');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.width).toMatch(/required/);
    expect(r.errors.length).toMatch(/couldn't read/);
    expect(r.errors.height).toMatch(/too small/);
    const big = validateRoomSetup({ width: '500', length: '3', height: '' }, 'metric');
    expect(!big.ok && big.errors.width).toMatch(/too big/);
  });
});
