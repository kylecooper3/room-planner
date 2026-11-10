import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { CM_TO_M as M, type Vec2 } from '../types';
import { useStore } from '../store/store';
import { MOVE_KEYS, moveVector, walkStep, type Collider } from './walk';

export interface Bounds { cx: number; cz: number; span: number } // metres

const MIN_POLAR = 0.15, TOP_POLAR = 0.001;

/**
 * Orbit camera around the house; refits (3/4 view) when the bounds change. Disabled (not unmounted) while walking.
 * `top` animates to straight down and back. Left-drag orbits, right-drag / Shift+left-drag pans, wheel zooms.
 */
export function OrbitRig({ bounds, enabled, top }: { bounds: Bounds; enabled: boolean; top: boolean }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const anim = useRef({ to: 0, active: false, back: -1 }); // back < 0: never went to top view
  const sph = useRef(new THREE.Spherical());
  const off = useRef(new THREE.Vector3());
  const { cx, cz, span } = bounds;
  useEffect(() => {
    const dist = (span * 1.25 + 2) * Math.max(1, 0.8 / aspect); // back off in narrow panes (split / compare)
    const k = dist / Math.hypot(0.7, 0.9, 1);
    camera.position.set(cx + 0.7 * k, 0.9 * k, cz + 1 * k);
    controls.current?.target.set(cx, 0.5, cz);
    controls.current?.update();
    invalidate();
  }, [camera, invalidate, cx, cz, span, aspect]);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const a = anim.current;
    if (top) a.back = Math.max(MIN_POLAR, c.getPolarAngle());
    else if (a.back < 0) return;
    a.to = top ? TOP_POLAR : a.back;
    a.active = true;
    c.minPolarAngle = TOP_POLAR;
    invalidate();
  }, [top, invalidate]);
  useFrame((_, delta) => {
    const c = controls.current, a = anim.current;
    if (!c || !a.active) return;
    off.current.subVectors(camera.position, c.target);
    const s = sph.current.setFromVector3(off.current);
    const k = 1 - Math.exp(-12 * Math.min(delta, 0.1));
    s.phi += (a.to - s.phi) * k;
    if (Math.abs(a.to - s.phi) < 0.002) { s.phi = a.to; a.active = false; if (!top) c.minPolarAngle = MIN_POLAR; }
    camera.position.copy(c.target).add(off.current.setFromSpherical(s));
    c.update();
    invalidate();
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enabled={enabled}
      enableDamping={false}
      minDistance={1.5}
      maxDistance={span * 4 + 6}
      minPolarAngle={MIN_POLAR}
      maxPolarAngle={Math.PI / 2 - 0.08}
    />
  );
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
/** Keys walk mode consumes; they never reach the app's window-level shortcuts while walking. */
const CONSUMED = new Set([...Object.keys(MOVE_KEYS), 'Space', 'ShiftLeft', 'ShiftRight', 'KeyO', 'Escape']);
const EYE = 1.6, RADIUS = 22, WALK = 140, SPRINT = 280, ACCEL = 10; // m, cm, cm/s, cm/s, 1/s
const LOOK = 0.004, LOCK_LOOK = 0.0025, PITCH = (85 * Math.PI) / 180;
const GRAVITY = 9.8, JUMP_V = Math.sqrt(2 * GRAVITY * 0.5); // ~0.5 m jump
export type LockState = 'free' | 'locked' | 'released';

/**
 * Minecraft-style first-person camera. Click captures the mouse (Pointer Lock; falls back to drag-to-look), WASD/arrows
 * move relative to the view, Shift sprints, Space jumps. Saves the orbit camera on enter and restores it on exit.
 */
export function WalkRig({ start, yaw = 0, colliders, onLock }: { start: Vec2; yaw?: number; colliders: Collider[]; onLock: (s: LockState) => void }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const keys = useRef(new Set<string>());
  const st = useRef({ yaw: 0, pitch: 0, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, dir: { x: 0, y: 0 }, h: 0, vy: 0, jump: false });
  const coll = useRef(colliders);
  coll.current = colliders;
  const lockCb = useRef(onLock);
  lockCb.current = onLock;

  useEffect(() => {
    const savedPos = camera.position.clone(), savedQuat = camera.quaternion.clone(), savedOrder = camera.rotation.order;
    Object.assign(st.current, { yaw, pitch: 0, pos: { ...start }, vel: { x: 0, y: 0 }, h: 0, vy: 0, jump: false });
    camera.rotation.order = 'YXZ';
    const el = gl.domElement;
    const locked = () => document.pointerLockElement === el;
    let drag: { x: number; y: number } | null = null, unlockedAt = -1e9;
    const turn = (dx: number, dy: number, k: number) => {
      const s = st.current;
      s.yaw -= dx * k;
      s.pitch = Math.max(-PITCH, Math.min(PITCH, s.pitch - dy * k));
    };
    const down = (e: PointerEvent) => {
      if (locked()) return;
      drag = { x: e.clientX, y: e.clientY };
      // Pointer lock can be unavailable or refused (headless, iframes): drag-to-look keeps working.
      try { void Promise.resolve(el.requestPointerLock()).catch(() => {}); } catch { /* unsupported */ }
    };
    const move = (e: PointerEvent) => {
      if (locked()) { turn(e.movementX, e.movementY, LOCK_LOOK); return; }
      if (!drag) return;
      turn(e.clientX - drag.x, e.clientY - drag.y, LOOK);
      drag = { x: e.clientX, y: e.clientY };
    };
    const up = () => { drag = null; };
    const lockChange = () => {
      if (locked()) { drag = null; lockCb.current('locked'); } else { unlockedAt = performance.now(); lockCb.current('released'); }
    };
    const exit = () => useStore.getState().setUI({ walkMode: false });
    const keydown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || !CONSUMED.has(e.code)) return;
      e.stopImmediatePropagation(); // capture phase on window: the app's shortcut handler never sees it
      e.preventDefault();
      // The Esc that released pointer lock may still arrive as a keydown: only a second Esc leaves walk mode.
      // (Browsers normally swallow that Esc themselves; if it does reach us while locked, release the lock like they would.)
      if (e.code === 'Escape') { if (locked()) document.exitPointerLock(); else if (performance.now() - unlockedAt > 250) exit(); return; }
      if (e.code === 'KeyO') { exit(); return; }
      if (e.code === 'Space') { if (!e.repeat) st.current.jump = true; return; }
      keys.current.add(e.code);
    };
    const keyup = (e: KeyboardEvent) => { keys.current.delete(e.code); };
    const blur = () => keys.current.clear();
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('keyup', keyup, true);
    window.addEventListener('blur', blur);
    document.addEventListener('pointerlockchange', lockChange);
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('keyup', keyup, true);
      window.removeEventListener('blur', blur);
      document.removeEventListener('pointerlockchange', lockChange);
      if (locked()) document.exitPointerLock();
      keys.current.clear();
      camera.rotation.order = savedOrder;
      camera.position.copy(savedPos);
      camera.quaternion.copy(savedQuat);
      invalidate();
    };
  }, [camera, gl, invalidate]); // `start`/`yaw` are read once, on entering walk mode

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1), s = st.current, k = keys.current;
    camera.rotation.set(s.pitch, s.yaw, 0);
    let f = 0, r = 0;
    for (const c of k) { const m = MOVE_KEYS[c]; if (m) { f += m[0]; r += m[1]; } }
    moveVector(s.yaw, f, r, s.dir);
    const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? SPRINT : WALK;
    const a = 1 - Math.exp(-ACCEL * dt); // frame-rate independent ease towards the target velocity
    s.vel.x += (s.dir.x * speed - s.vel.x) * a;
    s.vel.y += (s.dir.y * speed - s.vel.y) * a;
    if (!f && !r && Math.hypot(s.vel.x, s.vel.y) < 1) s.vel.x = s.vel.y = 0;
    if (s.vel.x || s.vel.y) walkStep(s.pos, s.vel.x * dt, s.vel.y * dt, coll.current, RADIUS);
    if (s.jump && s.h === 0) s.vy = JUMP_V;
    s.jump = false;
    if (s.h > 0 || s.vy > 0) {
      s.h = Math.max(0, s.h + s.vy * dt);
      s.vy = s.h === 0 ? 0 : s.vy - GRAVITY * dt;
    }
    camera.position.set(s.pos.x * M, EYE + s.h, s.pos.y * M);
  });
  return null;
}
