import { createContext, useContext } from 'react';
import type { Vec2 } from '../types';

/** Provided by PlanEditor to every layer rendered inside its SVG (all layers draw in plan-space cm). */
export interface PlanView {
  /** Converts a pointer event's client position to plan space (cm). */
  toPlan(e: { clientX: number; clientY: number }): Vec2;
  /** Current zoom: screen pixels per cm. Use it to keep stroke widths / handles a constant screen size. */
  pxPerCm: number;
}
export const PlanViewContext = createContext<PlanView>({ toPlan: (e) => ({ x: e.clientX, y: e.clientY }), pxPerCm: 1 });
export const usePlanView = (): PlanView => useContext(PlanViewContext);
