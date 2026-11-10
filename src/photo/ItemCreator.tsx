import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import {
  CATEGORIES, MATERIALS, PART_ROLES,
  type Category, type ItemDef, type Material, type PartColors, type PartRole, type PhotoAnalysis, type PhotoProgress,
  type Size3, type StyleParams, type StyleValue, type UnitSystem,
} from '../types';
import { useStore } from '../store/store';
import { putBlob, useBlobUrl } from '../store/blobs';
import { formatLength, parseLength } from '../core/units';
import { STYLE_SCHEMA, defaultStyle } from '../models/generate';
import { defaultClearances } from '../models/presets';
import { ItemModelView } from '../models/ItemModelView';
import { analyzePhoto, mapPaletteToParts } from './analyze';
import './ic-creator.css';

const DIMS = ['w', 'd', 'h'] as const;
const DIM_LABEL = { w: 'Width', d: 'Depth', h: 'Height' };
const DEFAULT_SIZE: Size3 = { w: 60, d: 60, h: 60 };
type DimText = Record<keyof Size3, string>;

const fmt = (cm: number, units: UnitSystem) => { try { return formatLength(cm, units); } catch { return String(Math.round(cm)); } };
const parse = (t: string, units: UnitSystem) => { try { return parseLength(t, units); } catch { return null; } };
/** Sane furniture dimensions, cm. */
const MIN_DIM = 1, MAX_DIM = 1000;
const dimError = (t: string, units: UnitSystem): string | null => {
  if (t.trim() === '') return null;
  const v = parse(t, units);
  if (v === null) return 'Not a valid length';
  if (v < MIN_DIM || v > MAX_DIM) return units === 'imperial' ? 'Must be between ½ in and 32 ft' : 'Must be between 1 cm and 10 m';
  return null;
};

/** Object URL for a local blob, revoked on change/unmount. */
function useObjectUrl(blob: Blob | null) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) { setUrl(undefined); return; }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

function Framer({ size }: { size: Size3 }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const r = Math.max(size.w, size.d, size.h) / 100;
    camera.position.set(r * 1.3, size.h / 100 * 0.6 + r * 0.9, r * 1.8);
    camera.lookAt(0, size.h / 200, 0);
  }, [camera, size.w, size.d, size.h]);
  return null;
}

function Preview({ model, size }: { model: ItemDef['model']; size: Size3 }) {
  return (
    <Canvas className="ic-canvas" camera={{ fov: 35, near: 0.01, far: 100 }} dpr={[1, 2]}>
      <color attach="background" args={['#fbf3e6']} />
      <hemisphereLight args={['#fff8ee', '#d8c8b4', 0.9]} />
      <directionalLight position={[3, 5, 4]} intensity={1.3} />
      <directionalLight position={[-3, 2, -2]} intensity={0.4} />
      <mesh rotation-x={-Math.PI / 2} position-y={-0.001}>
        <circleGeometry args={[Math.max(size.w, size.d) / 100 * 0.9, 48]} />
        <meshStandardMaterial color="#efe3d2" />
      </mesh>
      <ItemModelView model={model} size={size} />
      <OrbitControls makeDefault target={[0, size.h / 200, 0]} enablePan={false} />
      <Framer size={size} />
    </Canvas>
  );
}

/** Shown by the app shell when ui.dialog === 'item-creator'. Creates an item from a photo, or edits ui.editingDefId. Saves via saveDef and closes. */
export function ItemCreator() {
  const units = useStore((s) => s.project.units);
  const editingDefId = useStore((s) => s.ui.editingDefId);
  const editDef = useStore((s) => s.project.library.find((d) => d.id === editingDefId));
  const param = editDef?.model.kind === 'parametric' ? editDef.model : null;

  const [step, setStep] = useState<1 | 2>(editDef ? 2 : 1);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [name, setName] = useState(editDef?.name ?? '');
  const [dims, setDims] = useState<DimText>(() => {
    const s = editDef?.size;
    return { w: s ? fmt(s.w, units) : '', d: s ? fmt(s.d, units) : '', h: s ? fmt(s.h, units) : '' };
  });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Partial<Record<PhotoProgress['stage'], PhotoProgress>>>({});
  const skipCtl = useRef<AbortController | null>(null);
  const [analysis, setAnalysis] = useState<PhotoAnalysis | null>(null);
  const [category, setCategory] = useState<Category>(param?.category ?? 'box');
  const [style, setStyle] = useState<StyleParams>(() => (param ? param.style : safeStyle('box')));
  const [colors, setColors] = useState<PartColors>(() => param?.colors ?? mapPaletteToParts([], 'box', 'fabric'));
  const [material, setMaterial] = useState<Material>(param?.material ?? 'fabric');
  // Saved items carry the user's own colours: never overwrite them on category change.
  const [colorsEdited, setColorsEdited] = useState(!!editDef);
  const [saveError, setSaveError] = useState<string | null>(null);
  const alive = useRef(true);
  // Set on (re)mount too: StrictMode runs mount → cleanup → mount in development.
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const photoUrl = useObjectUrl(photo);
  const cutoutUrl = useObjectUrl(analysis?.cutout ?? null);
  const storedUrl = useBlobUrl(photo ? null : editDef?.photoId);
  const shownPhoto = cutoutUrl ?? photoUrl ?? storedUrl;

  const parsed = useMemo(() => {
    const ok = (t: string) => (dimError(t, units) ? null : parse(t, units));
    return { w: ok(dims.w), d: ok(dims.d), h: ok(dims.h) };
  }, [dims, units]);
  const size: Size3 | null = parsed.w && parsed.d && parsed.h ? { w: parsed.w, d: parsed.d, h: parsed.h } : null;
  const lastSize = useRef<Size3>(editDef?.size ?? DEFAULT_SIZE);
  if (size) lastSize.current = size;
  const previewSize = size ?? lastSize.current;
  const model = useMemo(() => ({ kind: 'parametric' as const, category, style, colors, material }), [category, style, colors, material]);

  const close = () => useStore.getState().setUI({ dialog: 'none', editingDefId: null });

  const pickCategory = (c: Category) => {
    setCategory(c);
    setStyle(safeStyle(c));
    if (!colorsEdited) setColors(mapPaletteToParts(analysis?.palette ?? [], c, material));
  };
  const setColor = (role: PartRole, hex: string) => { setColors((c) => ({ ...c, [role]: hex })); setColorsEdited(true); };

  const analyze = async () => {
    if (!photo || !size) return;
    setBusy(true);
    skipCtl.current = new AbortController();
    try {
      const r = await analyzePhoto(photo, size, (p) => alive.current && setProgress((m) => ({ ...m, [p.stage]: p })), skipCtl.current.signal);
      if (!alive.current) return;
      const c = r.suggestions[0]?.category ?? 'box';
      setAnalysis(r); setCategory(c); setStyle(safeStyle(c)); setColors(r.colors); setMaterial(r.material);
      setColorsEdited(false); setStep(2);
    } catch {
      // analyzePhoto never rejects by contract; stay usable regardless.
      if (alive.current) setStep(2);
    } finally {
      if (alive.current) { setBusy(false); setProgress({}); }
    }
  };

  const skip = () => {
    if (!size) setDims({ w: fmt(DEFAULT_SIZE.w, units), d: fmt(DEFAULT_SIZE.d, units), h: fmt(DEFAULT_SIZE.h, units) });
    setStep(2);
  };

  const save = async () => {
    if (!size) return;
    setSaveError(null);
    try {
      const photoId = photo ? await putBlob(photo) : editDef?.photoId;
      const def: ItemDef = {
        id: editDef?.id ?? crypto.randomUUID(),
        name: name.trim() || cap(category),
        size,
        model,
        clearances: safeClearances(category, size, units),
        source: 'user',
        ...(photoId ? { photoId } : {}),
      };
      const { saveDef, setUI } = useStore.getState();
      saveDef(def);
      setUI({ dialog: 'none', editingDefId: null });
    } catch {
      if (alive.current) setSaveError('Could not save the item. Please try again.');
    }
  };

  const hint = units === 'imperial' ? 'Plain numbers are inches. Also: 6\' 2", 190cm.' : 'Plain numbers are cm. Also: 1.9m, 75in.';
  const dimFields = (
    <div className="ic-dims">
      {DIMS.map((k) => (
        <label key={k} className="field">
          {DIM_LABEL[k]}
          <input data-testid={`dim-${k}`} value={dims[k]} aria-invalid={!!dimError(dims[k], units)}
            onChange={(e) => setDims((d) => ({ ...d, [k]: e.target.value }))} />
          {dimError(dims[k], units) && <span className="ic-error" data-testid={`dim-${k}-error`}>{dimError(dims[k], units)}</span>}
        </label>
      ))}
      <p className="ic-hint">{hint}</p>
    </div>
  );
  const nameField = (
    <label className="field">
      Name
      <input data-testid="item-name" value={name} placeholder="e.g. Grandma's armchair" onChange={(e) => setName(e.target.value)} />
    </label>
  );

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog ic-dialog" role="dialog" aria-label={editDef ? 'Edit item' : 'New item'}>
        <h2>{editDef ? 'Edit item' : step === 1 ? 'New item from a photo' : 'Tune your item'}</h2>

        {step === 1 ? (
          <div className="ic-step1">
            <div className="ic-photo">
              {photoUrl ? <img src={photoUrl} alt="Your photo" /> : <span className="ic-placeholder">📷 Choose a photo of your furniture</span>}
              <input type="file" accept="image/*" data-testid="photo-file"
                onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); setAnalysis(null); }} />
            </div>
            <div className="ic-form">
              {nameField}
              {dimFields}
              {busy && Object.values(progress).map((p) => (
                <div key={p.stage} className="ic-progress" role="status" data-testid={`progress-${p.stage}`}>
                  <span>{p.message ?? p.stage}</span>
                  {p.progress !== undefined && <progress max={1} value={p.progress} />}
                </div>
              ))}
              {busy && Object.values(progress).some((p) => p.progress !== undefined) && (
                <p className="ic-hint">One-time download — the models are cached for offline use afterwards.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="ic-step2">
            <div className="ic-visuals">
              <div className="ic-photo ic-checker">
                {shownPhoto ? <img src={shownPhoto} alt="Item photo" /> : <span className="ic-placeholder">No photo</span>}
              </div>
              <div className="ic-preview"><Preview model={model} size={previewSize} /></div>
            </div>
            <div className="ic-form">
              {analysis?.notes.map((n) => <p key={n} className="note">{n}</p>)}
              {nameField}
              {dimFields}
              <label className="field">
                Category
                <select data-testid="category-select" value={category} onChange={(e) => pickCategory(e.target.value as Category)}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
                </select>
              </label>
              {!!analysis?.suggestions.length && (
                <div className="ic-chips" aria-label="Suggestions">
                  {analysis.suggestions.slice(0, 3).map((s) => (
                    <button key={s.category} type="button" className={'ic-chip' + (s.category === category ? ' active' : '')}
                      onClick={() => pickCategory(s.category)}>
                      {cap(s.category)} <small>{Math.round(s.score * 100)}%</small>
                    </button>
                  ))}
                </div>
              )}
              <StyleFields category={category} style={style} onChange={(k, v) => setStyle((s) => ({ ...s, [k]: v }))} />
              <fieldset className="ic-colors">
                <legend>Colours</legend>
                {PART_ROLES.map((role) => (
                  <div key={role} className="ic-color-row">
                    <label>
                      <input type="color" data-testid={`color-${role}`} value={colors[role]} onChange={(e) => setColor(role, e.target.value)} />
                      {cap(role)}
                    </label>
                    {analysis?.palette.map((p) => (
                      <button key={p.hex} type="button" className="ic-swatch" style={{ background: p.hex }}
                        title={`Use ${p.hex} for ${role}`} aria-label={`Use ${p.hex} for ${role}`} onClick={() => setColor(role, p.hex)} />
                    ))}
                  </div>
                ))}
              </fieldset>
              <label className="field">
                Material
                <select data-testid="material-select" value={material} onChange={(e) => setMaterial(e.target.value as Material)}>
                  {MATERIALS.map((m) => <option key={m} value={m}>{cap(m)}</option>)}
                </select>
              </label>
            </div>
          </div>
        )}

        {saveError && <p className="note error">{saveError}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={close}>Cancel</button>
          {step === 1 ? (
            <>
              {busy
                ? <button type="button" className="btn" data-testid="skip-analysis" onClick={() => skipCtl.current?.abort()}>Skip — I'll pick the type myself</button>
                : <button type="button" className="btn" onClick={skip}>Skip photo</button>}
              <button type="button" className="btn primary" data-testid="analyze-btn" onClick={analyze} disabled={busy || !photo || !size}>
                {busy ? 'Analyzing…' : 'Analyze photo'}
              </button>
            </>
          ) : (
            <button type="button" className="btn primary" data-testid="save-item" onClick={save} disabled={!size}>Save to My stuff</button>
          )}
        </div>
      </div>
    </div>
  );
}

function StyleFields({ category, style, onChange }: { category: Category; style: StyleParams; onChange: (k: string, v: StyleValue) => void }) {
  const schema = STYLE_SCHEMA[category] ?? [];
  if (!schema.length) return null;
  return (
    <fieldset className="ic-style">
      <legend>Style</legend>
      {schema.map((p) => {
        const v = style[p.key] ?? p.default;
        if (p.type === 'boolean') {
          return (
            <label key={p.key} className="ic-check">
              <input type="checkbox" checked={!!v} onChange={(e) => onChange(p.key, e.target.checked)} /> {p.label}
            </label>
          );
        }
        if (p.type === 'select') {
          return (
            <label key={p.key} className="field">
              {p.label}
              <select value={String(v)} onChange={(e) => onChange(p.key, e.target.value)}>
                {(p.options ?? []).map((o) => <option key={o} value={o}>{cap(o)}</option>)}
              </select>
            </label>
          );
        }
        return (
          <label key={p.key} className="field">
            {p.label} <span className="ic-value">{Number(v)}</span>
            <input type="range" min={p.min ?? 0} max={p.max ?? 1} step={p.step ?? 0.01} value={Number(v)}
              onChange={(e) => onChange(p.key, Number(e.target.value))} />
          </label>
        );
      })}
    </fieldset>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function safeStyle(c: Category): StyleParams { try { return defaultStyle(c); } catch { return {}; } }
function safeClearances(c: Category, size: Size3, units: UnitSystem) { try { return defaultClearances(c, size, units); } catch { return []; } }
