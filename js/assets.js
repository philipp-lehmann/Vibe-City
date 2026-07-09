/* ================================================================
   ASSET RENDERER — assets.js
   Preloads the exported SVG tile sprites as HTMLImageElements so the
   renderer can blit them with ctx.drawImage instead of redrawing every
   tile from canvas paths. This module ONLY loads + caches images; the
   key-selection logic (which sprite a tile maps to) lives in renderer.js.

   Public surface:
     loadAllAssets(onProgress?) -> Promise   (resolves when all settled)
     getAsset(key)              -> HTMLImageElement | null  (by filename, no ext)
     isLoaded()                 -> boolean
     loadProgress()             -> { done, total }

   A failed image resolves (not rejects) so one missing/broken file can't
   block the game — renderer.js falls back to canvas drawing for any key
   getAsset() returns null for.
   ================================================================ */

// Base path is relative to index.html. The exported SVGs are organised into
// per-category folders under assets/ (buildings / terrain / roads).
const BASE = 'assets/';

// build the building key list: zone × density × variant. VARIANTS grew from
// a/b/c to a full a-f (6) when the procedural generator (scripts/gen-assets/)
// replaced the old hand-authored set — see renderer.js buildingAssetKey(),
// which picks a variant via tileSeed(gx,gy)%6.
const ZONES = ['residential', 'commercial', 'industrial'];
const DENSITIES = ['low', 'mid', 'high'];
const VARIANTS = ['a', 'b', 'c', 'd', 'e', 'f'];
const BUILDING_KEYS = [];
for (const z of ZONES) for (const d of DENSITIES) for (const v of VARIANTS)
  BUILDING_KEYS.push(`${z}_${d}_${v}`);

// SCENARIO buildings: contract type × stage × variant, same a-f convention as
// zone buildings — see renderer.js scenarioAssetKey(). Each locked contract
// tile picks its own variant the same way a zoned tile does, so a multi-tile
// contract area reads as a small campus of distinct buildings rather than one
// repeated sprite. Falls back to the flat contract_* colour marker (below)
// for any tile whose sprite isn't loaded.
const SCENARIO_TYPES = ['datacentre', 'shippingcentre', 'wildlife'];
const SCENARIO_STAGES = ['stage1', 'stage2', 'stage3'];
const SCENARIO_KEYS = [];
for (const t of SCENARIO_TYPES) for (const s of SCENARIO_STAGES) for (const v of VARIANTS)
  SCENARIO_KEYS.push(`${t}_${s}_${v}`);

const TERRAIN_KEYS = ['terrain_lowland', 'terrain_highland', 'terrain_hill',
  'terrain_wetland', 'terrain_water', 'terrain_shallows'];

const ROAD_KEYS = [];
for (let i = 0; i < 16; i++) ROAD_KEYS.push(`road_mask_${String(i).padStart(2, '0')}`);
ROAD_KEYS.push('road_bridge_span_ns', 'road_bridge_span_ew',
  'road_bridge_ramp_ns', 'road_bridge_ramp_ns2',
  'road_bridge_ramp_ew', 'road_bridge_ramp_ew2',
  'road_exit');

// power plant + pump get the same SVG-sprite treatment as zone buildings
// contract_generic/contract_* are the flat colour fallback markers, used
// only when a scenario building sprite fails to load for a contract tile.
const UTILITY_KEYS = [
  'powerplant', 'pump',
  'contract_datacentre', 'contract_shippingcentre', 'contract_wildlife', 'contract_generic'
];

// FOREST: 5 density tiers (bucketed from t.forestDensity 1-10, see renderer.js
// forestAssetKey) + the landscaped park sprite. Both are "natural feature"
// tiles, grouped in their own folder rather than buildings/utilities.
const NATURE_KEYS = ['park', 'forest_1', 'forest_2', 'forest_3', 'forest_4', 'forest_5'];

// key -> folder, so getAsset callers only ever deal in bare keys
const MANIFEST = [
  ...BUILDING_KEYS.map(k => ['buildings', k]),
  ...SCENARIO_KEYS.map(k => ['scenario', k]),
  ...UTILITY_KEYS.map(k => ['utilities', k]),
  ...TERRAIN_KEYS.map(k => ['terrain', k]),
  ...ROAD_KEYS.map(k => ['roads', k]),
  ...NATURE_KEYS.map(k => ['nature', k]),
];

const cache = new Map();        // key -> HTMLImageElement (only successful loads)
let loaded = false;
let progress = { done: 0, total: 0 };

function loadOne(folder, key) {
  return new Promise(resolve => {
    const img = new Image();
    const settle = ok => {
      if (ok) cache.set(key, img);
      progress.done++;
      resolve();
    };
    img.onload = () => settle(true);
    img.onerror = () => settle(false);   // resolve anyway; renderer falls back
    img.src = `${BASE}${folder}/${key}.svg`;
  });
}

/* Load every asset. Optional onProgress(done, total) fires per settled image. */
export function loadAllAssets(onProgress) {
  loaded = false;
  progress = { done: 0, total: MANIFEST.length };
  const tasks = MANIFEST.map(([folder, key]) =>
    loadOne(folder, key).then(() => { onProgress && onProgress(progress.done, progress.total); }));
  return Promise.all(tasks).then(() => { loaded = true; });
}

export function getAsset(key) { return cache.get(key) || null; }
export function isLoaded() { return loaded; }
export function loadProgress() { return { ...progress }; }
