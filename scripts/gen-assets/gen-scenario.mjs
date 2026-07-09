#!/usr/bin/env node
/* ================================================================
   gen-scenario.mjs — procedural isometric SCENARIO-AREA building
   generator, covering the three contract types from
   js/scenarios/blueprints.js (AI_DATA_CENTRE, SHIPPING_CENTRE,
   WILDLIFE_RESERVE — see assets/utilities/contract_*.svg for their flat
   map-overlay marker colours, reused here as each theme's accent hue).
   Thin theme definitions on top of lib/theme-engine.mjs (see that file
   for the shared iso math / transform technique / ground-pattern+tower-
   stack algorithm, and gen-commercial.mjs for the reference theme).

   Each contract type gets a genuinely distinct look rather than a
   recolour of the same tower:
     - datacentre:     cool pale-gray tech blocks, flat/uniform (rarely
                        stepped), blinking orange server-status lights
                        on the roof (orange = contract_datacentre.svg)
     - shippingcentre:  each stacked block is its own saturated "shipping
                        container" colour, bold pale corrugation stripes
                        instead of glowing windows, dockside crane
     - wildlife:        muted forest green/brown lodge, almost always a
                        single small footprint, few warm-lit windows, a
                        simple tree decoration instead of an antenna

   Tiers are named stage1/stage2/stage3 (not low/mid/high) to match the
   contract system's growing tile footprint (3x3 -> 4x4 -> 5x5, see
   js/scenarios/blueprints.js) rather than zone density.

   USAGE
     node gen-scenario.mjs [--count=6] [--seed=1] [--type=datacentre|shippingcentre|wildlife] [--out=assets/drafts/scenario]

   OUTPUT
     assets/drafts/scenario/{type}/{type}_{stage1,stage2,stage3}_{01..N}.svg
     assets/drafts/scenario/{type}/index.html   (contact sheet per type)
   ================================================================ */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clamp, hslToRgbStr, runBatch } from './lib/theme-engine.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = path.resolve(args.out || path.join(__dirname, 'assets/drafts/scenario'));
const COUNT = parseInt(args.count || '6', 10);
const SEED = parseInt(args.seed || '1', 10);
const TYPE_FILTER = args.type || null;

// ================================================================
// AI DATA CENTRE — cool, pale, uniform "tech campus" blocks
// ================================================================
const datacentreTiers = {
  stage1: { minH: 150, countWeights: [0.55, 0.30, 0.15], blockCountWeights: [0.55, 0.35, 0.10], blockH: [26, 40], setbackChance: 0.10, footprintPad: 0.14, lightsChance: 0.60, lightsMax: 4 },
  stage2: { minH: 210, countWeights: [0.30, 0.45, 0.25], blockCountWeights: [0.30, 0.45, 0.25], blockH: [32, 50], setbackChance: 0.15, footprintPad: 0.11, lightsChance: 0.75, lightsMax: 6 },
  stage3: { minH: 260, countWeights: [0.15, 0.35, 0.30, 0.20], blockCountWeights: [0.15, 0.45, 0.30, 0.10], blockH: [36, 58], setbackChance: 0.18, footprintPad: 0.08, lightsChance: 0.90, lightsMax: 8 },
};
const datacentreTheme = {
  colors(rng) {
    const hueBase = 212 + (rng() * 2 - 1) * 14;
    const satBase = 0.05 + rng() * 0.08;
    const lightBase = 0.30 + rng() * 0.10;
    // window glow matches the contract_datacentre.svg tile overlay colour
    // (#d04809, H~19) instead of a generic cool cyan — ties the building
    // back to its map marker.
    const winHue = 19 + (rng() * 2 - 1) * 8;
    return { hueBase, satBase, lightBase, winHue };
  },
  windowStyle() {
    return { nMin: 7, nMax: 8, dashChance: 0.20, winSatMin: 0.75, winSatMax: 0.95, winLightMin: 0.55, winLightMax: 0.68, strokeWMin: 1.0, strokeWMax: 1.8 };
  },
  decorate(rng, api, info) {
    const { u0, v0, u1, v1, topH, cfg } = info;
    if (rng() >= cfg.lightsChance) return;
    const n = 2 + Math.floor(rng() * cfg.lightsMax);
    for (let i = 0; i < n; i++) {
      const u = lerp2(u0, u1, 0.12 + rng() * 0.76), v = lerp2(v0, v1, 0.12 + rng() * 0.76);
      const p = api.bp(u, v, topH + 0.5);
      api.pushCircle(p, 1.1 + rng() * 0.8, 'rgb(208,72,9)', 0.45 + rng() * 0.55);
    }
  },
};

// ================================================================
// SHIPPING CENTRE — stacked "shipping container" blocks, orange/brick
// family matching the contract_shippingcentre.svg tile overlay (#7f2317,
// H~7), with a rare differently-hued container mixed in for variety.
// ================================================================
const SHIP_HUE = 7;                       // contract_shippingcentre.svg accent (#7f2317)
const ACCENT_CONTAINER_HUES = [205, 44, 122]; // occasional off-hue container: blue / mustard / green
const shippingTiers = {
  stage1: { minH: 120, countWeights: [0.55, 0.35, 0.10], blockCountWeights: [0.35, 0.45, 0.20], blockH: [16, 26], setbackChance: 0.05, footprintPad: 0.14, craneChance: 0.35 },
  stage2: { minH: 150, countWeights: [0.30, 0.45, 0.25], blockCountWeights: [0.20, 0.45, 0.35], blockH: [18, 28], setbackChance: 0.05, footprintPad: 0.11, craneChance: 0.55 },
  stage3: { minH: 180, countWeights: [0.15, 0.35, 0.30, 0.20], blockCountWeights: [0.10, 0.35, 0.40, 0.15], blockH: [18, 30], setbackChance: 0.05, footprintPad: 0.08, craneChance: 0.75 },
};
const shippingTheme = {
  colors(rng) {
    // building-level base is mostly a fallback; blockColors picks its own
    // hue per block below so each stacked container reads as a separate box.
    return { hueBase: SHIP_HUE, satBase: 0.55, lightBase: 0.34, winHue: 0 };
  },
  blockColors(rng) {
    const hue = (rng() < 0.82 ? SHIP_HUE : ACCENT_CONTAINER_HUES[Math.floor(rng() * ACCENT_CONTAINER_HUES.length)])
      + (rng() * 2 - 1) * 10;
    const sat = 0.45 + rng() * 0.25, light = 0.30 + rng() * 0.12;
    return {
      right: hslToRgbStr(hue, sat, light * 0.6),
      left: hslToRgbStr(hue, sat, light),
      roof: hslToRgbStr(hue, sat * 0.85, clamp(light + 0.14, 0, 0.9)),
    };
  },
  windowStyle() {
    // bold pale corrugation stripes rather than glowing windows
    return { nMin: 3, nMax: 5, dashChance: 0.10, insetMin: 0.10, insetMax: 0.16, winSatMin: 0.0, winSatMax: 0.08, winLightMin: 0.88, winLightMax: 0.97, strokeWMin: 2.0, strokeWMax: 3.4, hueJitter: 0 };
  },
  decorate(rng, api, info) {
    const { u0, v0, u1, v1, cu, cv, cfg } = info;
    if (rng() >= cfg.craneChance) return;
    const cornerU = rng() < 0.5 ? u0 - 0.05 : u1 + 0.05;
    const cornerV = rng() < 0.5 ? v0 - 0.05 : v1 + 0.05;
    const mastH = 65 + rng() * 35;
    const p0 = api.bp(cornerU, cornerV, 0), p1 = api.bp(cornerU, cornerV, mastH);
    api.pushLine(p0, p1, '#e8b23c', 2.2, null, 'butt');
    const boomEndU = cornerU + (cu - cornerU) * 0.9, boomEndV = cornerV + (cv - cornerV) * 0.9;
    const p2 = api.bp(boomEndU, boomEndV, mastH - 4);
    api.pushLine(p1, p2, '#e8b23c', 2.0, null, 'butt');
    api.pushCircle(p2, 1.6, '#222');
  },
};

// ================================================================
// WILDLIFE RESERVE — humble green/brown lodge, tree decoration
// ================================================================
const wildlifeTiers = {
  stage1: { minH: 100, countWeights: [0.90, 0.10], blockCountWeights: [0.85, 0.15], blockH: [16, 26], setbackChance: 0.05, footprintPad: 0.24, treeChance: 0.65 },
  stage2: { minH: 110, countWeights: [0.80, 0.20], blockCountWeights: [0.75, 0.25], blockH: [18, 28], setbackChance: 0.05, footprintPad: 0.20, treeChance: 0.75 },
  stage3: { minH: 120, countWeights: [0.65, 0.30, 0.05], blockCountWeights: [0.65, 0.30, 0.05], blockH: [18, 30], setbackChance: 0.08, footprintPad: 0.18, treeChance: 0.85 },
};
// find a free patch of the given size just outside the lodge footprint,
// on a randomly chosen side, so ground decorations (stones/pond) don't
// overlap the building. Returns null if there's no room on any side.
function marginPatch(rng, u0, v0, u1, v1, size) {
  const sides = [0, 1, 2, 3].sort(() => rng() - 0.5);
  for (const side of sides) {
    if (side === 0 && u0 > 0.05 + size) {
      const pu1 = u0 - 0.02, pu0 = Math.max(0.02, pu1 - size);
      const pv0 = clamp(lerp2(v0, v1, rng() * 0.6), 0.02, 0.98 - size);
      return [pu0, pv0, pu1, Math.min(0.98, pv0 + size)];
    }
    if (side === 1 && (1 - u1) > 0.05 + size) {
      const pu0 = u1 + 0.02, pu1 = Math.min(0.98, pu0 + size);
      const pv0 = clamp(lerp2(v0, v1, rng() * 0.6), 0.02, 0.98 - size);
      return [pu0, pv0, pu1, Math.min(0.98, pv0 + size)];
    }
    if (side === 2 && v0 > 0.05 + size) {
      const pv1 = v0 - 0.02, pv0 = Math.max(0.02, pv1 - size);
      const pu0 = clamp(lerp2(u0, u1, rng() * 0.6), 0.02, 0.98 - size);
      return [pu0, pv0, Math.min(0.98, pu0 + size), pv1];
    }
    if (side === 3 && (1 - v1) > 0.05 + size) {
      const pv0 = v1 + 0.02, pv1 = Math.min(0.98, pv0 + size);
      const pu0 = clamp(lerp2(u0, u1, rng() * 0.6), 0.02, 0.98 - size);
      return [pu0, pv0, Math.min(0.98, pu0 + size), pv1];
    }
  }
  return null;
}

const wildlifeTheme = {
  colors(rng) {
    const hueBase = 112 + (rng() * 2 - 1) * 16;
    const satBase = 0.25 + rng() * 0.17;
    const lightBase = 0.18 + rng() * 0.09;
    return { hueBase, satBase, lightBase, winHue: 0 };
  },
  // no windows on the lodge — reads as a quiet, minimal reserve building.
  windowStyle() {
    return { nMin: 0, nMax: 0, maxCut: 0 };
  },
  decorate(rng, api, info) {
    const { u0, v0, u1, v1, cu, cv, topH, cfg } = info;

    if (rng() < cfg.treeChance) {
      const s = 0.05 + rng() * 0.02;
      const tu = clamp(cu + (rng() * 2 - 1) * 0.22, u0 + s, u1 - s);
      const tv = clamp(cv + (rng() * 2 - 1) * 0.22, v0 + s, v1 - s);
      const trunkH = 7 + rng() * 5;
      const p0 = api.bp(tu, tv, topH), p1 = api.bp(tu, tv, topH + trunkH);
      api.pushLine(p0, p1, '#5a3a20', 2.4, null, 'butt');
      const canopyHue = 105 + (rng() * 2 - 1) * 20;
      for (let i = 0; i < 3; i++) {
        const anchor = api.bp(tu, tv, topH + trunkH + i * 2.2);
        const jx = (rng() * 2 - 1) * 4;
        api.pushCircle([anchor[0] + jx, anchor[1] - i * 3], 5.2 - i * 0.9, hslToRgbStr(canopyHue, 0.42 + i * 0.04, 0.30 + i * 0.07));
      }
    }

    // grey stones: a small scattered cluster of 2-4 rounded rocks on the
    // ground beside the lodge.
    if (rng() < 0.55) {
      const patch = marginPatch(rng, u0, v0, u1, v1, 0.10 + rng() * 0.06);
      if (patch) {
        const [pu0, pv0, pu1, pv1] = patch;
        const n = 2 + Math.floor(rng() * 3);
        for (let i = 0; i < n; i++) {
          const su = lerp2(pu0, pu1, rng()), sv = lerp2(pv0, pv1, rng());
          const p = api.bp(su, sv, 0);
          const grey = 0.38 + rng() * 0.16;
          api.pushCircle([p[0], p[1] - 1.5], 2.2 + rng() * 2.4, hslToRgbStr(90, 0.05, grey));
        }
      }
    }

    // pond: a small flat blue/teal patch on the ground beside the lodge.
    if (rng() < 0.4) {
      const size = 0.14 + rng() * 0.10;
      const patch = marginPatch(rng, u0, v0, u1, v1, size);
      if (patch) {
        const [pu0, pv0, pu1, pv1] = patch;
        const pondHue = 195 + (rng() * 2 - 1) * 15;
        api.pushFlatPatch(pu0, pv0, pu1, pv1, hslToRgbStr(pondHue, 0.45, 0.34 + rng() * 0.08), 0.4);
      }
    }
  },
};

function lerp2(a, b, t) { return a + (b - a) * t; }

const TYPES = {
  datacentre: { tiers: datacentreTiers, theme: datacentreTheme, title: 'AI Data Centre' },
  shippingcentre: { tiers: shippingTiers, theme: shippingTheme, title: 'Shipping Centre' },
  wildlife: { tiers: wildlifeTiers, theme: wildlifeTheme, title: 'Wildlife Reserve' },
};

for (const [type, def] of Object.entries(TYPES)) {
  if (TYPE_FILTER && TYPE_FILTER !== type) continue;
  runBatch({
    outDir: path.join(OUT_ROOT, type), prefix: type, theme: def.theme, tiers: def.tiers,
    countPerTier: COUNT, baseSeed: SEED, title: def.title,
  });
}
