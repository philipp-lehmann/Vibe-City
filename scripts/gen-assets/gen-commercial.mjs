#!/usr/bin/env node
/* ================================================================
   gen-commercial.mjs — procedural isometric COMMERCIAL building
   generator. Thin theme definition on top of lib/theme-engine.mjs —
   see that file for the shared iso math / transform technique / ground-
   pattern+tower-stack algorithm. This file only defines what makes a
   commercial building look like a commercial building: the purple
   palette (matches PAL.C in js/renderer.js), lavender window glow, and
   antenna / rooftop-utility-box decorations.

   USAGE
     node gen-commercial.mjs [--count=6] [--seed=1] [--out=assets/drafts/commercial]

   OUTPUT
     assets/drafts/commercial/commercial_{low,mid,high}_{01..N}.svg
     assets/drafts/commercial/index.html   (contact sheet for review)
   ================================================================ */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clamp, hslToRgbStr, runBatch } from './lib/theme-engine.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(args.out || path.join(__dirname, 'assets/drafts/commercial'));
const COUNT = parseInt(args.count || '6', 10);
const SEED = parseInt(args.seed || '1', 10);

// per-tier tuning — footprint scale, block count/height, decoration odds.
// Canvas-height floors match js/export_assets.js BUILDING = { low:128, mid:224, high:288 }.
const TIERS = {
  low: {
    minH: 128, countWeights: [0.62, 0.30, 0.08], blockCountWeights: [0.55, 0.40, 0.05],
    blockH: [26, 44], setbackChance: 0.35, footprintPad: 0.18,
    antennaChance: 0.10, utilityChance: 0.08,
  },
  mid: {
    minH: 224, countWeights: [0.42, 0.40, 0.18], blockCountWeights: [0.15, 0.55, 0.30],
    blockH: [36, 58], setbackChance: 0.45, footprintPad: 0.15,
    antennaChance: 0.35, utilityChance: 0.18,
  },
  high: {
    minH: 288, countWeights: [0.34, 0.36, 0.20, 0.10], blockCountWeights: [0.05, 0.30, 0.45, 0.20],
    blockH: [42, 80], setbackChance: 0.55, footprintPad: 0.10,
    antennaChance: 0.65, utilityChance: 0.28,
  },
};

const theme = {
  // one shared hue family per building for cohesion — stays within the
  // established commercial "purple" family (PAL.C ~ H249) rather than
  // drifting into blue/teal, which would read as a different zone colour.
  colors(rng) {
    const hueBase = 250 + (rng() * 2 - 1) * 14;
    const satBase = 0.30 + rng() * 0.22;
    const lightBase = 0.21 + rng() * 0.09;
    return { hueBase, satBase, lightBase, winHue: hueBase + 10 + (rng() * 2 - 1) * 8 };
  },
  // right = shadow side (darker), left = lit/base side.
  blockColors(rng, hueBase, satBase, lightBase, drift) {
    return {
      right: hslToRgbStr(hueBase + drift, satBase, lightBase * 0.55),
      left: hslToRgbStr(hueBase + drift, satBase, lightBase),
      roof: hslToRgbStr(hueBase + drift, satBase * 0.85, clamp(lightBase + 0.13 + rng() * 0.06, 0, 0.9)),
    };
  },
  decorate(rng, api, info) {
    const { u0, v0, u1, v1, cu, cv, topH, hueBase, satBase, lightBase, cfg } = info;
    if (rng() < cfg.antennaChance) {
      const antH = 10 + rng() * 16;
      const p0 = api.bp(cu, cv, topH), p1 = api.bp(cu, cv, topH + antH);
      api.pushLine(p0, p1, '#bbb', 1.4, null);
      api.pushCircle(p1, 1.7, rng() < 0.5 ? '#ff5b3b' : '#fff');
    }
    if (rng() < cfg.utilityChance && (u1 - u0) > 0.22 && (v1 - v0) > 0.22) {
      const bs = 0.05 + rng() * 0.03;
      const bu = clamp(cu + (rng() * 2 - 1) * 0.15, u0 + bs, u1 - bs);
      const bv = clamp(cv + (rng() * 2 - 1) * 0.15, v0 + bs, v1 - bs);
      const bh = 6 + rng() * 8;
      api.pushWallBox(bu - bs, bv - bs, bu + bs, bv + bs, topH, bh, {
        right: hslToRgbStr(hueBase, satBase * 0.6, lightBase * 0.45),
        left: hslToRgbStr(hueBase, satBase * 0.6, lightBase * 0.7),
        roof: hslToRgbStr(hueBase, satBase * 0.6, lightBase * 0.9),
      });
    }
  },
};

runBatch({
  outDir: OUT_DIR, prefix: 'commercial', theme, tiers: TIERS,
  countPerTier: COUNT, baseSeed: SEED, title: 'Commercial building',
});
