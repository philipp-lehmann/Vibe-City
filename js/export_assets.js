/* ================================================================
   SVG EXPORT — export_assets.js
   One-time developer utility that renders every asset variant to its
   own .svg file. It does NOT touch the simulation or the rendering
   logic: it drives the game's real per-variant draw functions through
   a tiny seam in renderer.js (__setExportTarget / __setExportOrigin /
   __exportDrawers), redirecting their output to a canvas2svg context.

   canvas2svg is a drop-in replacement for CanvasRenderingContext2D that
   records draw calls as SVG instead of rasterizing. It is loaded lazily
   from a CDN the first time exportAllAssets() runs, so it adds nothing
   to normal play (the button only appears with ?export=true).

   Public surface: exportAllAssets()  (called by the ui.js export button)
   Dependencies: config.js, state.js, terrain.js, renderer.js (seam only)
   ================================================================ */
import { TILE_W, TILE_H, T } from './config.js';
import { state } from './state.js';
import { TERRAIN } from './terrain.js';
import { __setExportTarget, __setExportOrigin, __exportDrawers } from './renderer.js';

// canvas2svg, fetched on demand (drop-in CanvasRenderingContext2D -> SVG recorder)
const C2S_URL = 'https://cdn.jsdelivr.net/npm/canvas2svg@1.0.19/canvas2svg.min.js';

// --- export-time projection constants -------------------------------
// Render at 2x ("2x resolution") so the recorded vector coords are crisp.
const SCALE = 2;
const HW = (TILE_W / 2) * SCALE;   // 64 — half tile width  @ 2x
const HH = (TILE_H / 2) * SCALE;   // 32 — half tile height @ 2x
const CANVAS_W = TILE_W * SCALE;   // 128 — every tile shares one width

/* Per-class canvas heights (px @ 2x), with the base diamond bottom-aligned.
   Terrain/road sit in a 104-tall box (room for the raised hill mesa below
   and the road EXIT sign above). Buildings grow upward, so their boxes are
   taller per density — sized to fully contain the tallest variant's
   silhouette (chimneys / antennas / flare stacks) without clipping. These
   exceed the spec's nominal 48/64/96 because the real sprites are taller
   than those footprint figures; clipping a tower would be worse. */
const H_TILE   = 104;                       // terrain + road tiles
const BUILDING = { low:128, mid:224, high:288 };
const H_SCAFFOLD = 128;

// helpers -------------------------------------------------------------
const delay = ms => new Promise(r => setTimeout(r, ms));

function loadCanvas2Svg(){
  return new Promise((resolve, reject) => {
    if(window.C2S || window.canvas2svg) return resolve();
    const s = document.createElement('script');
    s.src = C2S_URL;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load canvas2svg from CDN'));
    document.head.appendChild(s);
  });
}

// place a chosen grid cell (cx,cy) at canvas point (sx,sy) so that the
// draw function's internal isoToScreen() neighbour lookups stay consistent
// with the sx,sy we pass in (roads/bridges resolve arms from neighbours).
function setOriginFor(cx, cy, sx, sy){
  __setExportOrigin(sx - (cx - cy) * HW, sy - (cx + cy) * HH);
}

function buildTile(type, level){
  // a developed, powered, occupied lot: skips the scaffold + vacant paths in
  // drawZoneBuilding so we get the finished building with lit windows.
  return { type, level, pop:10, powered:true, water:true, nearRoad:true,
           onFire:0, terrain:TERRAIN.LOWLAND, coast:false };
}

function download(name, svg){
  const blob = new Blob([svg], { type:'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setStatus(msg){
  const el = document.getElementById('s-flash');
  if(el){ el.textContent = msg; el.style.display = 'inline'; }
}
function clearStatus(){
  const el = document.getElementById('s-flash');
  if(el){ el.textContent = ''; el.style.display = 'none'; }
}

/* ===== asset catalogue ==============================================
   Each entry: { name, w, h, draw(ctx) }. `draw` runs while renderer's
   ctx is already redirected to the c2s context; it just positions and
   calls the real drawer. sx is always centred (CANVAS_W/2); sy bottom-
   aligns the base diamond (sy = h - 2*HH = h - 64). ==================== */
function buildAssetList(){
  const sx = CANVAS_W / 2;            // 64 — horizontal centre
  const baseSy = h => h - 2 * HH;     // top-vertex y so diamond bottom hits canvas bottom
  const assets = [];

  // ---- Buildings: R/C/I × low/mid/high × a/b/c (27) ----
  const zones = [['residential', T.RES, 'R'],
                 ['commercial',  T.COM, 'C'],
                 ['industrial',  T.IND, 'I']];
  const densities = [['low', 0], ['mid', 1], ['high', 2]];
  const variants  = [['a', 0], ['b', 1], ['c', 2]];   // gx selects seed%3 -> k=0/1/2
  for(const [zname, type] of zones){
    for(const [dname, level] of densities){
      const h = BUILDING[dname], sy = baseSy(h);
      for(const [vname, gx] of variants){
        const kind = type === T.RES ? 'R' : type === T.COM ? 'C' : 'I';
        assets.push({
          name: `${zname}_${dname}_${vname}.svg`, w: CANVAS_W, h,
          draw: () => __exportDrawers.building(sx, sy, buildTile(type, level), gx, 0, kind),
        });
      }
    }
  }

  // ---- Scaffold (1) ----
  assets.push({
    name: 'scaffold.svg', w: CANVAS_W, h: H_SCAFFOLD,
    draw: () => __exportDrawers.scaffold(sx, baseSy(H_SCAFFOLD)),
  });

  // ---- Utilities: power plant + pump (2) ----
  // Bespoke heights (not the BUILDING bucket): the plant's twin smoke stacks
  // rise well above even the tallest zone building, the pump's tank is short.
  const H_POWERPLANT = 336, H_PUMP = 176;
  assets.push({
    name: 'powerplant.svg', w: CANVAS_W, h: H_POWERPLANT,
    draw: () => __exportDrawers.powerplant(sx, baseSy(H_POWERPLANT), true),
  });
  assets.push({
    name: 'pump.svg', w: CANVAS_W, h: H_PUMP,
    draw: () => __exportDrawers.pump(sx, baseSy(H_PUMP), true),
  });

  // ---- Terrain (6) ----
  // terrainElev (renderer): highland 6, hill 12 (px @ 1x) -> raised mesa drops
  // below the diamond; lower sy so the mesa's foot lands on the canvas bottom.
  const terrains = [
    ['terrain_lowland',  { terrain:TERRAIN.LOWLAND,  type:T.GRASS }, 0],
    ['terrain_highland', { terrain:TERRAIN.HIGHLAND, type:T.GRASS }, 6],
    ['terrain_hill',     { terrain:TERRAIN.HILL,     type:T.GRASS }, 12],
    ['terrain_wetland',  { terrain:TERRAIN.WETLAND,  type:T.GRASS }, 0],
    ['terrain_water',    { terrain:TERRAIN.WATER,    type:T.WATER }, 0],
    ['terrain_shallows', { terrain:TERRAIN.SHALLOWS, type:T.GRASS }, 0],
  ];
  for(const [name, base, elev] of terrains){
    const sy = H_TILE - 2 * HH - elev * SCALE;   // mesa foot at canvas bottom
    const t = Object.assign({ coast:false }, base);
    assets.push({
      name: `${name}.svg`, w: CANVAS_W, h: H_TILE,
      draw: () => __exportDrawers.ground(sx, sy, t, 0, 0),
    });
  }

  // ---- Roads: 16 bitmask variants (interior tile, no EXIT sign) ----
  const RCX = 5, RCY = 5;                 // a safe interior cell (grids are >= 32)
  const roadSy = H_TILE - 2 * HH;         // 40
  for(let mask = 0; mask < 16; mask++){
    const m = mask;
    assets.push({
      name: `road_mask_${String(m).padStart(2, '0')}.svg`, w: CANVAS_W, h: H_TILE,
      draw: () => {
        setOriginFor(RCX, RCY, sx, roadSy);
        __exportDrawers.road(sx, roadSy, RCX, RCY, { roadMask:m });
      },
    });
  }

  // ---- Bridges (4) ----
  assets.push({ name:'road_bridge_span.svg',    w:CANVAS_W, h:H_TILE,
    draw: () => drawBridge(sx, roadSy, 0b0101, 'NS', []) });            // N|S, full span
  assets.push({ name:'road_bridge_ramp_ns.svg', w:CANVAS_W, h:H_TILE,
    draw: () => drawBridge(sx, roadSy, 0b0101, 'NS', [[0,-1]]) });      // N approach = land
  assets.push({ name:'road_bridge_ramp_ew.svg', w:CANVAS_W, h:H_TILE,
    draw: () => drawBridge(sx, roadSy, 0b1010, 'EW', [[1,0]]) });       // E approach = land
          // no arms -> pillars + rails

  // ---- Road EXIT apron (1): a connector on the map edge -> EXIT sign ----
  assets.push({
    name: 'road_exit.svg', w: CANVAS_W, h: H_TILE,
    draw: () => {
      setOriginFor(0, RCY, sx, roadSy);                 // gx=0 -> edge tile
      __exportDrawers.road(sx, roadSy, 0, RCY, { roadMask:0b0010 });  // single inward (E) arm
    },
  });

  return assets;
}

/* Draw one bridge tile. drawBridgeTile (reached via the road drawer when
   t.bridge is set) reads neighbour tile types from the real grid to decide
   ramp vs. full span, and reads state.bridges for the span direction. We
   temporarily set the (interior) neighbour cells and a one-off bridge entity,
   draw, then restore — all synchronously, so the live render loop never sees
   the mutation. `landSet` lists neighbour offsets that should read as land
   (forcing a ramp on that side); the rest read as water (full deck height). */
function drawBridge(sx, sy, mask, direction, landSet){
  const cx = 5, cy = 5, BID = 999001;
  const neigh = [[0,-1],[1,0],[0,1],[-1,0]];
  const saved = [];
  for(const [dx, dy] of neigh){
    const tile = state.grid[cy + dy][cx + dx];
    saved.push([tile, tile.type, tile.bridge]);
    const isLand = landSet.some(([lx, ly]) => lx === dx && ly === dy);
    tile.type = isLand ? T.GRASS : T.WATER;
    tile.bridge = false;
  }
  const savedBridges = state.bridges;
  state.bridges = [{ id:BID, direction }];
  try {
    setOriginFor(cx, cy, sx, sy);
    __exportDrawers.road(sx, sy, cx, cy, { roadMask:mask, bridge:true, bridgeId:BID });
  } finally {
    state.bridges = savedBridges;
    for(const [tile, type, bridge] of saved){ tile.type = type; tile.bridge = bridge; }
  }
}

// render a single asset into a fresh c2s context and return the SVG string.
// ctx redirect + draw + serialize happen synchronously (no await) so the live
// requestAnimationFrame render loop can't draw into our export context.
function renderAsset(C2S, a){
  const c2s = new C2S(a.w, a.h);
  // canvas2svg@1.0.19 doesn't implement setLineDash; the road/scaffold drawers
  // call it. Polyfill it (and getLineDash) so those calls don't throw — dashed
  // strokes simply serialize as solid lines, which is fine for static assets.
  if(typeof c2s.setLineDash !== 'function'){
    c2s.setLineDash = function(arr){ this.__lineDash = arr || []; };
    c2s.getLineDash = function(){ return this.__lineDash || []; };
  }
  __setExportTarget(c2s);
  try {
    a.draw();
    return sanitizeSvg(c2s.getSerializedSvg(true));
  } finally {
    __setExportTarget(null);   // restore the on-screen context
  }
}

// canvas2svg emits xmlns:xlink twice on the root <svg>; browsers tolerate it but
// strict XML parsers reject "attribute redefined". Keep the first, drop the rest.
function sanitizeSvg(svg){
  return svg.replace(/<svg\b[^>]*>/, tag => {
    let seen = false;
    return tag.replace(/\s+xmlns:xlink="[^"]*"/g, m => (seen ? '' : (seen = true, m)));
  });
}

/* Export every asset variant to an individual SVG download. */
export async function exportAllAssets(){
  await loadCanvas2Svg();
  const C2S = window.C2S || window.canvas2svg;
  if(typeof C2S !== 'function') throw new Error('canvas2svg did not expose a C2S constructor');

  // snapshot the view state we override for the isolated-tile projection
  const saved = { zoom:state.zoom, rot:state.rot, cam:{ x:state.cam.x, y:state.cam.y } };
  state.zoom = SCALE; state.rot = 0; state.cam = { x:0, y:0 };

  const assets = buildAssetList();
  try {
    for(let i = 0; i < assets.length; i++){
      setStatus(`Exporting ${i + 1} / ${assets.length}...`);
      download(assets[i].name, renderAsset(C2S, assets[i]));
      await delay(50);   // space out downloads so the browser doesn't block them
    }
    setStatus(`Exported ${assets.length} SVGs.`);
  } finally {
    // restore live view state; origin self-heals on the next render() frame
    __setExportTarget(null);
    state.zoom = saved.zoom; state.rot = saved.rot; state.cam = saved.cam;
    setTimeout(clearStatus, 4000);
  }
}
