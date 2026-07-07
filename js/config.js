/* ================================================================
   config.js — immutable constants & pure helpers.
   Dependencies: NONE (root of the graph).
   Holds: tile/grid sizing, tile-type ids, tool catalogue, calendar
   labels, facing labels, and pure predicate/math helpers.
   ================================================================ */

// --- isometric / grid sizing ---
// MAP SIZE: grid dimensions are NO LONGER a hardcoded constant here — they are
// a runtime value on state (state.gridWidth/gridHeight). These are just the
// selectable presets and the default chosen at boot / new game.
export const MAP_SIZES = {
  small:  { w:32,  h:32,  mini:64,  label:'Small',  dim:'32×32'  },
  medium: { w:48,  h:48,  mini:96, label:'Medium', dim:'48×48'  },
  large:  { w:64, h:64, mini:128, label:'Large',  dim:'64×64'},
};
export const DEFAULT_MAP = 'small';   // DEFAULT MAP SIZE: 32×32 default

// WATER AMOUNT: selectable presets controlling what % of a new map's tiles
// become water-class (deep water + shallows) during terrain generation.
export const WATER_LEVELS = {
  none: { pct: 0,    label: '0%'  },
  low:  { pct: 0.1, label: '10%'  },
  med:  { pct: 0.2, label: '20%' },
  high:  { pct: 0.3, label: '30%' },
};
export const DEFAULT_WATER = 'low';   // DEFAULT WATER AMOUNT: 5% default

// GAME MODE: chosen once at city creation, persisted on state/save.
// Free Play has no contract system; Scenario Mode gates growth behind contracts.
export const GAME_MODES = {
  freeplay: { label: 'Free Play',     desc: 'Sandbox. No contracts.' },
  scenario: { label: 'Scenario Mode', desc: 'Demand caps at 15k pop. Contracts unlock growth.' },
};
export const DEFAULT_MODE = 'freeplay';

// SCENARIO MODE: demand penalty tuning — population past the cap drags R/C/I
// demand down unless offset by active contracts' demandBoost (see scenario.js).
export const SCENARIO_DEMAND_CAP_POP = 15000;       // population above which the penalty kicks in
export const SCENARIO_DEMAND_PENALTY_SCALE = 30000; // "meters" the overage against — larger = gentler curve
export const SCENARIO_DEMAND_PENALTY_MAX = 0.9;     // hard ceiling so demand never goes fully to zero/negative-only from this alone

// UTILITIES: per-building service capacity, shared by the propagation flood
// fills (simulation.js) and the tile inspector (ui.js) so the displayed
// numbers can never drift from what's actually simulated.
export const POWERPLANT_CAPACITY = 300; // each coal plant powers ~300 tiles (MW-equivalent)
export const PUMP_CAPACITY       = 120; // each active pump serves ~120 tiles

// CREDITS: fixed loan offerings available from the Admin panel's Credits
// button. Each entry can only have one loan outstanding at a time (see
// state.takeLoan). rate is total interest over the life of the loan (not
// annualized) — repayment is a flat monthly amount for termMonths.
export const LOANS = {
  starter:   { id:'starter',   label:'Starter Loan',   principal:50000,  termMonths:24, rate:0.10 },
  growth:    { id:'growth',    label:'Growth Loan',    principal:150000, termMonths:48, rate:0.20 },
  emergency: { id:'emergency', label:'Emergency Loan', principal:15000,  termMonths:6,  rate:0.05 },
};

export const TILE_W = 64;   // base diamond width  (2:1 ratio)
export const TILE_H = 32;   // base diamond height
export const ELEV   = 8;    // pixels of "lift" per elevation unit

// --- tile type ids ---
export const T = {
  GRASS:0, WATER:1, ROAD:2, POWERLINE:3, POWERPLANT:4, PUMP:5, PARK:6,
  RES:7, COM:8, IND:9, FOREST:10
};

// FOREST: clicking a forest tile stacks tree density instead of replacing the
// tile (see input.js placeTool). Density is stored on the tile as
// t.forestDensity (state.js makeTile), separate from the generic `level`
// field so it never leaks into the zone density / land-value math that
// already reads t.level for every tile (simulation.js computeLandValue).
export const FOREST_MAX_DENSITY = 10;      // 1 = a single tree, 10 = dense forest
export const FOREST_TIER_COUNT  = 5;       // number of distinct sprite tiers covering 1..10

// --- tool catalogue: id, tile placed, label, build cost, monthly upkeep, icon colour ---
export const TOOLS = [
  { id:'res',    tile:T.RES,        label:'Resid',      cost:100, up:5,  color:'#7caa6b' },
  { id:'com',    tile:T.COM,        label:'Comm',       cost:100, up:5,  color:'#8a5cf6' },
  { id:'ind',    tile:T.IND,        label:'Indus',      cost:100, up:5,  color:'#d9a72c' },
  { id:'road',   tile:T.ROAD,       label:'Road',       cost:10,  up:5,  color:'#777' },
  { id:'power',  tile:T.POWERLINE,  label:'P.Line',     cost:5,   up:5,  color:'#caa' },
  { id:'plant',  tile:T.POWERPLANT, label:'Powerplant', cost:3000,up:50, color:'#555' },
  { id:'pump',   tile:T.PUMP,       label:'Water',      cost:500, up:15, color:'#2bd' },
  { id:'park',   tile:T.PARK,       label:'Park',       cost:50,  up:2,  color:'#1e8' },
  { id:'bull',   tile:null,         label:'Dozer',      cost:10,  up:0,  color:'#c33' },
  // FOREST: appended last (not slotted next to 'park') so it doesn't shift
  // 'bull' off its number-key hotkey — input.js binds tools 1:1 to digit keys
  // via TOOLS[n-1], and only 1-9 are reachable from a single keypress, so the
  // 10th entry in this array simply has no keyboard shortcut. Dozer is far
  // more muscle-memory-bound than a brand new tool, so it keeps key 9.
  // No upkeep — trees don't cost anything to maintain once planted. Cost is
  // charged per click, including each density increment (see input.js).
  { id:'forest', tile:T.FOREST,     label:'Forest',     cost:20,  up:0,  color:'#0b5e1e' },
];

// --- calendar & facing labels ---
export const MONTHS = ['January','February','March','April','May','June','July',
                       'August','September','October','November','December'];
export const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const FACES  = ['N','E','S','W'];   // view rotation labels

// CITY IDENTITY: small skyline-emoji selection assignable to a city, picked at
// creation and changeable later from the rename dialog. Persisted on state/save.
export const CITY_EMOJIS = ['🌃', '🌆', '🏙️', '🌉', '🌁'];
export const DEFAULT_CITY_EMOJI = CITY_EMOJIS[0];

// --- pure predicates ---
export const isZone   = t => t===T.RES || t===T.COM || t===T.IND;
// tiles that conduct power: plant, powerlines, roads, parks, pumps, and any zone
export const conducts = t => t===T.POWERPLANT || t===T.POWERLINE || t===T.ROAD ||
                             isZone(t) || t===T.PARK || t===T.PUMP;

// --- pure math helpers ---
export const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
export const lerp  = (a,b,t) => a + (b-a)*t;
