#!/usr/bin/env node
/* ================================================================
   gen-commercial.mjs — procedural isometric commercial building
   SVG generator (draft asset pipeline).

   WHY THIS EXISTS
   The live renderer (js/renderer.js: drawCom/box/faceWindows) already
   draws commercial buildings procedurally on <canvas>, and a one-time
   dev tool (js/export_assets.js) bakes those canvas draws into the
   static SVGs shipped in assets/buildings/ (commercial_{low,mid,high}
   _{a,b,c}.svg) — that's the "old approach": exactly 3 hand-authored
   variants per density tier, driven by a k=seed%3 switch.

   This script is a standalone, dependency-free generator that produces
   a much larger, more varied batch of commercial towers directly as
   SVG text — no browser/canvas required. It follows the "new approach"
   sketch (assets/buildings/commercial_low_c.svg): build one wall
   rectangle, mirror it into the two isometric side faces, cap it with
   a roof, and stack 2-4 of those blocks into a tower. Ground-floor
   layout (single tower / twin / group of three) is generated first,
   then each footprint gets its own randomized tower.

   TRANSFORM TECHNIQUE
   Each wall is a plain axis-aligned <rect> (with its window <line>s drawn
   in the same local, unskewed coordinate space) wrapped in a <g> with a
   native SVG `transform="translate(...) skewY(...)"`. skewY(±26.565)
   is exactly atan(HH/HW) for the game's 2:1 iso cube, so a local vertical
   line stays vertical after the shear and a local horizontal line becomes
   the correctly-slanted "roofline-parallel" band — the same trick as the
   commercial_low_c.svg sketch. The roof/shadow caps use the equivalent
   `matrix(1, HH/HW, -1, HH/HW, e, f)` on a rect placed directly in (u,v)
   footprint space, which is just bp(u,v,h) written as an affine matrix.
   Unlike the sketch, this uses the SVG `transform` attribute (numeric
   degrees) rather than CSS `style="transform"` + `transform-origin`, so
   there's no origin/percentage ambiguity across renderers — translate
   and skew compose directly around the same anchor point (see faceGeom()).

   Geometry matches the live renderer's convention exactly (see
   js/renderer.js: bp(), box(), PAL.C, shade()):
     - 2:1 isometric cube: half-width 64px, half-height 32px
     - canvas width fixed at 128 (= one tile width), height dynamic
     - u,v are fractional footprint coordinates in [0,1] on the tile

   USAGE
     node gen-commercial.mjs [--count=6] [--seed=1] [--out=assets/drafts/commercial]

   OUTPUT
     assets/drafts/commercial/commercial_{low,mid,high}_{01..N}.svg
     assets/drafts/commercial/index.html   (contact sheet for review)
   ================================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const COUNT_PER_DENSITY = parseInt(args.count || '6', 10);
const BASE_SEED = parseInt(args.seed || '1', 10);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(args.out || path.join(__dirname, 'assets/drafts/commercial'));

// ---------------------------------------------------------------
// seeded RNG (mulberry32) — deterministic per building for reproducible drafts
// ---------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
function weightedIndex(rng, weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
  return weights.length - 1;
}

// ---------------------------------------------------------------
// isometric projection — matches js/renderer.js bp()/box() exactly
// ---------------------------------------------------------------
const HW = 64, HH = 32;           // half tile width/height, 2:1 ratio
const SX = 64;                    // canvas horizontal centre (canvas is always 128 wide = 1 tile)
const SKEW_DEG = Math.atan(HH / HW) * 180 / Math.PI;   // 26.565... for a 2:1 cube
function bp(groundY, u, v, h) {
  return [SX + (u - v) * HW, groundY + (u + v) * HH - h];
}

// ---------------------------------------------------------------
// color helpers (HSL authoring, matches the palette family already used
// for commercial buildings — PAL.C in renderer.js: base ~H249 S35 L25,
// roof lighter/desaturated). Per this generator's convention the RIGHT
// wall is the shadow side (darker) and the LEFT wall reads as the base/lit
// side — flipped from PAL.C's right/left, matching the requested light
// direction for this batch.
// ---------------------------------------------------------------
function hslToRgbStr(h, s, l) {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 1); l = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const R = Math.round((r + m) * 255), G = Math.round((g + m) * 255), B = Math.round((b + m) * 255);
  return `rgb(${R},${G},${B})`;
}

// ---------------------------------------------------------------
// per-density tuning — footprint scale, block count/height, decoration odds.
// canvas height buckets match the existing export pipeline (js/export_assets.js
// BUILDING = { low:128, mid:224, high:288 }) as a *floor*; actual height is
// computed from the generated silhouette so nothing clips, then rounded up
// to at least the matching bucket for scale consistency with res/ind sprites.
// ---------------------------------------------------------------
const DENSITY_CFG = {
  low: {
    minH: 128,
    countWeights: [0.62, 0.30, 0.08],       // 1 / 2 / 3 towers on the lot
    blockCountWeights: [0.55, 0.40, 0.05],  // 1 / 2 / 3 stacked blocks per tower
    blockH: [26, 44],
    setbackChance: 0.35,
    antennaChance: 0.10,
    utilityBoxChance: 0.08,
    footprintPad: 0.18,                     // single-tower footprint inset from tile edge
  },
  mid: {
    minH: 224,
    countWeights: [0.42, 0.40, 0.18],
    blockCountWeights: [0.15, 0.55, 0.30],
    blockH: [36, 58],
    setbackChance: 0.45,
    antennaChance: 0.35,
    utilityBoxChance: 0.18,
    footprintPad: 0.15,
  },
  high: {
    minH: 288,
    countWeights: [0.34, 0.36, 0.20, 0.10],
    blockCountWeights: [0.05, 0.30, 0.45, 0.20],
    blockH: [42, 80],
    setbackChance: 0.55,
    antennaChance: 0.65,
    utilityBoxChance: 0.28,
    footprintPad: 0.10,
  },
};

// ---------------------------------------------------------------
// ground pattern: recursively split the buildable region of the tile
// into `n` footprints (1 = single centred tower, 2 = side-by-side twin,
// 3 = one large + two small ("group of three"), 4 = loose 2x2 cluster).
// Alternates split axis so sub-regions read as plausible building lots
// rather than uniform stripes.
// ---------------------------------------------------------------
function splitRegion(rng, region, n, axis) {
  if (n <= 1) return [region];
  const [u0, v0, u1, v1] = region;
  axis = axis || (rng() < 0.5 ? 'u' : 'v');
  const n1 = Math.ceil(n / 2), n2 = n - n1;
  const f = clamp((n1 / n) + (rng() * 0.24 - 0.12), 0.3, 0.7);
  const gap = 0.035 + rng() * 0.045;
  const nextAxis = axis === 'u' ? 'v' : 'u';
  if (axis === 'u') {
    const mid = u0 + (u1 - u0) * f;
    const a = [u0, v0, mid - gap / 2, v1];
    const b = [mid + gap / 2, v0, u1, v1];
    return [...splitRegion(rng, a, n1, nextAxis), ...splitRegion(rng, b, n2, nextAxis)];
  } else {
    const mid = v0 + (v1 - v0) * f;
    const a = [u0, v0, u1, mid - gap / 2];
    const b = [u0, mid + gap / 2, u1, v1];
    return [...splitRegion(rng, a, n1, nextAxis), ...splitRegion(rng, b, n2, nextAxis)];
  }
}

function insetRegion([u0, v0, u1, v1], amt) {
  const w = u1 - u0, h = v1 - v0;
  const dx = Math.min(amt, w * 0.20), dy = Math.min(amt, h * 0.20);
  return [u0 + dx, v0 + dy, u1 - dx, v1 - dy];
}

// ---------------------------------------------------------------
// wall face geometry: every box face is a rectangle sheared by exactly
// SKEW_DEG (proof: bp()'s x term never depends on h, so both the outer
// and seam edges of a face are perfectly vertical screen lines of length
// `height`, and the top/bottom edges always have slope -HH/HW). That
// means each face can be built as translate(anchor) + skewY(±SKEW_DEG)
// applied to a plain local rect, with NO transform-origin needed — the
// anchor is simply whichever top corner has the smaller on-screen x, so
// the local rect's width comes out positive.
//   side 'right': anchor = seam-top corner bp(u1,v1,top); skewY(-SKEW_DEG)
//   side 'left':  anchor = outer-top corner bp(u0,v1,top); skewY(+SKEW_DEG)
// ---------------------------------------------------------------
function faceGeom(groundY, u0, v0, u1, v1, base, height, side) {
  const top = base + height;
  if (side === 'right') {
    return {
      anchor: bp(groundY, u1, v1, top),
      skewDeg: -SKEW_DEG,
      width: HW * (v1 - v0),
      height,
      corners: [bp(groundY, u1, v0, base), bp(groundY, u1, v1, base),
                bp(groundY, u1, v1, top), bp(groundY, u1, v0, top)],
    };
  }
  return {
    anchor: bp(groundY, u0, v1, top),
    skewDeg: SKEW_DEG,
    width: HW * (u1 - u0),
    height,
    corners: [bp(groundY, u0, v1, base), bp(groundY, u1, v1, base),
              bp(groundY, u1, v1, top), bp(groundY, u0, v1, top)],
  };
}

// ---------------------------------------------------------------
// window line generation, in the wall's own LOCAL (unskewed) coordinate
// space: 6-8 lines equally distributed across the full wall, then a
// random amount (0-3) trimmed off each side independently — so the band
// is grid-aligned but its ends are irregular (reads like a row of window
// bays where the corner bays are sometimes blank). Orientation vertical/
// horizontal per wall. Every line on a given wall shares one style
// (colour, weight, dashed-vs-solid) — variation happens wall-to-wall and
// building-to-building, not within a single face. Lines are inset from
// the wall's own top/bottom (or left/right) edges so they read as a
// recessed window band rather than touching the floor/roof seam.
// ---------------------------------------------------------------
function genFaceWindowsLocal(rng, w, h, winHue) {
  const n = 6 + Math.floor(rng() * 3);        // 6-8 equally spaced slots
  const horiz = rng() < 0.5;
  const inset = 0.14 + rng() * 0.10;          // margin pulled in from each line's own endpoints

  let cutLeft = Math.floor(rng() * 4), cutRight = Math.floor(rng() * 4);
  if (n - cutLeft - cutRight < 1) cutLeft = Math.max(0, cutLeft - 1);
  if (n - cutLeft - cutRight < 1) cutRight = Math.max(0, cutRight - 1);

  const dashed = rng() < 0.6;
  const hue = winHue + (rng() * 2 - 1) * 10;
  const light = 0.70 + rng() * 0.18;
  const sat = 0.55 + rng() * 0.35;
  const stroke = hslToRgbStr(hue, sat, light);
  const strokeW = +(1.1 + rng() * 2.1).toFixed(2);
  const dash = dashed ? `${(2.5 + rng() * 6).toFixed(2)},${(1.8 + rng() * 4).toFixed(2)}` : null;

  const lines = [];
  for (let i = cutLeft; i < n - cutRight; i++) {
    const p = (i + 0.5) / n;
    if (horiz) lines.push([inset * w, p * h, (1 - inset) * w, p * h]);
    else lines.push([p * w, inset * h, p * w, (1 - inset) * h]);
  }
  return { lines, stroke, strokeW, dash };
}

// ---------------------------------------------------------------
// build one tower (2-4 stacked blocks) on a given footprint region.
// Returns a list of blocks (bottom-to-top) with resolved face geometry,
// colours, and windows, ready to render.
// ---------------------------------------------------------------
function genTower(rng, region, cfg, groundY, hueBase, satBase, lightBase, winHue) {
  const blockCount = 1 + weightedIndex(rng, cfg.blockCountWeights);
  let cur = region.slice();
  let base = 0;
  const blocks = [];
  for (let i = 0; i < blockCount; i++) {
    if (i > 0 && rng() < cfg.setbackChance) {
      const next = insetRegion(cur, 0.04 + rng() * 0.09);
      // guard against runaway tapering across 3-4 stacked setbacks
      if ((next[2] - next[0]) > 0.11 && (next[3] - next[1]) > 0.11) cur = next;
    }
    const h = lerp(cfg.blockH[0], cfg.blockH[1], rng());
    // tiny per-block hue/lightness drift so stacked blocks aren't flat-identical
    const drift = (rng() * 2 - 1) * 4;
    // right = shadow side (darker), left = lit/base side — flipped from PAL.C
    const right = hslToRgbStr(hueBase + drift, satBase, lightBase * 0.55);
    const left = hslToRgbStr(hueBase + drift, satBase, lightBase);
    const roof = hslToRgbStr(hueBase + drift, satBase * 0.85, clamp(lightBase + 0.13 + rng() * 0.06, 0, 0.9));
    const [u0, v0, u1, v1] = cur;
    const rightFace = faceGeom(groundY, u0, v0, u1, v1, base, h, 'right');
    const leftFace = faceGeom(groundY, u0, v0, u1, v1, base, h, 'left');
    blocks.push({
      region: cur, base, height: h, right, left, roof,
      rightFace, leftFace,
      windowsRight: genFaceWindowsLocal(rng, rightFace.width, rightFace.height, winHue),
      windowsLeft: genFaceWindowsLocal(rng, leftFace.width, leftFace.height, winHue),
    });
    base += h;
  }
  return blocks;
}

// ---------------------------------------------------------------
// SVG element accumulator — collect everything against a provisional
// groundY, then measure the bbox (using each element's absolute corner
// points) and shift vertically so the final canvas has no clipping and a
// small margin. Horizontal placement is never touched (SX=64 must stay
// tile-centred). Walls/roof/shadow carry their own transform parameters
// so the final serialization pass can emit translate/skewY/matrix directly.
// ---------------------------------------------------------------
function svgFor(density, seed) {
  const cfg = DENSITY_CFG[density];
  const rng = mulberry32(seed);
  const GROUND_Y = 600; // arbitrary provisional reference, removed by the final shift

  // one shared hue family per building for cohesion across its towers — stays
  // within the established commercial "purple" family (PAL.C ~ H249) rather
  // than drifting into blue/teal, which would read as a different zone colour.
  const hueBase = 250 + (rng() * 2 - 1) * 14;
  const satBase = 0.30 + rng() * 0.22;
  const lightBase = 0.21 + rng() * 0.09;
  const winHue = hueBase + 10 + (rng() * 2 - 1) * 8;

  const count = 1 + weightedIndex(rng, cfg.countWeights);
  const full = [cfg.footprintPad, cfg.footprintPad, 1 - cfg.footprintPad, 1 - cfg.footprintPad];
  const footprints = splitRegion(rng, full, count, rng() < 0.5 ? 'u' : 'v')
    .sort((a, b) => (a[0] + a[1]) - (b[0] + b[1])); // back-to-front paint order

  const els = [];
  const pushWall = (face, fill, win) => els.push({ tag: 'wall', face, fill, win });
  const pushRoofRect = (u0, v0, u1, v1, top, fill, corners) => els.push({ tag: 'roof', u0, v0, u1, v1, top, fill, corners });
  const pushLine = (a, b, stroke, width, dash) => els.push({ tag: 'line', a, b, stroke, width, dash });
  const pushCircle = (c, r, fill) => els.push({ tag: 'circle', c, r, fill });

  for (const region of footprints) {
    // drop shadow: footprint expanded slightly, offset down-right, h=0
    const [su0, sv0, su1, sv1] = insetRegion(region, -0.045).map(v => clamp(v, 0, 1));
    const sCorners = [bp(GROUND_Y, su0, sv0, 0), bp(GROUND_Y, su1, sv0, 0),
                       bp(GROUND_Y, su1, sv1, 0), bp(GROUND_Y, su0, sv1, 0)]
      .map(p => [p[0] + 2.5, p[1] + 2.5]);
    els.push({ tag: 'roof', u0: su0, v0: sv0, u1: su1, v1: sv1, top: 0, fill: 'rgba(0,0,0,0.20)', corners: sCorners, offset: [2.5, 2.5] });

    const blocks = genTower(rng, region, cfg, GROUND_Y, hueBase, satBase, lightBase, winHue);
    for (const b of blocks) {
      pushWall(b.rightFace, b.right, b.windowsRight);
      pushWall(b.leftFace, b.left, b.windowsLeft);
      const [u0, v0, u1, v1] = b.region, top = b.base + b.height;
      pushRoofRect(u0, v0, u1, v1, top, b.roof,
        [bp(GROUND_Y, u0, v0, top), bp(GROUND_Y, u1, v0, top), bp(GROUND_Y, u1, v1, top), bp(GROUND_Y, u0, v1, top)]);
    }

    // decorations on the topmost block of this tower
    const top = blocks[blocks.length - 1];
    const [u0, v0, u1, v1] = top.region;
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    const topH = top.base + top.height;
    if (rng() < cfg.antennaChance) {
      const antH = 10 + rng() * 16;
      const p0 = bp(GROUND_Y, cu, cv, topH), p1 = bp(GROUND_Y, cu, cv, topH + antH);
      pushLine(p0, p1, '#bbb', 1.4, null);
      pushCircle(p1, 1.7, rng() < 0.5 ? '#ff5b3b' : '#fff');
    }
    if (rng() < cfg.utilityBoxChance && (u1 - u0) > 0.22 && (v1 - v0) > 0.22) {
      const bs = 0.05 + rng() * 0.03;
      const bu = clamp(cu + (rng() * 2 - 1) * 0.15, u0 + bs, u1 - bs);
      const bv = clamp(cv + (rng() * 2 - 1) * 0.15, v0 + bs, v1 - bs);
      const bh = 6 + rng() * 8;
      const ubu0 = bu - bs, ubv0 = bv - bs, ubu1 = bu + bs, ubv1 = bv + bs;
      const uRight = faceGeom(GROUND_Y, ubu0, ubv0, ubu1, ubv1, topH, bh, 'right');
      const uLeft = faceGeom(GROUND_Y, ubu0, ubv0, ubu1, ubv1, topH, bh, 'left');
      pushWall(uRight, hslToRgbStr(hueBase, satBase * 0.6, lightBase * 0.45), null);
      pushWall(uLeft, hslToRgbStr(hueBase, satBase * 0.6, lightBase * 0.7), null);
      pushRoofRect(ubu0, ubv0, ubu1, ubv1, topH + bh, hslToRgbStr(hueBase, satBase * 0.6, lightBase * 0.9),
        [bp(GROUND_Y, ubu0, ubv0, topH + bh), bp(GROUND_Y, ubu1, ubv0, topH + bh),
         bp(GROUND_Y, ubu1, ubv1, topH + bh), bp(GROUND_Y, ubu0, ubv1, topH + bh)]);
    }
  }

  // ---- measure + shift vertically so nothing clips, small top/bottom pad
  let minY = Infinity, maxY = -Infinity;
  for (const el of els) {
    const pts = el.tag === 'circle' ? [[el.c[0], el.c[1] - el.r], [el.c[0], el.c[1] + el.r]]
      : el.tag === 'line' ? [el.a, el.b]
      : el.tag === 'wall' ? el.face.corners : el.corners;
    for (const [, y] of pts) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  const PAD_TOP = 6, PAD_BOTTOM = 10;
  const shift = PAD_TOP - minY;
  let height = Math.ceil(maxY - minY + PAD_TOP + PAD_BOTTOM);
  height = Math.max(height, cfg.minH);
  // if we padded up to minH, keep content bottom-aligned (extra room goes on top)
  const bottomY = maxY + shift; // where content bottom lands after the base shift
  const extraTop = height - bottomY - PAD_BOTTOM;
  const totalShift = shift + Math.max(0, extraTop);

  const parts = [];
  for (const el of els) {
    if (el.tag === 'wall') {
      const f = el.face;
      const ax = f.anchor[0], ay = f.anchor[1] + totalShift;
      const linesSvg = el.win ? el.win.lines.map(([x1, y1, x2, y2]) =>
        `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${el.win.stroke}" stroke-width="${el.win.strokeW}" stroke-linecap="butt"${el.win.dash ? ` stroke-dasharray="${el.win.dash}"` : ''}/>`
      ).join('') : '';
      parts.push(`<g transform="translate(${ax.toFixed(2)},${ay.toFixed(2)}) skewY(${f.skewDeg.toFixed(3)})"><rect x="0" y="0" width="${f.width.toFixed(2)}" height="${f.height.toFixed(2)}" fill="${el.fill}"/>${linesSvg}</g>`);
    } else if (el.tag === 'roof') {
      // matrix(1, HH/HW, -1, HH/HW, e, f) is bp(u,v,h) written as an affine
      // matrix; the local rect sits directly in (u,v) space scaled by HW.
      const e = SX, f = GROUND_Y - el.top + totalShift + (el.offset ? 0 : 0);
      const ox = el.offset ? el.offset[0] : 0, oy = el.offset ? el.offset[1] : 0;
      const m = `matrix(1,${(HH / HW).toFixed(4)},-1,${(HH / HW).toFixed(4)},${(e + ox).toFixed(2)},${(f + oy).toFixed(2)})`;
      parts.push(`<rect x="${(HW * el.u0).toFixed(2)}" y="${(HW * el.v0).toFixed(2)}" width="${(HW * (el.u1 - el.u0)).toFixed(2)}" height="${(HW * (el.v1 - el.v0)).toFixed(2)}" fill="${el.fill}" transform="${m}"/>`);
    } else if (el.tag === 'line') {
      const x1 = el.a[0], y1 = el.a[1] + totalShift, x2 = el.b[0], y2 = el.b[1] + totalShift;
      const dashAttr = el.dash ? ` stroke-dasharray="${el.dash}"` : '';
      parts.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${el.stroke}" stroke-width="${el.width}" stroke-linecap="round"${dashAttr}/>`);
    } else if (el.tag === 'circle') {
      const cx = el.c[0], cy = el.c[1] + totalShift;
      parts.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${el.r}" fill="${el.fill}"/>`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="128" height="${height}"><g>${parts.join('')}</g></svg>`;
}

// ---------------------------------------------------------------
// batch generate + contact sheet
// ---------------------------------------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true });
const manifest = [];
let seed = BASE_SEED;
for (const density of ['low', 'mid', 'high']) {
  for (let i = 1; i <= COUNT_PER_DENSITY; i++) {
    const name = `commercial_${density}_${String(i).padStart(2, '0')}.svg`;
    const svg = svgFor(density, seed++);
    fs.writeFileSync(path.join(OUT_DIR, name), svg, 'utf8');
    manifest.push({ density, name });
  }
}

const rows = ['low', 'mid', 'high'].map(density => {
  const cells = manifest.filter(m => m.density === density)
    .map(m => `<div class="cell"><img src="${m.name}"><div class="lbl">${m.name}</div></div>`)
    .join('');
  return `<section><h2>${density}</h2><div class="row">${cells}</div></section>`;
}).join('\n');

const html = `<!doctype html><html><head><meta charset="utf-8"><title>commercial drafts</title>
<style>
  body{background:#15131f;color:#ddd;font:13px/1.4 -apple-system,sans-serif;padding:24px;}
  h1{color:#cda9ff} h2{color:#9a93c0;text-transform:capitalize;border-bottom:1px solid #332e4d;padding-bottom:4px}
  .row{display:flex;flex-wrap:wrap;gap:18px;margin-bottom:32px}
  .cell{background:repeating-conic-gradient(#241f38 0% 25%, #1c1830 0% 50%) 50% / 20px 20px;
        border:1px solid #332e4d;border-radius:6px;padding:10px;text-align:center}
  .cell img{display:block;height:220px;width:auto;image-rendering:crisp-edges}
  .lbl{color:#8a83ac;font-size:11px;margin-top:6px}
</style></head><body>
<h1>Commercial building drafts</h1>
<p>Generated by scripts/gen-assets/gen-commercial.mjs — ${manifest.length} variants (${COUNT_PER_DENSITY} per density), seed ${BASE_SEED}.</p>
${rows}
</body></html>`;
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html, 'utf8');

console.log(`Wrote ${manifest.length} SVGs + index.html to ${OUT_DIR}`);
