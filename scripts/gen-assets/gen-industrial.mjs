#!/usr/bin/env node
/* ================================================================
   gen-industrial.mjs — procedural isometric INDUSTRIAL building
   generator. Thin theme definition on top of lib/theme-engine.mjs (see
   that file for the shared iso math / transform technique / ground-
   pattern+tower-stack algorithm and gen-commercial.mjs for the reference
   theme). Individual touches for this zone: a dirtier yellow-brown/olive
   palette (matches PAL.I in js/renderer.js) with amber-orange window glow,
   squat wide sheds at low/mid density (footprint fills more of the tile,
   rarely stepped — warehouses are flat), 1-3 rust-toned smokestacks on
   the roof instead of an antenna, more likely and more numerous at higher
   density.

   USAGE
     node gen-industrial.mjs [--count=6] [--seed=1] [--out=assets/drafts/industrial]

   OUTPUT
     assets/drafts/industrial/industrial_{low,mid,high}_{01..N}.svg
     assets/drafts/industrial/index.html   (contact sheet for review)
   ================================================================ */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clamp, hslToRgbStr, runBatch } from './lib/theme-engine.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(args.out || path.join(__dirname, 'assets/drafts/industrial'));
const COUNT = parseInt(args.count || '6', 10);
const SEED = parseInt(args.seed || '1', 10);

// per-tier tuning: low/mid = flat wide sheds (rarely stepped), high =
// tall factory/refinery block with multiple stacks.
const TIERS = {
  low: {
    minH: 112, countWeights: [0.50, 0.35, 0.15], blockCountWeights: [0.70, 0.25, 0.05],
    blockH: [22, 34], setbackChance: 0.12, footprintPad: 0.10,
    stackChance: 0.35, stackMax: 1,
  },
  mid: {
    minH: 180, countWeights: [0.45, 0.35, 0.20], blockCountWeights: [0.45, 0.40, 0.15],
    blockH: [30, 46], setbackChance: 0.22, footprintPad: 0.10,
    stackChance: 0.55, stackMax: 2,
  },
  high: {
    minH: 270, countWeights: [0.35, 0.35, 0.20, 0.10], blockCountWeights: [0.15, 0.35, 0.35, 0.15],
    blockH: [40, 72], setbackChance: 0.32, footprintPad: 0.10,
    stackChance: 0.80, stackMax: 3,
  },
};

const theme = {
  // dirty yellow-brown/olive wall family (PAL.I ~ H45, more saturated and
  // darker than residential's muted green) with amber-orange window glow.
  colors(rng) {
    const hueBase = 45 + (rng() * 2 - 1) * 10;
    const satBase = 0.35 + rng() * 0.20;
    const lightBase = 0.16 + rng() * 0.10;
    const winHue = 34 + (rng() * 2 - 1) * 8;
    return { hueBase, satBase, lightBase, winHue };
  },
  windowStyle() {
    // fewer, plainer window slots than the glassy commercial towers —
    // reads more like small factory-floor windows/vents.
    return { nMin: 4, nMax: 7, dashChance: 0.35, winSatMin: 0.75, winSatMax: 1.0, winLightMin: 0.58, winLightMax: 0.74 };
  },
  // uses the engine default blockColors (right darker/left base/roof lighter)
  decorate(rng, api, info) {
    const { u0, v0, u1, v1, cu, cv, topH, cfg } = info;
    if ((u1 - u0) < 0.16 || (v1 - v0) < 0.16) return;
    if (rng() >= cfg.stackChance) return;
    const n = 1 + Math.floor(rng() * cfg.stackMax);
    for (let i = 0; i < n; i++) {
      const s = 0.028 + rng() * 0.02;
      const su = clamp(cu + (rng() * 2 - 1) * 0.22, u0 + s, u1 - s);
      const sv = clamp(cv + (rng() * 2 - 1) * 0.22, v0 + s, v1 - s);
      const h = 14 + rng() * 18;
      const rustHue = 16 + (rng() * 2 - 1) * 8;
      api.pushWallBox(su - s, sv - s, su + s, sv + s, topH, h, {
        right: hslToRgbStr(rustHue, 0.45, 0.16),
        left: hslToRgbStr(rustHue, 0.45, 0.26),
        roof: hslToRgbStr(rustHue, 0.35, 0.34),
      });
    }
  },
};

runBatch({
  outDir: OUT_DIR, prefix: 'industrial', theme, tiers: TIERS,
  countPerTier: COUNT, baseSeed: SEED, title: 'Industrial building',
});
