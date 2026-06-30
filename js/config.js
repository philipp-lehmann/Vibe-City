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
export const TILE_W = 64;   // base diamond width  (2:1 ratio)
export const TILE_H = 32;   // base diamond height
export const ELEV   = 8;    // pixels of "lift" per elevation unit

// --- tile type ids ---
export const T = {
  GRASS:0, WATER:1, ROAD:2, POWERLINE:3, POWERPLANT:4, PUMP:5, PARK:6,
  RES:7, COM:8, IND:9
};

// --- tool catalogue: id, tile placed, label, build cost, monthly upkeep, icon colour ---
export const TOOLS = [
  { id:'res',   tile:T.RES,        label:'Resid',      cost:100, up:0,  color:'#7caa6b' },
  { id:'com',   tile:T.COM,        label:'Comm',       cost:100, up:0,  color:'#8a5cf6' },
  { id:'ind',   tile:T.IND,        label:'Indus',      cost:100, up:0,  color:'#d9a72c' },
  { id:'road',  tile:T.ROAD,       label:'Road',       cost:10,  up:1,  color:'#777' },
  { id:'power', tile:T.POWERLINE,  label:'P.Line',     cost:5,   up:1,  color:'#caa' },
  { id:'plant', tile:T.POWERPLANT, label:'Powerplant', cost:3000,up:50, color:'#555' },
  { id:'pump',  tile:T.PUMP,       label:'Water',      cost:500, up:10, color:'#2bd' },
  { id:'park',  tile:T.PARK,       label:'Park',       cost:50,  up:2,  color:'#1e8' },
  { id:'bull',  tile:null,         label:'Dozer',      cost:1,   up:0,  color:'#c33' },
];

// --- calendar & facing labels ---
export const MONTHS = ['January','February','March','April','May','June','July',
                       'August','September','October','November','December'];
export const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const FACES  = ['N','E','S','W'];   // view rotation labels

// --- pure predicates ---
export const isZone   = t => t===T.RES || t===T.COM || t===T.IND;
// tiles that conduct power: plant, powerlines, roads, parks, pumps, and any zone
export const conducts = t => t===T.POWERPLANT || t===T.POWERLINE || t===T.ROAD ||
                             isZone(t) || t===T.PARK || t===T.PUMP;

// --- pure math helpers ---
export const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
export const lerp  = (a,b,t) => a + (b-a)*t;
