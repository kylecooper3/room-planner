// Shared visual palette. src/app/styles.css mirrors these as CSS custom properties (--bg, --surface, ...); the 2D plan
// (SVG) and 3D scene read them from here. Calm, neutral, architectural: one accent, no cartoon colours.
export const THEME = {
  bg: '#f6f6f4',
  surface: '#ffffff',
  surface2: '#f0f0ed',
  border: '#e2e2dd',
  text: '#1d2025',
  text2: '#5c626c',
  text3: '#8b9099',
  accent: '#2f6bdc',
  accentSoft: '#e6eefc',
  danger: '#d1453b',
  success: '#2e8b57',
  warning: '#c98a12',

  // 2D plan
  planBg: '#f3f3f0',
  planGrid: '#e6e6e1',
  planGridMajor: '#d6d6d0',
  planFloor: '#fcfcfa',
  planWall: '#2a2d32',
  planItemFill: '#eceef2',
  planItemStroke: '#4b5260',
  planLabel: '#3a3f47',
  planDim: '#6b717b',

  // 3D scene
  sceneBg: '#eceae6',
  sceneGround: '#e3e1dc',
  wall3d: '#f2f0ec',
} as const;
