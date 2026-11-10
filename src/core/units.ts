import { CM_PER_FOOT, CM_PER_INCH } from '../types';
import type { FormatArea, FormatLength, ParseLength } from '../types';

export const formatLength: FormatLength = (cm, units) => {
  if (units === 'metric') return `${Math.round(cm)} cm`;
  const halves = Math.round((cm / CM_PER_INCH) * 2);
  const sign = halves < 0 ? '-' : '';
  const h = Math.abs(halves);
  const ft = Math.floor(h / 24);
  const inches = Math.floor((h % 24) / 2);
  return `${sign}${ft}' ${inches}${h % 2 ? ' 1/2' : ''}"`;
};

const UNIT_CM: Record<string, number> = {
  ft: CM_PER_FOOT, feet: CM_PER_FOOT, foot: CM_PER_FOOT, "'": CM_PER_FOOT,
  in: CM_PER_INCH, inch: CM_PER_INCH, inches: CM_PER_INCH, '"': CM_PER_INCH,
  m: 100, cm: 1, mm: 0.1,
};
const TOKEN = /\s*(\d+(?:\.\d*)?|\.\d+)\s*(feet|foot|ft|inches|inch|in|mm|cm|m|'|")?/y;

export const parseLength: ParseLength = (text, units, bare) => {
  const s = text.trim().toLowerCase().replace(/[’′]/g, "'").replace(/[”″]/g, '"')
    .replace(/(\d+\s+)?(\d+)\/(\d+)/g, (_, w: string | undefined, a: string, b: string) => String(Number(w ?? 0) + Number(a) / Number(b))); // `4 1/2` -> 4.5
  if (!s) return null;
  const tokens: { n: number; unit?: string }[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < s.length) {
    const m = TOKEN.exec(s);
    if (!m) return null;
    tokens.push({ n: parseFloat(m[1]), unit: m[2] });
  }
  const bareUnit = bare ?? (units === 'imperial' ? 'in' : 'cm');
  let total = 0;
  for (let i = 0; i < tokens.length; i++) {
    const { n, unit } = tokens[i];
    let u = unit;
    // a unitless number is only allowed alone, or as inches after feet (`10' 6`)
    if (!u) {
      if (tokens.length === 1) u = bareUnit;
      else if (i === tokens.length - 1 && UNIT_CM[tokens[i - 1].unit ?? ''] === CM_PER_FOOT) u = 'in';
      else return null;
    }
    total += n * UNIT_CM[u];
  }
  return Number.isFinite(total) && total > 0 ? total : null;
};

export const formatArea: FormatArea = (cm2, units) =>
  units === 'imperial' ? `${(cm2 / (CM_PER_FOOT * CM_PER_FOOT)).toFixed(1)} sq ft` : `${(cm2 / 10000).toFixed(2)} m²`;
