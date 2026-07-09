#!/usr/bin/env node
/* ================================================================
   gen-residential.mjs — procedural isometric RESIDENTIAL building
   generator. Thin theme definition on top of lib/theme-engine.mjs (see
   that file for the shared iso math / transform technique / ground-
   pattern+tower-stack algorithm and gen-commercial.mjs for the reference
   theme). Individual touches for this zone: a muted olive-green palette
   (matches PAL.R in js/renderer.js) with warm amber window glow, squatter
   houses at low density (small footprint, mostly 1 story, occasional
   brick chimney), growing into apartment blocks/towers at mid/high
   density (occasional rooftop water tank instead of a chimney).

   USAGE
     node gen-residential.mjs [--count=6] [--seed=1] [--out=assets/drafts/residential]

   OUTPUT
     assets/drafts/residential/residential_{low,mid,high}_{01..N}.svg
     assets/drafts/residential/index.html   (contact sheet for review)
   ================================================================ */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clamp, hslToRgbStr, runBatch } from './lib/theme-engine.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(args.out || path.join(__dirname, 'assets/drafts/residential'));
const COUNT = parseInt(args.count || '6', 10);
const SEED = parseInt(args.seed || '1', 10);

// per-tier tuning: low = houses (small footprint, mostly single storey,
// rarely stacked), mid = townhomes/small apartments, high = towers.
const TIERS = {
  low: {
    minH: 112, countWeights: [0.55, 0.35, 0.10], blockCountWeights: [0.65, 0.30, 0.05],
    blockH: [20, 34], setbackChance: 0.22, footprintPad: 0.20,
    chimneyChance: 0.35, tankChance: 0.0,
  },
  mid: {
    minH: 190, countWeights: [0.40, 0.40, 0.20], blockCountWeights: [0.25, 0.55, 0.20],
    blockH: [30, 48], setbackChance: 0.35, footprintPad: 0.16,
    chimneyChance: 0.20, tankChance: 0.15,
  },
  high: {
    minH: 260, countWeights: [0.38, 0.34, 0.20, 0.08], blockCountWeights: [0.10, 0.35, 0.40, 0.15],
    blockH: [38, 68], setbackChance: 0.45, footprintPad: 0.12,
    chimneyChance: 0.05, tankChance: 0.40,
  },
};

const theme = {
  // muted olive-green wall family (PAL.R ~ H100, low saturation "cozy
  // suburban" look) with a warm amber window glow — a different hue
  // family from the walls, like real lit-window light at dusk.
  colors(rng) {
    const hueBase = 100 + (rng() * 2 - 1) * 18;
    const satBase = 0.12 + rng() * 0.14;
    const lightBase = 0.20 + rng() * 0.10;
    const winHue = 38 + (rng() * 2 - 1) * 8;
    return { hueBase, satBase, lightBase, winHue };
  },
  windowStyle() {
    return { winSatMin: 0.75, winSatMax: 0.95, winLightMin: 0.72, winLightMax: 0.86 };
  },
  // uses the engine default blockColors (right darker/left base/roof lighter)
  decorate(rng, api, info) {
    const { u0, v0, u1, v1, cu, cv, topH, hueBase, satBase, lightBase, cfg } = info;
    if ((u1 - u0) < 0.16 || (v1 - v0) < 0.16) return; // too small a roof for either decoration
    if (rng() < cfg.chimneyChance) {
      // chimney sits off-centre near a corner, like a real roof chimney
      const s = 0.035 + rng() * 0.02;
      const cornerU = rng() < 0.5 ? u0 + s * 1.4 : u1 - s * 1.4;
      const cornerV = rng() < 0.5 ? v0 + s * 1.4 : v1 - s * 1.4;
      const h = 10 + rng() * 10;
      const brickHue = 16 + (rng() * 2 - 1) * 6;
      api.pushWallBox(cornerU - s, cornerV - s, cornerU + s, cornerV + s, topH, h, {
        right: hslToRgbStr(brickHue, 0.38, 0.20),
        left: hslToRgbStr(brickHue, 0.38, 0.34),
        roof: hslToRgbStr(brickHue, 0.30, 0.42),
      });
    } else if (rng() < cfg.tankChance) {
      // rooftop water tank: bigger box, weathered wood/metal tone, near centre
      const s = 0.06 + rng() * 0.03;
      const tu = clamp(cu + (rng() * 2 - 1) * 0.12, u0 + s, u1 - s);
      const tv = clamp(cv + (rng() * 2 - 1) * 0.12, v0 + s, v1 - s);
      const h = 14 + rng() * 12;
      api.pushWallBox(tu - s, tv - s, tu + s, tv + s, topH, h, {
        right: hslToRgbStr(32, 0.14, 0.30),
        left: hslToRgbStr(32, 0.14, 0.42),
        roof: hslToRgbStr(32, 0.10, 0.50),
      });
    }
    void satBase; void lightBase;
  },
};

runBatch({
  outDir: OUT_DIR, prefix: 'residential', theme, tiers: TIERS,
  countPerTier: COUNT, baseSeed: SEED, title: 'Residential building',
});
