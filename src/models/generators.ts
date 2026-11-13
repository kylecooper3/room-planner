import type { ModelPart, PartRole, StyleParams } from '../types';

/** Per-category generator: resolved style + box size (cm) -> parts roughly filling the box (fitParts makes it exact). */
export type Generator = (s: StyleParams, W: number, H: number, D: number) => ModelPart[];

type R = [number, number];
const num = (s: StyleParams, k: string) => s[k] as number;
const str = (s: StyleParams, k: string) => s[k] as string;
const flag = (s: StyleParams, k: string) => s[k] === true;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const mid = (r: R) => (r[0] + r[1]) / 2;
const len = (r: R) => r[1] - r[0];

/** Box from min/max extents. */
const bx = (role: PartRole, x: R, y: R, z: R, round = 0, color?: string): ModelPart => ({
  role, shape: 'box', size: [len(x), len(y), len(z)], position: [mid(x), mid(y), mid(z)],
  ...(round > 0 ? { round } : {}), ...(color ? { color } : {}),
});
/** Round primitive (cylinder/sphere/cone) centred at (cx, cz) with x/z diameters, spanning y. */
const rd = (role: PartRole, shape: 'cylinder' | 'sphere' | 'cone', cx: number, cz: number, dx: number, dz: number, y: R,
  rotation?: [number, number, number]): ModelPart => ({
  role, shape, size: [dx, len(y), dz], position: [cx, mid(y), cz], ...(rotation ? { rotation } : {}),
});
/** n equal spans across [a, b] with a gap between them. */
const spans = (a: number, b: number, n: number, gap: number): R[] => {
  const step = (b - a) / n;
  const g = Math.min(gap, step * 0.2);
  return Array.from({ length: n }, (_, i) => [a + i * step + g / 2, a + (i + 1) * step - g / 2] as R);
};
/** Four legs inset from the corners of [x] x [z]. */
const legs = (role: PartRole, round: boolean, x: R, z: R, lw: number, h: number): ModelPart[] => {
  const out: ModelPart[] = [];
  for (const cx of [x[0] + lw / 2, x[1] - lw / 2]) for (const cz of [z[0] + lw / 2, z[1] - lw / 2]) {
    out.push(round ? rd(role, 'cylinder', cx, cz, lw, lw, [0, h]) : bx(role, [cx - lw / 2, cx + lw / 2], [0, h], [cz - lw / 2, cz + lw / 2]));
  }
  return out;
};

const sofaLike = (s: StyleParams, W: number, H: number, D: number, cushions: number, backHeight: number): ModelPart[] => {
  const p: ModelPart[] = [];
  const rn = num(s, 'roundness');
  const legType = str(s, 'legType');
  const legH = legType === 'none' ? 0 : Math.min(num(s, 'legHeight'), H * 0.3);
  const arm = str(s, 'armStyle');
  const armW = arm === 'none' ? 0 : Math.min(W * 0.2, arm === 'slim' ? Math.max(4, W * 0.04) : Math.max(12, W * 0.1));
  const backD = D * 0.22;
  const seatTop = H * (1 - backHeight);
  const seatBase = legH + (seatTop - legH) * 0.55;
  const armTop = seatTop + (H - seatTop) * 0.45;
  const xi = W / 2 - armW;
  const r = (t: number) => rn * t * 0.45;
  p.push(bx('body', [-xi, xi], [legH, seatBase], [-D / 2, D / 2], r(Math.min(seatBase - legH, 10))));
  p.push(bx('body', [-xi, xi], [legH, H], [-D / 2, -D / 2 + backD], r(Math.min(backD, 12))));
  if (armW > 0) {
    const armRound = arm === 'rounded' ? armW * 0.3 : arm === 'slim' ? armW * 0.2 : r(armW * 0.3);
    for (const sx of [-1, 1]) {
      const x: R = sx < 0 ? [-W / 2, -xi] : [xi, W / 2];
      p.push(bx('body', x, [legH, armTop], [-D / 2, D / 2], armRound));
    }
  }
  const zSeat: R = [-D / 2 + backD, D / 2];
  for (const x of spans(-xi, xi, cushions, 1.5)) {
    p.push(bx('cushion', x, [seatBase, seatTop], zSeat, r(Math.min(seatTop - seatBase, len(x)) * 0.8)));
    const zb: R = [zSeat[0], zSeat[0] + D * 0.15];
    p.push(bx('cushion', x, [seatTop, seatTop + (H - seatTop) * 0.8], zb, r(Math.min(len(zb), len(x)) * 0.8)));
  }
  if (legH > 0) p.push(...legs('frame', legType === 'tapered', [-W / 2 + 2, W / 2 - 2].sort((a, b) => a - b) as R,
    [-D / 2 + 2, D / 2 - 2].sort((a, b) => a - b) as R, clamp(Math.min(W, D) * 0.04, 0.5, 4.5), legH));
  return p;
};

const sofa: Generator = (s, W, H, D) => sofaLike(s, W, H, D, num(s, 'cushionCount'), num(s, 'backHeight'));
const armchair: Generator = (s, W, H, D) => sofaLike(s, W, H, D, 1, 0.5);

const chair: Generator = (s, W, H, D) => {
  const p: ModelPart[] = [];
  const back = str(s, 'backStyle');
  const arms = flag(s, 'arms');
  const swivel = str(s, 'base') === 'swivel';
  const seatTop = back === 'none' ? (arms ? H * 0.8 : H) : H * num(s, 'seatHeight');
  const seatT = Math.min(seatTop * 0.12, 7);
  const seatBot = seatTop - seatT;
  const armW = arms ? Math.min(W * 0.1, 6) : 0;
  const backT = Math.min(D * 0.1, 5);
  const xs: R = [-W / 2 + armW, W / 2 - armW];
  p.push(bx('cushion', xs, [seatBot, seatTop], [-D / 2 + backT, D / 2], seatT * 0.4));
  if (back === 'solid') {
    p.push(bx('body', xs, [seatTop, H], [-D / 2, -D / 2 + backT], Math.min(backT, W) * 0.4));
  } else if (back === 'slatted') {
    const pw = Math.min(len(xs) * 0.12, 4);
    const rail = Math.min((H - seatTop) * 0.2, 8);
    const zb: R = [-D / 2, -D / 2 + backT];
    p.push(bx('frame', [xs[0], xs[0] + pw], [0, H], zb), bx('frame', [xs[1] - pw, xs[1]], [0, H], zb));
    p.push(bx('frame', [xs[0] + pw, xs[1] - pw], [H - rail, H], zb));
    for (const x of spans(xs[0] + pw, xs[1] - pw, 3, len(xs) * 0.12)) {
      p.push(bx('body', x, [seatTop, H - rail], [zb[0] + backT * 0.2, zb[1] - backT * 0.2]));
    }
  }
  if (arms) {
    const armTop = back === 'none' ? H : seatTop + (H - seatTop) * 0.35;
    const padT = Math.min(3, (armTop - seatTop) * 0.3);
    for (const x of [[-W / 2, xs[0]], [xs[1], W / 2]] as R[]) {
      p.push(bx('frame', x, [armTop - padT, armTop], [-D / 2 + backT, D / 2 - D * 0.08], padT * 0.4));
      p.push(bx('frame', [mid(x) - armW * 0.3, mid(x) + armW * 0.3], [seatBot, armTop - padT], [-D * 0.05, D * 0.15]));
    }
  }
  if (swivel) {
    const caster = Math.min(5, seatBot * 0.1);
    const armT = Math.min(3, seatBot * 0.08);
    const reach = Math.min(W, D) * 0.45;
    const t = Math.min(W, D) * 0.08;
    p.push(rd('frame', 'cylinder', 0, 0, Math.min(W, D) * 0.1, Math.min(W, D) * 0.1, [caster, seatBot]));
    p.push(bx('frame', [-reach, reach], [caster, caster + armT], [-t / 2, t / 2]));
    p.push(bx('frame', [-t / 2, t / 2], [caster, caster + armT], [-reach, reach]));
    for (const [cx, cz] of [[-reach, 0], [reach, 0], [0, -reach], [0, reach]]) {
      p.push(rd('accent', 'sphere', cx * 0.92, cz * 0.92, caster * 1.2, caster * 1.2, [0, caster]));
    }
  } else {
    const lw = clamp(Math.min(W, D) * 0.06, 0.5, 3.5);
    p.push(...legs('frame', false, [xs[0] + 1, xs[1] - 1].sort((a, b) => a - b) as R, [-D / 2 + 1, D / 2 - 1].sort((a, b) => a - b) as R, lw, seatBot));
  }
  return p;
};

const bed: Generator = (s, W, H, D) => {
  const p: ModelPart[] = [];
  const hbStyle = str(s, 'headboardStyle');
  const legH = Math.min(num(s, 'legHeight'), H * 0.3);
  const t = Math.min(D * 0.04, 8);
  const hbT = hbStyle === 'none' ? 0 : t;
  const fbT = flag(s, 'footboard') ? t : 0;
  const sleepTop = hbStyle === 'none' ? H : H * (1 - num(s, 'headboardHeight'));
  const frameTop = legH + (sleepTop - legH) * 0.4;
  const bedding = (sleepTop - frameTop) * 0.3;
  const mTop = sleepTop - bedding;
  const inset = Math.min(W * 0.02, 3);
  const z0 = -D / 2 + hbT;
  const z1 = D / 2 - fbT;
  p.push(bx('frame', [-W / 2, W / 2], [legH, frameTop], [z0, z1]));
  p.push(bx('cushion', [-W / 2 + inset, W / 2 - inset], [frameTop, mTop], [z0, z1 - inset], Math.min(mTop - frameTop, W) * 0.15));
  if (legH > 0) p.push(...legs('frame', false, [-W / 2 + 2, W / 2 - 2].sort((a, b) => a - b) as R, [-D / 2 + 2, D / 2 - 2].sort((a, b) => a - b) as R,
    clamp(Math.min(W, D) * 0.03, 0.5, 5), legH));
  const zh: R = [-D / 2, -D / 2 + hbT];
  if (hbStyle === 'panel') {
    p.push(bx('body', [-W / 2, W / 2], [0, H], zh, Math.min(hbT, W) * 0.2));
  } else if (hbStyle === 'tufted') {
    // channel-tufted: a thin back board with upholstered vertical channels in front of it
    const back: R = [zh[0], zh[0] + hbT * 0.35];
    p.push(bx('frame', [-W / 2, W / 2], [0, H], back));
    const n = Math.max(3, Math.round(W / 22));
    for (const x of spans(-W / 2, W / 2, n, Math.min(1, W * 0.01))) p.push(bx('body', x, [frameTop, H], [back[1], zh[1]], Math.min(len(x), hbT) * 0.3));
  } else if (hbStyle === 'slatted') {
    const pw = Math.min(W * 0.06, 8);
    const rail = Math.min((H - sleepTop) * 0.2, 10);
    p.push(bx('frame', [-W / 2, -W / 2 + pw], [0, H], zh), bx('frame', [W / 2 - pw, W / 2], [0, H], zh));
    p.push(bx('frame', [-W / 2 + pw, W / 2 - pw], [H - rail, H], zh));
    for (const x of spans(-W / 2 + pw, W / 2 - pw, 5, W * 0.08)) p.push(bx('frame', x, [frameTop, H - rail], [zh[0] + hbT * 0.2, zh[1] - hbT * 0.2]));
  }
  if (fbT > 0) p.push(bx('frame', [-W / 2, W / 2], [0, mTop + bedding * 0.5], [z1, D / 2], fbT * 0.4));
  const pd = Math.min((z1 - z0) * 0.18, 40);
  for (const x of spans(-W / 2 + inset * 2, W / 2 - inset * 2, num(s, 'pillowCount'), W * 0.04)) {
    p.push(bx('accent', x, [mTop, sleepTop], [z0 + inset, z0 + inset + pd], Math.min(bedding, pd, len(x)) * 0.2));
  }
  if (flag(s, 'blanket')) {
    p.push(bx('body', [-W / 2 + inset * 0.5, W / 2 - inset * 0.5], [mTop - (mTop - frameTop) * 0.6, mTop + bedding * 0.2], [z0 + (z1 - z0) * 0.3, z1 - inset * 0.5], bedding * 0.15));
  }
  return p;
};

const table: Generator = (s, W, H, D) => {
  const p: ModelPart[] = [];
  const roundTop = str(s, 'topShape') === 'round';
  const topT = clamp(num(s, 'topThickness'), 0.5, H * 0.3);
  const ly: R = [0, H - topT];
  p.push(roundTop ? rd('body', 'cylinder', 0, 0, W, D, [H - topT, H]) : bx('body', [-W / 2, W / 2], [H - topT, H], [-D / 2, D / 2], topT * 0.3));
  const m = Math.min(W, D);
  const lw = clamp(m * 0.05, 0.5, 5);
  const legType = str(s, 'legType');
  if (legType === 'four') {
    const fx = roundTop ? W * 0.3 + lw / 2 : W / 2 - m * 0.04;
    const fz = roundTop ? D * 0.3 + lw / 2 : D / 2 - m * 0.04;
    p.push(...legs('frame', roundTop, [-fx, fx], [-fz, fz], lw, len(ly)));
  } else if (legType === 'pedestal') {
    const foot = Math.min(3, H * 0.05);
    p.push(rd('frame', 'cylinder', 0, 0, m * 0.15, m * 0.15, [foot, len(ly)]));
    p.push(rd('frame', 'cylinder', 0, 0, W * 0.5, D * 0.5, [0, foot]));
  } else {
    const ex = W / 2 - W * 0.12;
    for (const cx of [-ex, ex]) {
      p.push(bx('frame', [cx - lw / 2, cx + lw / 2], [lw, len(ly)], [-D * 0.35, D * 0.35]));
      p.push(bx('frame', [cx - lw, cx + lw], [0, lw], [-D * 0.42, D * 0.42], lw * 0.3));
    }
    p.push(bx('frame', [-ex, ex], [H * 0.3, H * 0.3 + lw], [-lw / 2, lw / 2]));
  }
  return p;
};

/** Stack of drawer fronts (frame) with handles (accent) over a region of the front face at z = zf. */
const drawerFronts = (x: R, y: R, rows: number, cols: number, zf: number, fT: number, hD: number, handle: string): ModelPart[] => {
  const p: ModelPart[] = [];
  const g = Math.min(1, len(x) * 0.02, len(y) * 0.02);
  for (const ry of spans(y[0], y[1], rows, g)) for (const cx of spans(x[0], x[1], cols, g)) {
    p.push(bx('frame', cx, ry, [zf - fT, zf], Math.min(fT, len(cx), len(ry)) * 0.3));
    const fw = len(cx);
    const fh = len(ry);
    const z: R = [zf, zf + hD];
    if (handle === 'knob') {
      const k = Math.min(3.5, fw * 0.25, fh * 0.4);
      p.push(rd('accent', 'sphere', mid(cx), mid(z), k, hD, [mid(ry) - k / 2, mid(ry) + k / 2]));
    } else if (handle === 'bar') {
      if (fh > fw * 1.5) { // tall door: vertical bar near the inner edge
        const bw = Math.min(1.5, fw * 0.1);
        const hx = cols > 1 && mid(cx) < mid(x) ? cx[1] - fw * 0.12 : cx[0] + fw * 0.12;
        p.push(bx('accent', [hx - bw / 2, hx + bw / 2], [mid(ry) - fh * 0.15, mid(ry) + fh * 0.15], z, bw * 0.4));
      } else {
        const bh = Math.min(1.5, fh * 0.15);
        p.push(bx('accent', [mid(cx) - fw * 0.2, mid(cx) + fw * 0.2], [mid(ry) - bh / 2, mid(ry) + bh / 2], z, bh * 0.4));
      }
    }
  }
  return p;
};

const cabinet = (W: number, H: number, D: number, rows: number, cols: number, legHeight: number, handle: string): ModelPart[] => {
  const p: ModelPart[] = [];
  const legH = Math.min(legHeight, H * 0.3);
  const hD = handle === 'none' ? 0 : Math.min(2.5, D * 0.05);
  const fT = Math.min(2, D * 0.04);
  const topT = Math.min(3, H * 0.05);
  const zf = D / 2 - hD;
  const xi = Math.min(1, W * 0.01);
  p.push(bx('body', [-W / 2 + xi, W / 2 - xi], [legH, H - topT], [-D / 2, zf - fT]));
  p.push(bx('body', [-W / 2, W / 2], [H - topT, H], [-D / 2, zf], topT * 0.3));
  const m = Math.min(1.5, W * 0.02, (H - topT - legH) * 0.03);
  p.push(...drawerFronts([-W / 2 + xi + m, W / 2 - xi - m], [legH + m, H - topT - m], rows, cols, zf, fT, hD, handle));
  if (legH > 0) p.push(...legs('body', false, [-W / 2 + xi, W / 2 - xi], [-D / 2, zf - fT], clamp(Math.min(W, D) * 0.06, 0.5, 6), legH));
  return p;
};

const dresser: Generator = (s, W, H, D) =>
  cabinet(W, H, D, num(s, 'drawerRows'), num(s, 'drawerCols'), num(s, 'legHeight'), str(s, 'handleStyle'));
const nightstand: Generator = (s, W, H, D) =>
  cabinet(W, H, D, num(s, 'drawerCount'), 1, num(s, 'legHeight'), str(s, 'handleStyle'));

const desk: Generator = (s, W, H, D) => {
  const p: ModelPart[] = [];
  const topT = clamp(num(s, 'topThickness'), 0.5, H * 0.3);
  const under = H - topT;
  p.push(bx('body', [-W / 2, W / 2], [under, H], [-D / 2, D / 2], topT * 0.3));
  const side = str(s, 'drawerSide');
  const pedW = Math.min(W * 0.3, 45);
  const lt = clamp(Math.min(W * 0.03, 4), 0.5, 4);
  const panel = str(s, 'legType') === 'panel';
  const zi: R = [-D / 2 + Math.min(2, D * 0.05), D / 2 - Math.min(2, D * 0.05)];
  for (const sx of [-1, 1]) {
    const ped = side === 'both' || (side === 'left' && sx < 0) || (side === 'right' && sx > 0);
    const edge = (sx * W) / 2;
    if (ped) {
      const x: R = sx < 0 ? [edge, edge + pedW] : [edge - pedW, edge];
      const fT = Math.min(1.5, D * 0.03);
      p.push(bx('body', x, [0, under], [zi[0], zi[1] - fT]));
      p.push(...drawerFronts([x[0] + 1, x[1] - 1].sort((a, b) => a - b) as R, [Math.min(2, under * 0.05), under - 1], 3, 1, zi[1], fT, 0, 'none'));
      const bh = Math.min(1.5, under * 0.03);
      for (const ry of spans(Math.min(2, under * 0.05), under - 1, 3, 0)) {
        p.push(bx('accent', [mid(x) - pedW * 0.2, mid(x) + pedW * 0.2], [mid(ry) - bh / 2, mid(ry) + bh / 2], [zi[1] - 0.2, D / 2], bh * 0.4));
      }
    } else if (panel) {
      const x: R = sx < 0 ? [edge, edge + lt] : [edge - lt, edge];
      p.push(bx('frame', x, [0, under], zi));
    } else {
      const x: R = sx < 0 ? [edge + 1, edge + 1 + lt] : [edge - 1 - lt, edge - 1];
      for (const z of [[zi[0], zi[0] + lt], [zi[1] - lt, zi[1]]] as R[]) p.push(bx('frame', x, [0, under], z));
    }
  }
  if (panel) p.push(bx('frame', [-W / 2 + lt, W / 2 - lt], [under * 0.45, under], [zi[0], zi[0] + Math.min(1.5, D * 0.03)]));
  return p;
};

const shelf: Generator = (s, W, H, D) => {
  const p: ModelPart[] = [];
  const t = clamp(Math.min(W, D) * 0.06, 0.5, 3);
  const bt = flag(s, 'backPanel') ? Math.min(1, D * 0.05) : 0;
  const xi: R = [-W / 2 + t, W / 2 - t];
  if (flag(s, 'sidePanels')) {
    p.push(bx('body', [-W / 2, xi[0]], [0, H], [-D / 2, D / 2]), bx('body', [xi[1], W / 2], [0, H], [-D / 2, D / 2]));
  } else {
    for (const x of [[-W / 2, xi[0]], [xi[1], W / 2]] as R[]) for (const z of [[-D / 2, -D / 2 + t], [D / 2 - t, D / 2]] as R[]) {
      p.push(bx('frame', x, [0, H], z));
    }
  }
  if (bt > 0) p.push(bx('body', xi, [0, H], [-D / 2, -D / 2 + bt]));
  const n = num(s, 'shelfCount');
  const zs: R = [-D / 2 + bt, D / 2];
  const gap = (H - t) / (n + 1);
  for (let i = 0; i <= n + 1; i++) {
    const y = Math.min(i * gap, H - t);
    p.push(bx('body', xi, [y, y + t], zs));
    if (i <= n) { // a few books of varying height on each level
      const bw = len(xi) * 0.4;
      const bx0 = i % 2 ? xi[1] - len(xi) * 0.06 - bw : xi[0] + len(xi) * 0.06;
      spans(bx0, bx0 + bw, 4, 0).forEach((x, j) => {
        const bh = (gap - t) * [0.72, 0.62, 0.78, 0.55][(i + j) % 4];
        p.push(bx('accent', x, [y + t, y + t + bh], [zs[0] + len(zs) * 0.12, zs[1] - len(zs) * [0.15, 0.22, 0.12, 0.2][(i + j) % 4]]));
      });
    }
  }
  return p;
};

const lamp: Generator = (s, W, H, D) => {
  const p: ModelPart[] = [];
  const shade = str(s, 'shadeShape');
  const floor = str(s, 'lampType') === 'floor';
  const m = Math.min(W, D);
  let shadeH = H * (floor ? 0.25 : 0.42);
  if (shade === 'globe') shadeH = Math.min(Math.max(shadeH, m), H * 0.6);
  const sy: R = [H - shadeH, H];
  const neck = clamp(m * 0.06, 0.3, 3);
  if (floor) {
    const baseT = Math.min(3, H * 0.03);
    p.push(rd('frame', 'cylinder', 0, 0, W * 0.55, D * 0.55, [0, baseT]));
    p.push(rd('frame', 'cylinder', 0, 0, neck, neck, [baseT, H - shadeH * 0.5]));
  } else {
    p.push(rd('body', 'sphere', 0, 0, W * 0.5, D * 0.5, [0, H * 0.35]));
    p.push(rd('frame', 'cylinder', 0, 0, neck, neck, [H * 0.3, H - shadeH * 0.6]));
  }
  p.push(rd('accent', shade === 'cone' ? 'cone' : shade === 'globe' ? 'sphere' : 'cylinder', 0, 0, W, D, sy));
  return p;
};

const rug: Generator = (s, W, H, D) => {
  const round = str(s, 'shape') === 'round';
  const part = (role: PartRole, f: number, h: number) =>
    round ? rd(role, 'cylinder', 0, 0, W * f, D * f, [0, h]) : bx(role, [-W * f / 2, W * f / 2], [0, h], [-D * f / 2, D * f / 2]);
  return flag(s, 'border') ? [part('frame', 1, H * 0.8), part('body', 0.86, H)] : [part('body', 1, H)];
};

const plant: Generator = (s, W, H, D) => {
  const p: ModelPart[] = [];
  const potH = H * 0.3;
  const pot = str(s, 'potShape');
  const py: R = [0, potH];
  if (pot === 'square') p.push(bx('body', [-W * 0.27, W * 0.27], py, [-D * 0.27, D * 0.27], Math.min(W, D, potH) * 0.08));
  else if (pot === 'tapered') p.push(rd('body', 'cone', 0, 0, W * 0.55, D * 0.55, py, [Math.PI, 0, 0])); // flipped: wide rim on top
  else p.push(rd('body', 'cylinder', 0, 0, W * 0.55, D * 0.55, py));
  p.push(rd('frame', 'cylinder', 0, 0, W * 0.48, D * 0.48, [potH * 0.9, potH * 1.02]));
  const fh = H - potH;
  const f0 = potH * 0.95;
  const foliage = str(s, 'foliage');
  // Clumps placed on a golden-angle spiral: irregular enough to read as foliage, but deterministic.
  const clump = (i: number, n: number, rx: number, rz: number, y: R, size: number, role: PartRole) => {
    const a = i * 2.39996, f = Math.sqrt((i + 0.5) / n);
    p.push(rd(role, 'sphere', Math.cos(a) * rx * f, Math.sin(a) * rz * f, W * size, D * size, y));
  };
  if (foliage === 'bushy') {
    p.push(rd('cushion', 'sphere', 0, 0, W * 0.62, D * 0.62, [f0, f0 + fh * 0.7]));
    for (let i = 0; i < 9; i++) {
      const y0 = f0 + fh * (0.05 + (i % 3) * 0.12);
      clump(i, 9, W * 0.3, D * 0.3, [y0, Math.min(H, y0 + fh * 0.48)], 0.34 + (i % 2) * 0.06, i % 3 ? 'cushion' : 'accent');
    }
    p.push(rd('accent', 'sphere', 0, 0, W * 0.36, D * 0.36, [H - fh * 0.42, H]));
  } else if (foliage === 'tall') {
    const tw = Math.min(W, D) * 0.045;
    p.push(rd('frame', 'cylinder', 0, 0, tw, tw, [potH * 0.8, potH + fh * 0.75]));
    for (let i = 0; i < 11; i++) {
      const t = i / 10, cy = potH + fh * (0.3 + t * 0.6), r = 0.42 * (1 - Math.abs(t - 0.45));
      const sz = 0.22 + 0.1 * (1 - Math.abs(t - 0.45));
      clump(i, 11, W * r, D * r, [cy - fh * 0.1, Math.min(H, cy + fh * 0.1)], sz, i % 3 ? 'cushion' : 'accent');
    }
    p.push(rd('accent', 'sphere', 0, 0, W * 0.22, D * 0.22, [H - fh * 0.16, H]));
  } else {
    // upright blades fanning out of the pot
    for (let i = 0; i < 9; i++) {
      const a = i * 2.39996, f = 0.15 + (i % 3) * 0.12;
      const top = f0 + fh * (0.55 + ((i * 7) % 5) * 0.1);
      p.push(rd(i % 2 ? 'cushion' : 'accent', 'sphere', Math.cos(a) * W * f, Math.sin(a) * D * f, W * 0.16, D * 0.16, [f0, Math.min(H, top)]));
    }
    p.push(rd('cushion', 'sphere', 0, 0, W * 0.14, D * 0.14, [f0, H]));
  }
  return p;
};

const SCREEN = '#1b2030';
const tv: Generator = (s, W, H, D) => {
  const p: ModelPart[] = [];
  if (str(s, 'mount') === 'media-unit') {
    const cabH = H * 0.3;
    p.push(bx('frame', [-W / 2, W / 2], [0, cabH], [-D / 2, D / 2], Math.min(cabH, D) * 0.05));
    for (const x of spans(-W / 2 + 1, W / 2 - 1, 2, 1)) {
      p.push(bx('accent', [mid(x) - len(x) * 0.15, mid(x) + len(x) * 0.15], [cabH * 0.75, cabH * 0.75 + Math.min(1.5, cabH * 0.08)], [D / 2 - 0.1, D / 2]));
    }
    const st = Math.min(D * 0.2, 5);
    p.push(bx('frame', [-W * 0.1, W * 0.1], [cabH, cabH + H * 0.04], [-st, st]));
    const t = Math.min(D * 0.15, 5);
    p.push(bx('body', [-W * 0.42, W * 0.42], [cabH + H * 0.04, H], [-t / 2, t / 2], t * 0.2));
    p.push(bx('accent', [-W * 0.4, W * 0.4], [cabH + H * 0.06, H - H * 0.02], [t / 2 - 0.1, t / 2], 0, SCREEN));
  } else {
    const footH = Math.min(3, H * 0.05);
    for (const sx of [-1, 1]) p.push(bx('frame', [sx * W * 0.35 - W * 0.04, sx * W * 0.35 + W * 0.04], [0, footH], [-D / 2, D / 2], footH * 0.3));
    const t = Math.min(D * 0.3, 6);
    const y0 = footH + H * 0.04;
    p.push(bx('body', [-W / 2, W / 2], [y0, H], [-t / 2, t / 2], t * 0.2));
    p.push(bx('accent', [-W / 2 + W * 0.02, W / 2 - W * 0.02], [y0 + H * 0.025, H - H * 0.025], [t / 2 - 0.1, t / 2], 0, SCREEN));
  }
  return p;
};

const box: Generator = (s, W, H, D) => [bx('body', [-W / 2, W / 2], [0, H], [-D / 2, D / 2], num(s, 'roundness') * Math.min(W, H, D) * 0.5)];

export const GENERATORS = { sofa, armchair, chair, bed, table, desk, dresser, shelf, nightstand, lamp, rug, plant, tv, box };
