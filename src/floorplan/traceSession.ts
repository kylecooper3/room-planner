import { create } from 'zustand';
import { CM_PER_FOOT } from '../types';
import type { Project, Room, Underlay, UnitSystem, Vec2 } from '../types';
import { polygonArea } from '../core/geometry';

/**
 * Wizard state of the "Trace floor plan" panel. UI-only and in memory: the project itself (underlay, rooms) stays in the
 * main store. Reset whenever a new plan image is added.
 */
export interface TraceSession {
  /** Step the user jumped to (1-5), or null to derive it from the project. */
  step: number | null;
  skipScale: boolean;
  /** The listed total area (cm²), when the user knows it. */
  knownArea: number | null;
  /** Per-room override of "counts toward the listed area" (default: everything except balconies). */
  counted: Record<string, boolean>;
  /** Room just traced, waiting for a name. */
  namingId: string | null;
  collapsed: boolean;
}
export const freshSession = (): TraceSession => ({
  step: null, skipScale: false, knownArea: null, counted: {}, namingId: null, collapsed: false,
});
export const useTrace = create<TraceSession>(() => freshSession());

/** The image is shown 10 m wide until the scale is set. */
export const defaultCmPerPx = (widthPx: number) => 1000 / widthPx;
export const isCalibrated = (u: Underlay) => Math.abs(u.cmPerPx - defaultCmPerPx(u.widthPx)) > 1e-9 * u.cmPerPx;

const OUTDOOR = /balcon|lanai|patio|terrace|deck|porch/i;
export const countsTowardArea = (room: Room, counted: Record<string, boolean>) => counted[room.id] ?? !OUTDOOR.test(room.name);

/** First step that still needs doing (1 add plan, 2 scale, 3 trace). */
export function derivedStep(p: Project, s: Pick<TraceSession, 'skipScale' | 'knownArea'>): number {
  if (!p.underlay) return 1;
  if (!isCalibrated(p.underlay) && !s.skipScale && s.knownArea === null && !p.rooms.length) return 2;
  return 3;
}

/** "1 ft ≈ 19 px on your image" */
export function scaleWords(u: Underlay, units: UnitSystem): string {
  const per = units === 'imperial' ? CM_PER_FOOT : 100;
  const px = per / u.cmPerPx;
  return `1 ${units === 'imperial' ? 'ft' : 'm'} ≈ ${px >= 10 ? Math.round(px) : px.toFixed(1)} px on your image`;
}

/** Listed area text → cm². Accepts `531`, `531 sq ft`, `531 sqft`, `531 ft²`, `49.3 m²`, `49.3 m2`, `49.3 sq m`; a bare number uses the project units. */
export function parseArea(text: string, units: UnitSystem): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(sq\.?\s*ft|sqft|sf|ft2|ft²|feet²|sq\.?\s*m|sqm|m2|m²)?\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  if (!(n > 0)) return null;
  const unit = m[2]?.toLowerCase() ?? (units === 'imperial' ? 'ft' : 'm');
  return /f/.test(unit) ? n * CM_PER_FOOT * CM_PER_FOOT : n * 10000;
}

/**
 * Uniform scale factor about the underlay origin that makes the counted rooms add up to `target` cm², and the scaled
 * underlay + room outlines. Null when nothing is counted.
 */
export function scaleToArea(u: Underlay, rooms: Room[], counted: Record<string, boolean>, target: number) {
  const total = rooms.filter((r) => countsTowardArea(r, counted)).reduce((a, r) => a + polygonArea(r.points), 0);
  if (!(total > 0) || !(target > 0)) return null;
  const s = Math.sqrt(target / total);
  const at = (p: Vec2) => ({ x: u.x + (p.x - u.x) * s, y: u.y + (p.y - u.y) * s });
  return { factor: s, underlay: { cmPerPx: u.cmPerPx * s }, rooms: rooms.map((r) => ({ id: r.id, points: r.points.map(at) })) };
}
