/* ================================================================
   state.js — single source of truth for all mutable game state.
   Dependencies: config.js
   Holds: the grid, funds, population, date, current tool, rotation,
   overlays, drag state, sim speed, and a small notice/flash queue
   that decouples simulation/input from the DOM. Also the tile
   factory, grid init, bounds helpers, pure state mutators, and the
   drag-geometry selector (shared by renderer preview + input commit).
   ================================================================ */
import { MAP_SIZES, DEFAULT_MAP, DEFAULT_MODE, T, LOANS } from './config.js';   // CREDITS
import { generateTerrain, TERRAIN, isWaterTerrain, coastPass } from './terrain.js'; // TERRAIN / TERRAIN TOOLS

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
    roadMask: 0,     // ROAD CONNECTORS: 4-bit neighbor mask (N1 E2 S4 W8)
    grow: 0,         // accumulator toward leveling up
    onFire: 0,       // >0 == burning, counts down
    elev: 0,         // elevation units for rendering
    pollution: 0,    // DEMAND SYSTEM: industrial pollution at this tile
    jobsNearby: true,// DEMAND SYSTEM: road-reachable C/I within commute radius
    // TERRAIN: procedural base layer (set by applyTerrain on new game)
    terrain: TERRAIN.LOWLAND,
    elevation: 0.5,  // 0..1 simplex elevation
    moisture: 0.5,   // 0..1 simplex moisture
    bridge: false,   // TERRAIN: road tile is a bridge over water
    bridgeId: null,  // BRIDGES: id of the bridge entity this tile belongs to
    coast: false,    // TERRAIN TOOLS: water-adjacent shoreline flag (auto-computed)
    // SCENARIOS: contract that owns this tile (set by ScenarioManager.placeScenario)
    contractId:     null,
    contractType:   null,
    contractLocked: false   // locked tiles cannot be bulldozed or built over
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
  outsideConnections: 0, // ROAD CONNECTORS: # of edge road tiles (off-map links)
  bridges: [],           // BRIDGES: list of bridge entities spanning water
  pop: 0,
  month: 0,                       // months since start
  cityName: 'New Terminus',
  mode: DEFAULT_MODE,             // GAME MODE: 'freeplay' | 'scenario' — fixed at city creation
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
  pinnedTile: null,               // TILE FOCUS: { x, y } of a clicked tile — inspector stays open on it
                                   // (contract tiles also get their whole area highlighted) until the
                                   // same tile is clicked again, another tile is clicked, or ESC is pressed
  fireActive: false,
  fireEnds: 0,
  notices: [],                    // pending toast messages (drained by ui)
  flash: null,                    // pending status-bar flash (drained by ui)
  pendingOffers: [],              // SCENARIOS: contract IDs queued for player acceptance
  pendingPlacements: [],          // SCENARIOS: contract IDs needing tile placement for a new stage
  placementMode: null,            // SCENARIOS: { scenarioId, required, selectedTiles: [[x,y]] }
  powerPlantCount: 0,             // updated by propagatePower each tick
  powerCapacity: 0,               // SCENARIOS: total power units generated (300 per plant)
  powerUsed: 0,                   // SCENARIOS: total power units consumed (1 per powered tile)
  milestones: [],                 // population thresholds already celebrated, e.g. [10000]
  history: { pop: [], happiness: [], funds: [] },  // STATISTICS: rolling monthly samples (sparklines + stats panel)
  statsAutoPause: false,          // STATISTICS: pause the sim while the stats panel is open
  statsVisible: { pop: true, happiness: true, funds: true },   // STATISTICS: which lines show on the panel's combined chart
  // SCENARIOS: active/completed contracts and blacklist
  scenarios: {
    active:    [],
    completed: [],
    jobs:      0,    // total jobs added by completed scenario stages
    contractBlacklist: {}   // { [type]: { until: month, reason: string } }
  },
  // SCENARIOS: recurring monthly revenue from active contracts
  revenue: { monthly: 0, lost: 0 },
  // SCENARIOS: city prestige/reputation (modified by contract outcomes)
  prestige: 0,
  // CREDITS: outstanding loans taken from the Admin panel's Credits dialog.
  // Each LOANS entry (see config.js) can only have one active loan at a time.
  loans: { active: [] },
};

// --- grid init: all grass; TERRAIN: water/relief now come from generateTerrain ---
export function initGrid(){
  state.grid = [];
  for(let y=0;y<state.gridHeight;y++){
    const row=[];
    for(let x=0;x<state.gridWidth;x++) row.push(makeTile(T.GRASS));
    state.grid.push(row);
  }
}

// TERRAIN: merge a generated terrain array into the (fresh) grid. Water-class
// terrain becomes tile.type WATER so existing build/zone rules reject it.
export function applyTerrain(terr){
  for(let y=0;y<state.gridHeight;y++) for(let x=0;x<state.gridWidth;x++){
    const td=terr[y][x], t=state.grid[y][x];
    t.terrain=td.terrain; t.elevation=td.elevation; t.moisture=td.moisture;
    t.type = isWaterTerrain(td.terrain) ? T.WATER : T.GRASS;
  }
  coastPass(state.grid);   // TERRAIN TOOLS: initial shoreline flags
}

// TERRAIN: helpers describing build rules (data; callers enforce)
// TERRAIN TOOLS: hills are also non-buildable (and non-routable)
export function isBuildableTile(t){ return t && !isWaterTerrain(t.terrain) && t.terrain!==TERRAIN.HILL; }
export function bulldozeCost(t){ return t && t.terrain===TERRAIN.WETLAND ? 2 : 1; } // wetland 2x

/* ===== ROAD CONNECTORS: topology mask + outside connections ============ */
// 4-bit neighbour mask: bit0 N, bit1 E, bit2 S, bit3 W
export function computeRoadMask(x,y){
  let m=0;
  if(tileAt(x,  y-1)?.type===T.ROAD) m|=1; // N
  if(tileAt(x+1,y  )?.type===T.ROAD) m|=2; // E
  if(tileAt(x,  y+1)?.type===T.ROAD) m|=4; // S
  if(tileAt(x-1,y  )?.type===T.ROAD) m|=8; // W
  return m;
}
export const isEdge = (x,y)=> x===0 || y===0 || x===state.gridWidth-1 || y===state.gridHeight-1;

function recountOutside(){
  let n=0;
  for(let y=0;y<state.gridHeight;y++) for(let x=0;x<state.gridWidth;x++)
    if(state.grid[y][x].type===T.ROAD && isEdge(x,y)) n++;
  state.outsideConnections=n;
}

// recompute a tile and its 4 neighbours (after a single place/bulldoze)
export function updateRoadsAround(x,y){
  for(const [dx,dy] of [[0,0],[0,-1],[1,0],[0,1],[-1,0]]){
    const t=tileAt(x+dx,y+dy); if(!t) continue;
    t.roadMask = t.type===T.ROAD ? computeRoadMask(x+dx,y+dy) : 0;
  }
  recountOutside();
}

// BRIDGES: unique id generator + lookup
let _brSeq = 0;
export function genBridgeId(){ return 'br'+(++_brSeq)+'_'+Math.floor(Math.random()*1e4); }
export function findBridge(id){ return state.bridges.find(b=>b.id===id) || null; }

// full pass (map load / init / after a drag)
export function recomputeAllRoads(){
  for(let y=0;y<state.gridHeight;y++) for(let x=0;x<state.gridWidth;x++){
    const t=state.grid[y][x];
    t.roadMask = t.type===T.ROAD ? computeRoadMask(x,y) : 0;
  }
  recountOutside();
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

/* ===== CREDITS: loans ==================================================
   Fixed offerings (config.LOANS), one outstanding loan per offering at a
   time. Taking a loan credits the principal immediately; simulation.js
   deducts a flat monthlyPayment each tick until the term ends. ========== */
export function isLoanActive(type){ return state.loans.active.some(l => l.type === type); }

export function takeLoan(type){
  const cfg = LOANS[type];
  if(!cfg || isLoanActive(type)) return false;   // unknown type or already outstanding
  const totalOwed = Math.round(cfg.principal * (1 + cfg.rate));
  state.loans.active.push({
    type, label: cfg.label, principal: cfg.principal, rate: cfg.rate,
    termMonths: cfg.termMonths, monthsRemaining: cfg.termMonths,
    monthlyPayment: Math.round(totalOwed / cfg.termMonths), totalOwed
  });
  state.funds += cfg.principal;
  return true;
}

/* ===== STATISTICS: rolling history for the statusbar sparklines + the
   Statistics panel. Simulation calls pushHistory() once per monthly tick;
   ui.js only ever reads state.history. ===================================== */
const HISTORY_LEN = 24;   // last 24 monthly samples
function pushSample(arr, val){
  arr.push(val);
  if(arr.length > HISTORY_LEN) arr.shift();
}
export function pushHistory(){
  pushSample(state.history.pop, state.pop);
  pushSample(state.history.happiness, state.happiness);
  pushSample(state.history.funds, state.funds);
}

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
      mode: state.mode,   // GAME MODE
      gridWidth: state.gridWidth, gridHeight: state.gridHeight,   // MAP SIZE
      bridges: state.bridges,   // BRIDGES: persist bridge entities
      milestones: state.milestones,
      history: state.history,   // STATISTICS: persist sparkline/stats-panel history
      // SCENARIOS
      scenarios: {
        active:            state.scenarios.active.map(s => ({
          id: s.id, type: s.type, status: s.status,
          currentStageIndex: s.currentStageIndex,
          monthsRemaining: s.monthsRemaining,
          stageStatus: s.stageStatus,
          tiles: s.tiles,
          completedStages: s.completedStages,
          acceptanceHistory: s.acceptanceHistory,
          renegotiationOffer: s.renegotiationOffer
        })),
        completed:         state.scenarios.completed,
        jobs:              state.scenarios.jobs,
        contractBlacklist: state.scenarios.contractBlacklist
      },
      revenue:  { ...state.revenue },
      prestige: state.prestige,
      loans:    { active: state.loans.active.map(l => ({ ...l })) }   // CREDITS
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
  // GAME MODE: default old saves without this field to Free Play so nothing
  // retroactively locks demand behind a contract system that wasn't there before.
  state.mode = s.mode === 'scenario' ? 'scenario' : DEFAULT_MODE;
  if(s.demand) state.demand = { ...state.demand, ...s.demand };
  state.bridges   = Array.isArray(s.bridges)   ? s.bridges   : [];   // BRIDGES: restore entities
  state.milestones = Array.isArray(s.milestones) ? s.milestones : [];
  // STATISTICS: restore history if present (older saves won't have it — seed one sample so charts aren't empty)
  state.history = (s.history && Array.isArray(s.history.pop))
    ? { pop: [...s.history.pop], happiness: [...s.history.happiness], funds: [...s.history.funds] }
    : { pop: [], happiness: [], funds: [] };
  if(!state.history.pop.length) pushHistory();
  coastPass(state.grid);   // TERRAIN TOOLS: recompute shoreline flags after load
  recomputeAllRoads();   // ROAD CONNECTORS: rebuild masks + outside count on load
  // SCENARIOS: restore contract state (older saves without this key get fresh defaults)
  if (s.scenarios) {
    state.scenarios.active              = s.scenarios.active    || [];
    state.scenarios.completed           = s.scenarios.completed || [];
    state.scenarios.jobs                = s.scenarios.jobs      || 0;
    state.scenarios.contractBlacklist   = s.scenarios.contractBlacklist || {};
  } else {
    state.scenarios = { active: [], completed: [], jobs: 0, contractBlacklist: {} };
  }
  state.revenue  = s.revenue  ? { ...s.revenue  } : { monthly: 0, lost: 0 };
  state.prestige = s.prestige ?? 0;
  // CREDITS: restore outstanding loans (older saves without this key get none)
  state.loans = { active: Array.isArray(s.loans?.active) ? s.loans.active.map(l => ({ ...l })) : [] };
  state.pendingOffers    = [];   // SCENARIOS: never restore mid-offer/placement state
  state.pendingPlacements = [];
  state.placementMode    = null;
  state.pinnedTile       = null;   // TILE FOCUS: never restore a pinned selection
  return true;
}
export function loadGame(slot){ return applySave(readSave(slot)); }

// reset to a fresh city (clears grid, reseeds a coal plant like first boot)
// MAP SIZE: optional sizeKey selects grid dimensions before init
// WATER AMOUNT: optional waterPct (0..1) targets that fraction of the map as water
export function newGame(name, sizeKey, waterPct, mode){
  if(sizeKey) setMapSize(sizeKey);
  initGrid();
  // TERRAIN: generate once per new game from a fresh random seed
  applyTerrain(generateTerrain(state.gridWidth, state.gridHeight, (Math.random()*1e9)>>>0, waterPct));
  state.funds=50000; state.pop=0; state.month=0;
  state.taxPct=8; state.taxRate=0.08; state.happiness=70;
  state.cityName = name || 'New Terminus';
  state.mode = mode === 'scenario' ? 'scenario' : DEFAULT_MODE;   // GAME MODE: fixed for the life of this city
  state.demand = { R:0.5, C:0.2, I:0.3 };
  state.outsideConnections = 0;
  state.bridges = [];     // BRIDGES
  state.milestones = [];
  state.history = { pop: [], happiness: [], funds: [] };   // STATISTICS
  pushHistory();   // seed one sample so the sparklines/panel aren't empty at month 0
  // SCENARIOS: reset contract state on new game
  state.scenarios = { active: [], completed: [], jobs: 0, contractBlacklist: {} };
  state.revenue   = { monthly: 0, lost: 0 };
  state.prestige  = 0;
  state.pendingOffers    = [];
  state.pendingPlacements = [];
  state.placementMode    = null;
  state.pinnedTile       = null;   // TILE FOCUS
  state.loans = { active: [] };   // CREDITS
  // NO INITIAL PLANT: new cities start empty — player builds their own power plant
}
