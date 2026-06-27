/* ================================================================
   state.js — single source of truth for all mutable game state.
   Dependencies: config.js
   Holds: the grid, funds, population, date, current tool, rotation,
   overlays, drag state, sim speed, and a small notice/flash queue
   that decouples simulation/input from the DOM. Also the tile
   factory, grid init, bounds helpers, pure state mutators, and the
   drag-geometry selector (shared by renderer preview + input commit).
   ================================================================ */
import { MAP_SIZES, DEFAULT_MAP, T } from './config.js';

// --- tile factory: keeps every tile's shape consistent ---
export function makeTile(type){
  return {
    type,
    level: 0,        // density 0=low 1=med 2=high (zones), or build stage
    pop: 0,          // residents/jobs on this tile
    land: 10,        // land value
    powered: false,  // receives power this tick
    water: false,    // receives water this tick
    nearRoad: false, // a road is within reach (3-tile rule)
    grow: 0,         // accumulator toward leveling up
    onFire: 0,       // >0 == burning, counts down
    elev: 0,         // elevation units for rendering
    pollution: 0,    // DEMAND SYSTEM: industrial pollution at this tile
    jobsNearby: true // DEMAND SYSTEM: road-reachable C/I within commute radius
  };
}

// --- the one shared mutable state object ---
export const state = {
  grid: [],
  // MAP SIZE: runtime grid dimensions (default = medium 64×64)
  gridWidth:  MAP_SIZES[DEFAULT_MAP].w,
  gridHeight: MAP_SIZES[DEFAULT_MAP].h,
  funds: 50000,
  taxRate: 0.08,         // derived each tick from taxPct/100
  taxPct: 8,             // DEMAND SYSTEM: tax rate 1-20% (slider), default 8
  happiness: 70,         // DEMAND SYSTEM: city happiness score 0-100
  lvOverlay: false,      // DEMAND SYSTEM: land-value color overlay toggle
  pop: 0,
  month: 0,                       // months since start
  cityName: 'New Terminus',
  demand: { R: 0.5, C: 0.2, I: 0.3 },
  tool: 'road',                   // current tool id
  paused: false,
  zoom: 1,                        // 1 or 2 (two zoom levels)
  rot: 0,                         // view rotation 0=N 1=E 2=S 3=W
  waterOverlay: false,            // tint water-served tiles blue
  drag: null,                     // active road/zone drag {tool,ox,oy,cx,cy}
  speeds: [900, 450, 180],
  speedIdx: 1,
  cam: { x:0, y:0 },              // pan offset (centering handled at draw)
  hover: { x:-1, y:-1 },
  fireActive: false,
  fireEnds: 0,
  notices: [],                    // pending toast messages (drained by ui)
  flash: null,                    // pending status-bar flash (drained by ui)
};

// --- grid init: grass + a small organic lake (MAP SIZE: runtime dims) ---
export function initGrid(){
  state.grid = [];
  const lx=Math.round(state.gridWidth*0.22), ly=Math.round(state.gridHeight*0.75);
  for(let y=0;y<state.gridHeight;y++){
    const row=[];
    for(let x=0;x<state.gridWidth;x++){
      let tile = makeTile(T.GRASS);
      const dx=x-lx, dy=y-ly;                 // lake scales with map
      if(dx*dx+dy*dy < 8) tile = makeTile(T.WATER);
      row.push(tile);
    }
    state.grid.push(row);
  }
}

// MAP SIZE: set grid dimensions from a preset key ('small'|'medium'|'large')
export function setMapSize(key){
  const m = MAP_SIZES[key] || MAP_SIZES[DEFAULT_MAP];
  state.gridWidth = m.w; state.gridHeight = m.h;
}

// --- bounds helpers (MAP SIZE: runtime dims) ---
export const inBounds = (x,y)=> x>=0 && y>=0 && x<state.gridWidth && y<state.gridHeight;
export const tileAt   = (x,y)=> inBounds(x,y) ? state.grid[y][x] : null;

// --- pure state mutators (no DOM) — called from input keys and ui buttons ---
export function setTool(id){ state.tool = id; }
export function togglePause(){ state.paused = !state.paused; }
export function rotateView(d){ state.rot = (state.rot + d + 4) % 4; }

// --- decoupling queue: simulation/input emit, ui drains ---
export function pushNotice(msg){ state.notices.push(msg); }
export function requestFlash(msg){ state.flash = msg; }

// --- drag-geometry selector: tiles under the current drag in LOGICAL coords.
// Shared by renderer.drawDragPreview and input.commitDrag so they never diverge.
// Ordered outward from the origin so the affordability cutoff fills from where
// the player started.
export function dragTiles(){
  const d = state.drag; if(!d) return [];
  let tiles = [];
  if(d.tool==='road'){
    // axis-locked straight line — dominant grid axis wins, never diagonal
    const dx=d.cx-d.ox, dy=d.cy-d.oy;
    if(Math.abs(dx)>=Math.abs(dy)){
      const step=dx>=0?1:-1;
      for(let x=d.ox; x!==d.cx+step; x+=step) tiles.push([x,d.oy]);
    } else {
      const step=dy>=0?1:-1;
      for(let y=d.oy; y!==d.cy+step; y+=step) tiles.push([d.ox,y]);
    }
  } else {
    // zone tools — fill the rectangle between origin and cursor
    const x0=Math.min(d.ox,d.cx), x1=Math.max(d.ox,d.cx);
    const y0=Math.min(d.oy,d.cy), y1=Math.max(d.oy,d.cy);
    for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) tiles.push([x,y]);
    tiles.sort((a,b)=>(Math.abs(a[0]-d.ox)+Math.abs(a[1]-d.oy))
                     -(Math.abs(b[0]-d.ox)+Math.abs(b[1]-d.oy)));
  }
  return tiles.filter(([x,y])=>inBounds(x,y));
}

/* ===== SAVE SYSTEM ====================================================
   Serialize/deserialize the whole game to localStorage. Slot blobs live at
   simcity_save_<slot>; a lightweight index lives at simcity_saves_index.
   ===================================================================== */
const SAVE_PREFIX = 'simcity_save_';
const SAVE_INDEX  = 'simcity_saves_index';

function _readIndex(){ try{ return JSON.parse(localStorage.getItem(SAVE_INDEX)) || []; }catch{ return []; } }
function _writeIndex(idx){ localStorage.setItem(SAVE_INDEX, JSON.stringify(idx)); }

// list of slot metadata (slot, cityName, month, pop, ts, thumb)
export function listSaves(){ return _readIndex(); }

// build a save blob: full grid + scalar state + meta (incl. minimap thumb)
export function serializeSave(thumb){
  return {
    grid: state.grid,   // tiles are plain objects -> JSON-serializable as-is
    state: {
      funds: state.funds, pop: state.pop, month: state.month,
      taxPct: state.taxPct, taxRate: state.taxRate, happiness: state.happiness,
      speedIdx: state.speedIdx, demand: { ...state.demand }, cityName: state.cityName,
      gridWidth: state.gridWidth, gridHeight: state.gridHeight   // MAP SIZE
    },
    meta: { cityName: state.cityName, ts: Date.now(), thumb: thumb || null,
            month: state.month, pop: state.pop }
  };
}

// write a blob to a slot and update the index
export function saveGame(slot, thumb){
  const blob = serializeSave(thumb);
  localStorage.setItem(SAVE_PREFIX+slot, JSON.stringify(blob));
  const idx = _readIndex().filter(e=>e.slot!==slot);
  idx.push({ slot, cityName: state.cityName, month: state.month,
             pop: state.pop, ts: blob.meta.ts, thumb: thumb || null });
  _writeIndex(idx);
  return true;
}

export function readSave(slot){ try{ return JSON.parse(localStorage.getItem(SAVE_PREFIX+slot)); }catch{ return null; } }

export function deleteSave(slot){
  localStorage.removeItem(SAVE_PREFIX+slot);
  _writeIndex(_readIndex().filter(e=>e.slot!==slot));
}

// restore a blob into live state (rebuilds tiles so any newer fields exist)
export function applySave(blob){
  if(!blob || !blob.grid) return false;
  const s = blob.state || {};
  // MAP SIZE: restore grid dimensions before rebuilding the grid
  state.gridHeight = s.gridHeight ?? blob.grid.length;
  state.gridWidth  = s.gridWidth  ?? (blob.grid[0] ? blob.grid[0].length : 0);
  state.grid = blob.grid.map(row => row.map(o => Object.assign(makeTile(o.type), o)));
  state.funds    = s.funds    ?? 50000;
  state.pop      = s.pop      ?? 0;
  state.month    = s.month    ?? 0;
  state.taxPct   = s.taxPct   ?? 8;
  state.taxRate  = s.taxRate  ?? (state.taxPct/100);
  state.happiness= s.happiness?? 70;
  state.speedIdx = s.speedIdx ?? state.speedIdx;
  state.cityName = s.cityName || blob.meta?.cityName || 'New Terminus';
  if(s.demand) state.demand = { ...state.demand, ...s.demand };
  return true;
}
export function loadGame(slot){ return applySave(readSave(slot)); }

// reset to a fresh city (clears grid, reseeds a coal plant like first boot)
// MAP SIZE: optional sizeKey selects grid dimensions before init
export function newGame(name, sizeKey){
  if(sizeKey) setMapSize(sizeKey);
  initGrid();
  state.funds=50000; state.pop=0; state.month=0;
  state.taxPct=8; state.taxRate=0.08; state.happiness=70;
  state.cityName = name || 'New Terminus';
  state.demand = { R:0.5, C:0.2, I:0.3 };
  // seed a coal plant near the centre of whatever map size was chosen
  const cx=state.gridWidth>>1, cy=state.gridHeight>>1;
  state.grid[cy][cx] = makeTile(T.POWERPLANT);
}
