/* ================================================================
   theme-engine.mjs — shared core for the procedural isometric building
   generators (gen-commercial.mjs, gen-residential.mjs, gen-industrial.mjs,
   gen-scenario.mjs). Extracted so every zone/scenario shares the exact
   same iso math, ground-pattern/tower-stack algorithm, and transform-based
   wall/roof rendering — only the *theme* (palette, window style, rooftop
   decorations, proportions) differs per script.

   TRANSFORM TECHNIQUE
   Each wall is a plain axis-aligned <rect> (with its window <line>s drawn
   in the same local, unskewed coordinate space) wrapped in a <g> with a
   native SVG `transform="translate(...) skewY(...)"`. skewY(±26.565) is
   exactly atan(HH/HW) for the game's 2:1 iso cube, so a local vertical
   line stays vertical after the shear and a local horizontal line becomes
   the correctly-slanted "roofline-parallel" band (see assets/buildings/
   commercial_low_c.svg for the original sketch of this trick). The roof/
   shadow caps use the equivalent `matrix(1, HH/HW, -1, HH/HW, e, f)` on a
   rect placed directly in (u,v) footprint space — bp(u,v,h) written as an
   affine matrix. This uses the SVG `transform` attribute (numeric degrees)
   rather than CSS `style="transform"` + `transform-origin`, so translate
   and skew compose directly with no origin/percentage ambiguity.

   Geometry matches the live renderer's convention (js/renderer.js: bp(),
   box(), PAL, shade()): 2:1 isometric cube, half-width 64 / half-height
   32, canvas fixed at 128px wide (= one tile), height dynamic per silhouette.
   ================================================================ */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------
// seeded RNG (mulberry32) — deterministic per building for reproducible drafts
// ---------------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export function weightedIndex(rng, weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
  return weights.length - 1;
}

// ---------------------------------------------------------------
// isometric projection
// ---------------------------------------------------------------
export const HW = 64, HH = 32;
export const SX = 64;
export const SKEW_DEG = Math.atan(HH / HW) * 180 / Math.PI; // 26.565...
export function bp(groundY, u, v, h) {
  return [SX + (u - v) * HW, groundY + (u + v) * HH - h];
}

// ---------------------------------------------------------------
// color helpers
// ---------------------------------------------------------------
export function hslToRgbStr(h, s, l) {
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
// ground pattern: recursively split the buildable region of the tile into
// `n` footprints (1 = single centred volume, 2 = twin, 3 = one large + two
// small, 4 = loose 2x2 cluster). Alternates split axis.
// ---------------------------------------------------------------
export function splitRegion(rng, region, n, axis) {
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

export function insetRegion([u0, v0, u1, v1], amt) {
  const w = u1 - u0, h = v1 - v0;
  const dx = Math.min(amt, w * 0.20), dy = Math.min(amt, h * 0.20);
  return [u0 + dx, v0 + dy, u1 - dx, v1 - dy];
}

// ---------------------------------------------------------------
// wall face geometry (see module header for the proof): translate(anchor)
// + skewY(±SKEW_DEG) applied to a plain local rect, no transform-origin
// needed. 'right' anchors at the seam-top corner, 'left' at the outer-top
// corner (whichever has the smaller on-screen x, so local width > 0).
// ---------------------------------------------------------------
export function faceGeom(groundY, u0, v0, u1, v1, base, height, side) {
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
// space: n lines equally distributed across the full wall, then a random
// amount trimmed off each side independently (grid-aligned but irregular
// ends). Orientation vertical/horizontal. Every line on a wall shares one
// style — variation happens wall-to-wall and building-to-building.
// `style` lets a theme override the defaults (see gen-scenario.mjs's
// shipping-centre "container stripe" look: fewer, thicker, mostly-solid).
// ---------------------------------------------------------------
export function genFaceWindowsLocal(rng, w, h, winHue, style = {}) {
  const {
    nMin = 6, nMax = 8, dashChance = 0.6, insetMin = 0.14, insetMax = 0.24,
    winSatMin = 0.55, winSatMax = 0.90, winLightMin = 0.70, winLightMax = 0.88,
    hueJitter = 10, strokeWMin = 1.1, strokeWMax = 3.2, maxCut = 3,
  } = style;
  const n = nMin + Math.floor(rng() * (nMax - nMin + 1));
  const horiz = rng() < 0.5;
  const inset = insetMin + rng() * (insetMax - insetMin);

  let cutLeft = Math.floor(rng() * (maxCut + 1)), cutRight = Math.floor(rng() * (maxCut + 1));
  if (n - cutLeft - cutRight < 1) cutLeft = Math.max(0, cutLeft - 1);
  if (n - cutLeft - cutRight < 1) cutRight = Math.max(0, cutRight - 1);

  const dashed = rng() < dashChance;
  const hue = winHue + (rng() * 2 - 1) * hueJitter;
  const light = winLightMin + rng() * (winLightMax - winLightMin);
  const sat = winSatMin + rng() * (winSatMax - winSatMin);
  const stroke = hslToRgbStr(hue, sat, light);
  const strokeW = +(strokeWMin + rng() * (strokeWMax - strokeWMin)).toFixed(2);
  const dash = dashed ? `${(2.5 + rng() * 6).toFixed(2)},${(1.8 + rng() * 4).toFixed(2)}` : null;

  const lines = [];
  for (let i = cutLeft; i < n - cutRight; i++) {
    const p = (i + 0.5) / n;
    if (horiz) lines.push([inset * w, p * h, (1 - inset) * w, p * h]);
    else lines.push([p * w, inset * h, p * w, (1 - inset) * h]);
  }
  return { lines, stroke, strokeW, dash };
}

// default block colouring: right = shadow side (darker), left = lit/base
// side, roof = lighter. Themes may override via theme.blockColors().
export function defaultBlockColors(rng, hueBase, satBase, lightBase, drift) {
  return {
    right: hslToRgbStr(hueBase + drift, satBase, lightBase * 0.55),
    left: hslToRgbStr(hueBase + drift, satBase, lightBase),
    roof: hslToRgbStr(hueBase + drift, satBase * 0.85, clamp(lightBase + 0.13, 0, 0.9)),
  };
}

// ---------------------------------------------------------------
// build one tower (stacked blocks) on a footprint region, using theme
// hooks for colour + window style.
// ---------------------------------------------------------------
function genTower(rng, region, cfg, theme, groundY, baseColors) {
  const blockCount = 1 + weightedIndex(rng, cfg.blockCountWeights);
  let cur = region.slice();
  let base = 0;
  const blocks = [];
  for (let i = 0; i < blockCount; i++) {
    if (i > 0 && rng() < cfg.setbackChance) {
      const next = insetRegion(cur, 0.04 + rng() * 0.09);
      if ((next[2] - next[0]) > 0.11 && (next[3] - next[1]) > 0.11) cur = next;
    }
    const h = lerp(cfg.blockH[0], cfg.blockH[1], rng());
    const drift = (rng() * 2 - 1) * 4;
    const colorFn = theme.blockColors || defaultBlockColors;
    const { right, left, roof } = colorFn(rng, baseColors.hueBase, baseColors.satBase, baseColors.lightBase, drift);
    const [u0, v0, u1, v1] = cur;
    const rightFace = faceGeom(groundY, u0, v0, u1, v1, base, h, 'right');
    const leftFace = faceGeom(groundY, u0, v0, u1, v1, base, h, 'left');
    const winStyle = theme.windowStyle ? theme.windowStyle(rng, baseColors) : {};
    blocks.push({
      region: cur, base, height: h, right, left, roof, rightFace, leftFace,
      windowsRight: genFaceWindowsLocal(rng, rightFace.width, rightFace.height, baseColors.winHue, winStyle),
      windowsLeft: genFaceWindowsLocal(rng, leftFace.width, leftFace.height, baseColors.winHue, winStyle),
    });
    base += h;
  }
  return blocks;
}

// ---------------------------------------------------------------
// serialize helpers shared by the els->SVG pass
// ---------------------------------------------------------------
function serializeEls(els, totalShift, height) {
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
      const e = SX + (el.offset ? el.offset[0] : 0);
      const f = (el.groundY - el.top) + totalShift + (el.offset ? el.offset[1] : 0);
      const m = `matrix(1,${(HH / HW).toFixed(4)},-1,${(HH / HW).toFixed(4)},${e.toFixed(2)},${f.toFixed(2)})`;
      parts.push(`<rect x="${(HW * el.u0).toFixed(2)}" y="${(HW * el.v0).toFixed(2)}" width="${(HW * (el.u1 - el.u0)).toFixed(2)}" height="${(HW * (el.v1 - el.v0)).toFixed(2)}" fill="${el.fill}" transform="${m}"/>`);
    } else if (el.tag === 'line') {
      const x1 = el.a[0], y1 = el.a[1] + totalShift, x2 = el.b[0], y2 = el.b[1] + totalShift;
      const dashAttr = el.dash ? ` stroke-dasharray="${el.dash}"` : '';
      parts.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${el.stroke}" stroke-width="${el.width}" stroke-linecap="${el.cap || 'round'}"${dashAttr}/>`);
    } else if (el.tag === 'circle') {
      const cx = el.c[0], cy = el.c[1] + totalShift;
      parts.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${el.r}" fill="${el.fill}"${el.opacity != null ? ` fill-opacity="${el.opacity}"` : ''}/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="128" height="${height}"><g>${parts.join('')}</g></svg>`;
}

// ---------------------------------------------------------------
// build one full building SVG for a given theme + tier config + seed.
// theme = {
//   colors(rng) => {hueBase,satBase,lightBase,winHue}
//   blockColors(rng,hueBase,satBase,lightBase,drift) => {right,left,roof}  [optional]
//   windowStyle(rng, baseColors) => {...genFaceWindowsLocal style overrides} [optional]
//   decorate(rng, api, info)  [optional] — called once per tower on its topmost block
// }
// ---------------------------------------------------------------
export function generateBuildingSVG(theme, cfg, seed) {
  const rng = mulberry32(seed);
  const GROUND_Y = 600;

  const baseColors = theme.colors(rng);
  const count = 1 + weightedIndex(rng, cfg.countWeights);
  const full = [cfg.footprintPad, cfg.footprintPad, 1 - cfg.footprintPad, 1 - cfg.footprintPad];
  const footprints = splitRegion(rng, full, count, rng() < 0.5 ? 'u' : 'v')
    .sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));

  const els = [];
  const api = {
    pushLine: (a, b, stroke, width, dash, cap) => els.push({ tag: 'line', a, b, stroke, width, dash, cap }),
    pushCircle: (c, r, fill, opacity) => els.push({ tag: 'circle', c, r, fill, opacity }),
    // flat quad directly on the ground plane (or lifted by `h`) — no walls,
    // just the matrix-projected top face. Useful for ponds, plazas, helipads,
    // or any other flat decoration that isn't a stacked box.
    pushFlatPatch: (u0, v0, u1, v1, fill, h = 0) => els.push({
      tag: 'roof', u0, v0, u1, v1, top: h, groundY: GROUND_Y, fill,
      corners: [bp(GROUND_Y, u0, v0, h), bp(GROUND_Y, u1, v0, h), bp(GROUND_Y, u1, v1, h), bp(GROUND_Y, u0, v1, h)],
    }),
    pushWallBox: (u0, v0, u1, v1, base, height, colors, windows) => {
      const rightFace = faceGeom(GROUND_Y, u0, v0, u1, v1, base, height, 'right');
      const leftFace = faceGeom(GROUND_Y, u0, v0, u1, v1, base, height, 'left');
      els.push({ tag: 'wall', face: rightFace, fill: colors.right, win: windows && windows.right });
      els.push({ tag: 'wall', face: leftFace, fill: colors.left, win: windows && windows.left });
      els.push({
        tag: 'roof', u0, v0, u1, v1, top: base + height, groundY: GROUND_Y, fill: colors.roof,
        corners: [bp(GROUND_Y, u0, v0, base + height), bp(GROUND_Y, u1, v0, base + height),
                  bp(GROUND_Y, u1, v1, base + height), bp(GROUND_Y, u0, v1, base + height)],
      });
    },
    bp: (u, v, h) => bp(GROUND_Y, u, v, h),
    faceGeom: (u0, v0, u1, v1, base, height, side) => faceGeom(GROUND_Y, u0, v0, u1, v1, base, height, side),
    hslToRgbStr, rng, GROUND_Y,
  };

  for (const region of footprints) {
    const [su0, sv0, su1, sv1] = insetRegion(region, -0.045).map(v => clamp(v, 0, 1));
    const sCorners = [bp(GROUND_Y, su0, sv0, 0), bp(GROUND_Y, su1, sv0, 0),
                       bp(GROUND_Y, su1, sv1, 0), bp(GROUND_Y, su0, sv1, 0)]
      .map(p => [p[0] + 2.5, p[1] + 2.5]);
    els.push({ tag: 'roof', u0: su0, v0: sv0, u1: su1, v1: sv1, top: 0, groundY: GROUND_Y, fill: 'rgba(0,0,0,0.20)', corners: sCorners, offset: [2.5, 2.5] });

    const blocks = genTower(rng, region, cfg, theme, GROUND_Y, baseColors);
    for (const b of blocks) {
      els.push({ tag: 'wall', face: b.rightFace, fill: b.right, win: b.windowsRight });
      els.push({ tag: 'wall', face: b.leftFace, fill: b.left, win: b.windowsLeft });
      const [u0, v0, u1, v1] = b.region, top = b.base + b.height;
      els.push({
        tag: 'roof', u0, v0, u1, v1, top, groundY: GROUND_Y, fill: b.roof,
        corners: [bp(GROUND_Y, u0, v0, top), bp(GROUND_Y, u1, v0, top), bp(GROUND_Y, u1, v1, top), bp(GROUND_Y, u0, v1, top)],
      });
    }

    if (theme.decorate) {
      const top = blocks[blocks.length - 1];
      const [u0, v0, u1, v1] = top.region;
      theme.decorate(rng, api, {
        u0, v0, u1, v1, cu: (u0 + u1) / 2, cv: (v0 + v1) / 2,
        topH: top.base + top.height, groundY: GROUND_Y, ...baseColors, cfg,
      });
    }
  }

  // measure + shift vertically so nothing clips, small top/bottom pad
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
  const bottomY = maxY + shift;
  const extraTop = height - bottomY - PAD_BOTTOM;
  const totalShift = shift + Math.max(0, extraTop);

  return serializeEls(els, totalShift, height);
}

// ---------------------------------------------------------------
// batch generate + contact sheet for one theme across its tiers
// ---------------------------------------------------------------
export function runBatch({ outDir, prefix, theme, tiers, countPerTier, baseSeed, title }) {
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = [];
  let seed = baseSeed;
  const tierNames = Object.keys(tiers);
  for (const tierName of tierNames) {
    for (let i = 1; i <= countPerTier; i++) {
      const name = `${prefix}_${tierName}_${String(i).padStart(2, '0')}.svg`;
      const svg = generateBuildingSVG(theme, tiers[tierName], seed++);
      fs.writeFileSync(path.join(outDir, name), svg, 'utf8');
      manifest.push({ tier: tierName, name });
    }
  }

  const rows = tierNames.map(tierName => {
    const cells = manifest.filter(m => m.tier === tierName)
      .map(m => `<div class="cell"><img src="${m.name}"><div class="lbl">${m.name}</div></div>`)
      .join('');
    return `<section><h2>${tierName}</h2><div class="row">${cells}</div></section>`;
  }).join('\n');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title} drafts</title>
<style>
  body{background:#15131f;color:#ddd;font:13px/1.4 -apple-system,sans-serif;padding:24px;}
  h1{color:#cda9ff} h2{color:#9a93c0;text-transform:capitalize;border-bottom:1px solid #332e4d;padding-bottom:4px}
  .row{display:flex;flex-wrap:wrap;gap:18px;margin-bottom:32px}
  .cell{background:repeating-conic-gradient(#241f38 0% 25%, #1c1830 0% 50%) 50% / 20px 20px;
        border:1px solid #332e4d;border-radius:6px;padding:10px;text-align:center}
  .cell img{display:block;height:220px;width:auto;image-rendering:crisp-edges}
  .lbl{color:#8a83ac;font-size:11px;margin-top:6px}
</style></head><body>
<h1>${title} drafts</h1>
<p>Generated by scripts/gen-assets/ — ${manifest.length} variants (${countPerTier} per tier), seed ${baseSeed}.</p>
${rows}
</body></html>`;
  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
  console.log(`Wrote ${manifest.length} SVGs + index.html to ${outDir}`);
  return manifest;
}
