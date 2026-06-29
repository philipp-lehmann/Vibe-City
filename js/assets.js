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

// build the building key list: zone × density × variant (a/b/c)
const ZONES     = ['residential', 'commercial', 'industrial'];
const DENSITIES = ['low', 'mid', 'high'];
const VARIANTS  = ['a', 'b', 'c'];
const BUILDING_KEYS = [];
for(const z of ZONES) for(const d of DENSITIES) for(const v of VARIANTS)
  BUILDING_KEYS.push(`${z}_${d}_${v}`);

const TERRAIN_KEYS = ['terrain_lowland', 'terrain_highland', 'terrain_hill',
                      'terrain_wetland', 'terrain_water', 'terrain_shallows'];

const ROAD_KEYS = [];
for(let i = 0; i < 16; i++) ROAD_KEYS.push(`road_mask_${String(i).padStart(2, '0')}`);
ROAD_KEYS.push('road_bridge_span',
               'road_bridge_ramp_ns',  'road_bridge_ramp_ns2',
               'road_bridge_ramp_ew',  'road_bridge_ramp_ew2',
               'road_bridge_pillar', 'road_exit');

// power plant + pump get the same SVG-sprite treatment as zone buildings
const UTILITY_KEYS = ['powerplant', 'pump'];

// key -> folder, so getAsset callers only ever deal in bare keys
const MANIFEST = [
  ...BUILDING_KEYS.map(k => ['buildings', k]),
  ...UTILITY_KEYS.map(k  => ['utilities', k]),
  ...TERRAIN_KEYS.map(k  => ['terrain',   k]),
  ...ROAD_KEYS.map(k     => ['roads',     k]),
];

const cache = new Map();        // key -> HTMLImageElement (only successful loads)
let loaded = false;
let progress = { done: 0, total: 0 };

function loadOne(folder, key){
  return new Promise(resolve => {
    const img = new Image();
    const settle = ok => {
      if(ok) cache.set(key, img);
      progress.done++;
      resolve();
    };
    img.onload  = () => settle(true);
    img.onerror = () => settle(false);   // resolve anyway; renderer falls back
    img.src = `${BASE}${folder}/${key}.svg`;
  });
}

/* Load every asset. Optional onProgress(done, total) fires per settled image. */
export function loadAllAssets(onProgress){
  loaded = false;
  progress = { done: 0, total: MANIFEST.length };
  const tasks = MANIFEST.map(([folder, key]) =>
    loadOne(folder, key).then(() => { onProgress && onProgress(progress.done, progress.total); }));
  return Promise.all(tasks).then(() => { loaded = true; });
}

export function getAsset(key){ return cache.get(key) || null; }
export function isLoaded(){ return loaded; }
export function loadProgress(){ return { ...progress }; }
