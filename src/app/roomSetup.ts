import { parseLength } from '../core/units';
import type { Cm, UnitSystem } from '../types';

export type RoomField = 'width' | 'length' | 'height';
export type RoomSetupResult =
  | { ok: true; width: Cm; length: Cm; height: Cm }
  | { ok: false; errors: Partial<Record<RoomField, string>> };

export const defaultCeilingText = (units: UnitSystem) => (units === 'imperial' ? `8'` : '2.4 m');
export const formatHint = (units: UnitSystem) =>
  units === 'imperial'
    ? `Try 12' 6", 12ft 6in, 150in, or just 12.5 (feet).`
    : 'Try 3.8 m, 380 cm, 3800 mm, or just 3.8 (metres).';

const LIMITS: Record<RoomField, [Cm, Cm, string]> = {
  width: [50, 10000, 'Width'],
  length: [50, 10000, 'Length'],
  height: [150, 1000, 'Ceiling height'],
};

/** Parses the room-setup fields (bare numbers = feet / metres). An empty ceiling height uses the default. */
export function validateRoomSetup(text: Record<RoomField, string>, units: UnitSystem): RoomSetupResult {
  const errors: Partial<Record<RoomField, string>> = {};
  const values = {} as Record<RoomField, Cm>;
  for (const field of ['width', 'length', 'height'] as RoomField[]) {
    const raw = field === 'height' && !text.height.trim() ? defaultCeilingText(units) : text[field];
    const [min, max, label] = LIMITS[field];
    const cm = raw.trim() ? parseLength(raw, units, units === 'imperial' ? 'ft' : 'm') : null;
    if (cm === null) errors[field] = raw.trim() ? `${label}: couldn't read "${raw}".` : `${label} is required.`;
    else if (cm < min) errors[field] = `${label} looks too small.`;
    else if (cm > max) errors[field] = `${label} looks too big.`;
    else values[field] = cm;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, ...values };
}
