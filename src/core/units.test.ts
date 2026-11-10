import { describe, expect, test } from 'vitest';
import { formatArea, formatLength, parseLength } from './units';

describe('formatLength', () => {
  test('imperial', () => {
    expect(formatLength(304.8, 'imperial')).toBe(`10' 0"`);
    expect(formatLength(76 * 2.54, 'imperial')).toBe(`6' 4"`);
    expect(formatLength(76.5 * 2.54, 'imperial')).toBe(`6' 4 1/2"`);
    expect(formatLength(11.99 * 2.54, 'imperial')).toBe(`1' 0"`);
    expect(formatLength(6 * 2.54, 'imperial')).toBe(`0' 6"`);
  });
  test('metric', () => expect(formatLength(304.8, 'metric')).toBe('305 cm'));
});

describe('parseLength', () => {
  test.each([
    [`10'`, 304.8], [`10' 6"`, 320.04], ['10ft 6in', 320.04], ['126in', 320.04], ['126"', 320.04],
    ['3.2m', 320], ['320cm', 320], ['320 mm', 32], [`10'6"`, 320.04], [`10' 6`, 320.04], [`6' 4 1/2"`, 194.31],['  7 FT ', 213.36],
  ])('%s', (text, cm) => expect(parseLength(text, 'imperial')).toBeCloseTo(cm, 6));
  test('bare numbers', () => {
    expect(parseLength('12', 'imperial')).toBeCloseTo(30.48);
    expect(parseLength('12', 'metric')).toBe(12);
    expect(parseLength('2', 'metric', 'm')).toBe(200);
    expect(parseLength('2', 'imperial', 'ft')).toBeCloseTo(60.96);
  });
  test.each(['', '  ', 'abc', '-5', '0', '0cm', '10 5', '5 xyz', '1..2', '5cm 3', 'cm'])('invalid %j', (t) =>
    expect(parseLength(t, 'metric')).toBeNull());
  test('round trips', () => {
    for (let h = 1; h < 400; h += 7) {
      const cm = (h / 2) * 2.54;
      expect(parseLength(formatLength(cm, 'imperial'), 'imperial')).toBeCloseTo(cm, 6);
    }
    for (const cm of [1, 45, 305, 1234]) expect(parseLength(formatLength(cm, 'metric'), 'metric')).toBe(cm);
  });
});

test('formatArea', () => {
  expect(formatArea(120 * 30.48 * 30.48, 'imperial')).toBe('120.0 sq ft');
  expect(formatArea(111500, 'metric')).toBe('11.15 m²');
});
