/**
 * SHARED CONTRACT. Every module codes against this file. Do not edit it from a feature module:
 * request changes from the orchestrator instead.
 *
 * CONVENTIONS (read these first)
 * - All lengths are centimetres (cm). Angles are degrees unless a name says otherwise.
 * - PLAN SPACE: 2D, x to the right, y DOWN the screen (same as SVG).
 * - Rotation is clockwise as seen on screen in plan space (same as SVG `rotate(deg)`).
 *   planPoint = center + R(rot) * local, with R: x' = x*cos - y*sin, y' = x*sin + y*cos.
 * - ITEM LOCAL FRAME: origin at the item's centre. Local +x spans the width (w). Local +y is the
 *   item's FRONT (the side you sit on / open drawers from). Depth (d) spans local y.
 *   At rotation 0 the front faces down the screen.
 * - 3D WORLD: metres. worldX = planX * CM_TO_M, worldZ = planY * CM_TO_M, +Y up.
 *   A placed item's three.js rotation.y = -rotation * PI/180. Item model frame: origin at the
 *   floor centre of the item, +y up, +z = front.
 * - Room = one closed polygon `points` (any winding, no repeated last point).
 *   Wall i runs from points[i] to points[(i + 1) % n].
 */

export const CM_TO_M = 0.01;
export const CM_PER_INCH = 2.54;
export const CM_PER_FOOT = 30.48;
/** Standard walkway clearance: 36in in imperial projects, 90cm in metric. */
export const WALKWAY_CM = { imperial: 36 * CM_PER_INCH, metric: 90 } as const;

// ───────────────────────── primitives ─────────────────────────
export type Cm = number;
export interface Vec2 { x: number; y: number }
export interface Segment { a: Vec2; b: Vec2 }
export type Polygon = Vec2[];
/** w = width (local x), d = depth (local y, front-to-back), h = height (up). All cm. */
export interface Size3 { w: Cm; d: Cm; h: Cm }
export type UnitSystem = 'imperial' | 'metric';

// ───────────────────────── room ─────────────────────────
export type OpeningKind = 'door' | 'window' | 'outlet' | 'radiator';
export interface DoorSwing {
  /** Which end of the opening the hinge is on: 'start' = nearer points[wall], 'end' = nearer the next point. */
  hinge: 'start' | 'end';
  /** 'in' = swings into the room interior, 'out' = swings outside. */
  side: 'in' | 'out';
}
export interface Opening {
  id: string;
  kind: OpeningKind;
  /** Wall index: the wall from points[wall] to points[(wall+1)%n]. */
  wall: number;
  /** Distance along the wall from points[wall] to the CENTRE of the opening. */
  offset: Cm;
  width: Cm;
  height: Cm;
  /** Elevation of the opening's bottom edge above the floor (0 for doors). */
  sill: Cm;
  /** Doors only. */
  swing?: DoorSwing;
}
export type FloorMaterial = 'wood' | 'carpet' | 'tile';

export interface PlacedItem {
  id: string;
  /** ItemDef id (a preset id or a user "My stuff" id). */
  defId: string;
  /** Plan position of the item's centre. */
  x: Cm;
  y: Cm;
  rotation: number;
}
export interface Layout { id: string; name: string; items: PlacedItem[] }

export interface Room {
  id: string;
  name: string;
  points: Vec2[];
  ceilingHeight: Cm;
  wallThickness: Cm;
  openings: Opening[];
  wallColor: string;
  floor: FloorMaterial;
  /** Always at least one layout. */
  layouts: Layout[];
  activeLayoutId: string;
}

/** Floor-plan image shown under the 2D editor. Project-level so several rooms can be traced from one plan. */
export interface Underlay {
  /** Blob-store id of the image. */
  imageId: string;
  widthPx: number;
  heightPx: number;
  /** Scale: real cm per image pixel (set by calibration; default 1). */
  cmPerPx: number;
  /** Plan position of the image's top-left corner. */
  x: Cm;
  y: Cm;
  opacity: number;
  visible: boolean;
}

// ───────────────────────── items & models ─────────────────────────
export type Category =
  | 'sofa' | 'armchair' | 'chair' | 'bed' | 'table' | 'desk' | 'dresser' | 'shelf'
  | 'nightstand' | 'lamp' | 'rug' | 'plant' | 'tv' | 'box';
export const CATEGORIES: Category[] = [
  'sofa', 'armchair', 'chair', 'bed', 'table', 'desk', 'dresser', 'shelf',
  'nightstand', 'lamp', 'rug', 'plant', 'tv', 'box',
];
export type Material = 'fabric' | 'wood' | 'metal' | 'leather' | 'plastic';
export const MATERIALS: Material[] = ['fabric', 'wood', 'metal', 'leather', 'plastic'];
/** Colourable part groups of a parametric model. */
export type PartRole = 'body' | 'cushion' | 'frame' | 'accent';
export const PART_ROLES: PartRole[] = ['body', 'cushion', 'frame', 'accent'];
/** Hex colours '#rrggbb' per part role. */
export type PartColors = Record<PartRole, string>;
export type StyleValue = number | string | boolean;
export type StyleParams = Record<string, StyleValue>;

/** A procedural model: category generator + style params. */
export interface ParametricModel {
  kind: 'parametric';
  category: Category;
  /** Missing keys fall back to the category's schema defaults. */
  style: StyleParams;
  colors: PartColors;
  material: Material;
}
/** Extension point for future true photo-to-mesh generation. Rendered as a box placeholder today. */
export interface MeshModel { kind: 'mesh'; /** Blob-store id of a GLB. */ meshId: string }
export type ItemModel = ParametricModel | MeshModel;

export type ClearanceKind = 'drawer' | 'chair' | 'walkway' | 'access';
/** A rectangle extending `depth` outward from one side of the item, spanning that whole side. */
export interface ClearanceZone {
  kind: ClearanceKind;
  /** front = local +y, back = local -y, left = local -x, right = local +x. */
  side: 'front' | 'back' | 'left' | 'right';
  depth: Cm;
  /** Short human label, e.g. "drawer pull-out". */
  label: string;
}

export interface ItemDef {
  id: string;
  name: string;
  size: Size3;
  model: ItemModel;
  clearances: ClearanceZone[];
  source: 'preset' | 'user';
  /** Blob-store id of the original photo (photo-created items). */
  photoId?: string;
}
/** Flat floor coverings (rugs) never collide with other items. */
export const isFlat = (def: ItemDef): boolean => def.model.kind === 'parametric' && def.model.category === 'rug';

/**
 * One primitive of a generated model, in the item model frame (cm; origin at floor centre, +y up, +z front).
 * The union AABB of all parts MUST be exactly [-w/2,w/2] x [0,h] x [-d/2,d/2].
 */
export interface ModelPart {
  role: PartRole;
  shape: 'box' | 'cylinder' | 'sphere' | 'cone';
  /** Extents along x, y, z in cm (cylinder/cone: x = z = diameter, y = height; sphere: per-axis diameters). */
  size: [number, number, number];
  /** Centre of the part. */
  position: [number, number, number];
  /** Euler XYZ radians. */
  rotation?: [number, number, number];
  /** Box corner radius in cm. */
  round?: number;
  /** Overrides the role colour (rare; e.g. a TV screen). */
  color?: string;
}
export interface StyleParamDef {
  key: string;
  label: string;
  type: 'number' | 'select' | 'boolean';
  default: StyleValue;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

// ───────────────────────── project ─────────────────────────
export interface Project {
  version: 1;
  name: string;
  units: UnitSystem;
  rooms: Room[];
  activeRoomId: string | null;
  /** "My stuff": user-created item definitions, shared by every room and layout. */
  library: ItemDef[];
  underlay: Underlay | null;
}

// ───────────────────────── issues (clearance checking) ─────────────────────────
export type IssueKind = 'overlap' | 'outside-room' | 'clearance-blocked' | 'door-swing-blocked';
export interface Issue {
  id: string;
  kind: IssueKind;
  /** Every placed item involved; all of them are highlighted red. */
  itemIds: string[];
  openingId?: string;
  /** Short plain-language explanation, e.g. "Dresser blocks the door swing". */
  message: string;
  /** The blocked clearance / swing polygon in plan space, when relevant. */
  zone?: Polygon;
}

// ───────────────────────── UI state ─────────────────────────
export type ViewMode = 'plan' | '3d' | 'split' | 'compare';
/** draw-room: click corners to create a NEW room. place-opening: click a wall to add ui.openingKind. calibrate: floor-plan scale tool. */
export type Tool = 'select' | 'draw-room' | 'place-opening' | 'calibrate';
export type Selection =
  | { type: 'item'; id: string }
  | { type: 'opening'; id: string }
  | { type: 'corner'; index: number }
  /** Wall i of the active room (points[i] -> points[i+1]). */
  | { type: 'wall'; index: number };
export type DialogName = 'none' | 'help' | 'room-setup' | 'floorplan' | 'item-creator';
export interface UIState {
  view: ViewMode;
  tool: Tool;
  openingKind: OpeningKind;
  selection: Selection | null;
  showGrid: boolean;
  showClearances: boolean;
  snap: boolean;
  cutaway: boolean;
  walkMode: boolean;
  /** Layout shown on the right in compare view (left is the active layout). */
  compareLayoutId: string | null;
  dialog: DialogName;
  /** When dialog === 'item-creator': the user ItemDef being edited, or null to create from a photo. */
  editingDefId: string | null;
}

// ───────────────────────── store ─────────────────────────
/**
 * Every project-mutating action records ONE undo step, except between beginBatch() and endBatch(),
 * where all mutations collapse into a single step (use for drags). UI actions never touch history.
 * Layout/item/opening actions operate on the ACTIVE room (and its active layout).
 */
export interface Actions {
  newProject(): void;
  loadDemo(): void;
  /** Replace everything (import). Clears history. */
  replaceProject(p: Project): void;
  setUnits(u: UnitSystem): void;
  /** Renames the project (one undo step). */
  setProjectName(name: string): void;

  /** Creates a room with one empty layout, makes it active, returns its id. */
  addRoom(input: { points: Vec2[]; ceilingHeight?: Cm; name?: string }): string;
  /** Changing `points` drops/clamps openings that no longer fit their wall. */
  updateRoom(roomId: string, patch: Partial<Omit<Room, 'id' | 'layouts' | 'openings'>>): void;
  deleteRoom(roomId: string): void;
  setActiveRoom(roomId: string): void;

  addOpening(o: Omit<Opening, 'id'>): string;
  updateOpening(id: string, patch: Partial<Omit<Opening, 'id'>>): void;
  deleteOpening(id: string): void;

  addLayout(name?: string): string;
  duplicateLayout(layoutId: string): string;
  renameLayout(layoutId: string, name: string): void;
  deleteLayout(layoutId: string): void;
  setActiveLayout(layoutId: string): void;

  /** Places at `pos`, or at the room centroid when omitted. Selects it. Returns the new PlacedItem id. */
  placeItem(defId: string, pos?: Vec2): string;
  updateItem(id: string, patch: Partial<Omit<PlacedItem, 'id'>>): void;
  deleteItem(id: string): void;
  /** Offsets the copy slightly, selects it, returns its id. */
  duplicateItem(id: string): string;

  /** Upsert a user item into "My stuff". */
  saveDef(def: ItemDef): void;
  /** Removes the def and every placed instance of it in all rooms/layouts. */
  deleteDef(defId: string): void;

  setUnderlay(u: Underlay | null): void;
  updateUnderlay(patch: Partial<Underlay>): void;

  undo(): void;
  redo(): void;
  beginBatch(): void;
  endBatch(): void;

  setUI(patch: Partial<UIState>): void;
  select(sel: Selection | null): void;
}
export interface AppState extends Actions {
  project: Project;
  ui: UIState;
  canUndo: boolean;
  canRedo: boolean;
  /** False until the autosaved project has been loaded from IndexedDB. */
  hydrated: boolean;
}

// ───────────────────────── helper signatures: units (src/core/units.ts) ─────────────────────────
/** imperial: 304.8 -> `10' 0"` (nearest 1/2 inch, e.g. `6' 4 1/2"`); metric: `305 cm`. */
export type FormatLength = (cm: Cm, units: UnitSystem) => string;
/**
 * Parses user text to cm, or null if invalid/non-positive. Accepts `10'`, `10' 6"`, `10ft 6in`, `126in`, `126"`,
 * `3.2m`, `320cm`, `320 mm`. A bare number uses `bare` (default: 'in' for imperial, 'cm' for metric).
 */
export type ParseLength = (text: string, units: UnitSystem, bare?: 'ft' | 'in' | 'm' | 'cm') => Cm | null;
/** imperial: `120.0 sq ft`; metric: `11.15 m²`. Input is cm². */
export type FormatArea = (cm2: number, units: UnitSystem) => string;

// ───────────────────────── helper signatures: geometry (src/core/geometry.ts) ─────────────────────────
export type RectRoomPoints = (width: Cm, length: Cm) => Vec2[]; // (0,0),(w,0),(w,l),(0,l)
export type WallSegments = (points: Vec2[]) => Segment[];
/** Absolute area. */
export type PolygonArea = (poly: Polygon) => number;
export type PolygonCentroid = (poly: Polygon) => Vec2;
export type PointInPolygon = (p: Vec2, poly: Polygon) => boolean;
export type Pose = Pick<PlacedItem, 'x' | 'y' | 'rotation'>;
export type LocalToPlan = (pose: Pose, local: Vec2) => Vec2;
/** Footprint corners in order: local (-w/2,-d/2), (w/2,-d/2), (w/2,d/2), (-w/2,d/2). */
export type ItemPolygon = (pose: Pose, size: Size3) => Polygon;
export type ClearancePolygon = (pose: Pose, size: Size3, zone: ClearanceZone) => Polygon;
export interface OpeningGeometry {
  /** Opening end nearer points[wall], and the far end, on the wall centre line. */
  a: Vec2;
  b: Vec2;
  center: Vec2;
  /** Wall direction angle in degrees (atan2 of b - a, plan space). */
  angle: number;
  /** Unit normal pointing into the room interior. */
  normalIn: Vec2;
}
export type GetOpeningGeometry = (points: Vec2[], opening: Pick<Opening, 'wall' | 'offset' | 'width'>) => OpeningGeometry;
/** Convex quarter-disc approximation (>= 8 arc segments) of a door's swing; null for non-doors. */
export type DoorSwingPolygon = (points: Vec2[], opening: Opening) => Polygon | null;
/** CONVEX polygons only. Merely touching/flush (penetration < 0.5cm) is NOT an intersection. */
export type PolygonsIntersect = (a: Polygon, b: Polygon) => boolean;
/** True when `poly` lies inside the (possibly concave) room polygon, with 0.5cm tolerance so flush-to-wall counts as inside. */
export type PolygonInsideRoom = (poly: Polygon, roomPoints: Vec2[]) => boolean;
/** Nearest point on any wall: used to place/drag openings. */
export type ProjectOnWalls = (points: Vec2[], p: Vec2) => { wall: number; offset: Cm; distance: Cm; point: Vec2 };
/** Snaps p so prev->p is axis-aligned (0/90/180/270) — right-angle drawing. */
export type SnapRightAngle = (prev: Vec2, p: Vec2) => Vec2;
export interface WallDistance {
  /** Midpoint of the item side the measurement starts from, and where it hits the wall. */
  from: Vec2;
  to: Vec2;
  distance: Cm;
  side: 'front' | 'back' | 'left' | 'right';
}
/** For each item side, the perpendicular ray distance from the side midpoint to the nearest wall hit (omitted if no hit). */
export type DistancesToWalls = (pose: Pose, size: Size3, roomPoints: Vec2[]) => WallDistance[];
export interface Guide extends Segment { kind: 'wall' | 'align' }
export interface SnapInput {
  roomPoints: Vec2[];
  /** The other solid items in the layout. */
  others: { pose: Pose; size: Size3 }[];
  /** Proposed (unsnapped) pose of the moving item. */
  pose: Pose;
  size: Size3;
  /** Snap distance in cm (the editor passes ~8 screen px converted to cm). */
  threshold: Cm;
}
export interface SnapResult { x: Cm; y: Cm; guides: Guide[] }
/** Snaps the moving item's AABB edges flush to walls and to other items' edges/centres; returns alignment guides to draw. */
export type SnapItem = (input: SnapInput) => SnapResult;

// ───────────────────────── helper signatures: collision (src/core/collision.ts) ─────────────────────────
/**
 * All problems in a layout:
 * - overlap: two non-flat items intersect
 * - outside-room: an item crosses a wall / lies outside the room polygon
 * - clearance-blocked: an item's clearance zone is hit by another non-flat item, or (except 'walkway' zones) crosses a wall
 * - door-swing-blocked: a non-flat item intersects a door's swing (only swings with side 'in')
 * Flat items (rugs) never cause or receive issues other than outside-room.
 */
export type FindIssues = (room: Room, layout: Layout, getDef: (defId: string) => ItemDef | undefined) => Issue[];

// ───────────────────────── helper signatures: models (src/models) ─────────────────────────
export type GenerateModel = (model: ParametricModel, size: Size3) => ModelPart[];
export type StyleSchema = Record<Category, StyleParamDef[]>;
export type DefaultClearances = (category: Category, size: Size3, units: UnitSystem) => ClearanceZone[];
/** Sensible neutral default colours for a category (used by presets and as a base for photo items). */
export type DefaultColors = (category: Category) => PartColors;

// ───────────────────────── helper signatures: photo pipeline (src/photo) ─────────────────────────
export interface PaletteColor { hex: string; /** Fraction of item pixels, 0..1; palette sorted descending. */ weight: number }
export interface CategorySuggestion { category: Category; score: number }
/** ok = primary method ran; fallback = degraded method ran; skipped = stage produced a default. */
export type StageStatus = 'ok' | 'fallback' | 'skipped';
export interface PhotoAnalysis {
  /** Background-removed PNG, or null when segmentation was unavailable (colours then come from the whole photo). */
  cutout: Blob | null;
  palette: PaletteColor[];
  /** Sorted best-first; may be empty when classification was skipped (user picks manually). */
  suggestions: CategorySuggestion[];
  material: Material;
  /** Palette mapped onto parts for the top suggestion (or 'box'). */
  colors: PartColors;
  stages: { segmentation: StageStatus; palette: StageStatus; classification: StageStatus; material: StageStatus };
  /** User-facing notes about fallbacks, e.g. "Background removal unavailable — using the whole photo." */
  notes: string[];
}
export interface PhotoProgress { stage: 'segmentation' | 'palette' | 'classification' | 'material'; /** 0..1 download/compute progress when known. */ progress?: number; message?: string }
/** Never rejects because of ML failures: every stage degrades gracefully. */
export type AnalyzePhoto = (photo: Blob, size: Size3, onProgress?: (p: PhotoProgress) => void) => Promise<PhotoAnalysis>;
/** k-means over RGBA pixels, ignoring pixels with alpha < 128. */
export type ExtractPalette = (rgba: Uint8ClampedArray, k?: number) => PaletteColor[];
export type EstimateMaterial = (rgba: Uint8ClampedArray, width: number, height: number) => Material;
export type MapPaletteToParts = (palette: PaletteColor[], category: Category, material: Material) => PartColors;

// ───────────────────────── helper signatures: persistence (src/store) ─────────────────────────
/** Stores a blob in IndexedDB, returns its new id. */
export type PutBlob = (blob: Blob) => Promise<string>;
export type GetBlob = (id: string) => Promise<Blob | undefined>;
export type DeleteBlob = (id: string) => Promise<void>;
/** Single-file project archive (.roomplan = zip of project.json + every referenced blob). */
export type ExportProject = (project: Project) => Promise<Blob>;
/** Parses an archive, writes its blobs to the blob store, returns the project (caller passes it to replaceProject). Rejects on invalid files. */
export type ImportProject = (file: Blob) => Promise<Project>;
