/* ================================================================
   input.js — mouse, wheel and keyboard handling + placement logic.
   Dependencies: config.js, state.js, renderer.js (for screenToIso/view)
   Holds: drag state, tool placement/bulldoze, the road/zone drag
   commit, and screen->grid picking. Mutates state and emits notices/
   flash; it does not update HUD/panel DOM (ui.js does that each frame).
   ================================================================ */
import { T, TOOLS } from './config.js';
import { state, makeTile, inBounds, setTool, togglePause, rotateView,
         pushNotice, requestFlash, dragTiles,
         updateRoadsAround, recomputeAllRoads, isEdge,
         genBridgeId, findBridge } from './state.js';   // ROAD CONNECTORS / EXIT FIX / BRIDGES
import { view, screenToIso, stepZoom } from './renderer.js';   // ZOOM LEVELS
import { isWaterTerrain, TERRAIN } from './terrain.js';   // ROAD CONNECTORS / WATER TOOL
import { propagatePower, propagateWater } from './simulation.js';   // WATER TOOL: live propagation

const WATER_COST = 20;   // WATER TOOL: cost per water tile placed

let dragging=false, dragBtn=0, lastPaint='';

// --- single-tile placement (used by non-drag tools and per-tile paint) ---
function placeTool(gx,gy){
  if(!inBounds(gx,gy)) return;
  // WATER TOOL: paint water over land (per-tile brush); propagation runs on mouseup
  if(state.tool==='watertile'){
    const key=gx+','+gy+':w'; if(key===lastPaint) return;
    if(state.grid[gy][gx].type===T.GRASS && spend(WATER_COST)){ placeWaterTile(gx,gy); lastPaint=key; waterDirty=true; }
    return;
  }
  const t=state.grid[gy][gx];
  const tool=TOOLS.find(x=>x.id===state.tool);

  if(tool.id==='bull'){
    if(t.type!==T.GRASS && t.type!==T.WATER){
      const wasRoad=t.type===T.ROAD;
      if(spend(1)){ state.grid[gy][gx]=makeTile(T.GRASS);
        if(wasRoad) updateRoadsAround(gx,gy); }   // ROAD CONNECTORS: recompute on bulldoze
    }
    return;
  }
  // EXIT FIX: a new edge road (exit) must be >4 tiles from existing exits on that edge
  if(tool.id==='road' && isEdge(gx,gy) && tooCloseExit(gx,gy)){
    requestFlash('Too close to existing exit.'); return;
  }
  // BRIDGES: roads over water are auto-bridged only via straight drags (commitDrag),
  // never by single-tile placement.
  if(t.type===T.WATER){ return; }
  const key=gx+','+gy+':'+tool.id;
  if(key===lastPaint) return;
  if(t.type!==T.GRASS){ return; }

  if(spend(tool.cost)){
    state.grid[gy][gx]=makeTile(tool.tile); lastPaint=key;
    if(tool.tile===T.ROAD) updateRoadsAround(gx,gy);   // ROAD CONNECTORS
  }
}

function spend(n){
  if(state.funds < n){ pushNotice('Not enough funds ($'+n+')'); return false; }
  state.funds-=n; return true;
}

function pickFromEvent(e){
  const r=view.getBoundingClientRect();
  return screenToIso(e.clientX-r.left, e.clientY-r.top);
}

// --- which left-click tools use click-and-drag building (water is a paint brush) ---
function isDragTool(id){ return id==='road'||id==='res'||id==='com'||id==='ind'; }

// EXIT FIX: true if placing an edge road at (gx,gy) is within 4 tiles of an
// existing exit along the SAME edge. `pending` = edge roads accepted earlier in
// the same drag (so a single drag can't drop exits too close together either).
function tooCloseExit(gx,gy,pending){
  const W=state.gridWidth, H=state.gridHeight;
  const sides=[];
  if(gy===0) sides.push('N'); if(gy===H-1) sides.push('S');
  if(gx===0) sides.push('W'); if(gx===W-1) sides.push('E');
  const exitAt=(x,y)=> state.grid[y][x].type===T.ROAD ||
                       (pending && pending.some(p=>p[0]===x && p[1]===y));
  for(const s of sides){
    if(s==='N'||s==='S'){ const y = s==='N'?0:H-1;
      for(let dx=1;dx<=4;dx++){ for(const x of [gx-dx,gx+dx]){ if(x>=0&&x<W && exitAt(x,y)) return true; } } }
    else { const x = s==='W'?0:W-1;
      for(let dy=1;dy<=4;dy++){ for(const y of [gy-dy,gy+dy]){ if(y>=0&&y<H && exitAt(x,y)) return true; } } }
  }
  return false;
}

// --- commit a road/zone drag: cost = built tiles x tool cost; build only on
// grass; if funds short, build as many as affordable from the origin & flash. ---
function commitDrag(){
  const d=state.drag;
  const tool=TOOLS.find(t=>t.id===d.tool);
  // BRIDGES: a straight road drag that crosses water is auto-bridged
  if(tool.tile===T.ROAD){
    const line=dragTiles();
    if(line.some(([x,y])=> state.grid[y][x].type===T.WATER)){ commitBridgeDrag(line); return; }
  }
  let buildable=dragTiles().filter(([x,y])=> state.grid[y][x].type===T.GRASS);
  if(!buildable.length) return;

  // EXIT FIX: drop edge road tiles that would sit within 4 of an existing exit
  let blockedExit=false;
  if(tool.tile===T.ROAD){
    const allowed=[];
    for(const [x,y] of buildable){
      if(isEdge(x,y) && tooCloseExit(x,y,allowed)){ blockedExit=true; continue; }
      allowed.push([x,y]);
    }
    buildable=allowed;
  }
  if(!buildable.length){ if(blockedExit) requestFlash('Too close to existing exit.'); return; }

  const per=tool.cost;
  const affordable=Math.floor(state.funds/per);
  const count=Math.min(buildable.length, affordable);
  for(let i=0;i<count;i++){ const [x,y]=buildable[i]; state.grid[y][x]=makeTile(tool.tile); }
  state.funds -= count*per;
  if(tool.tile===T.ROAD) recomputeAllRoads();   // ROAD CONNECTORS: recompute after a road drag
  // EXIT FIX takes message priority over the funds flash
  if(blockedExit) requestFlash('Too close to existing exit.');
  else if(count<buildable.length) requestFlash('INSUFFICIENT FUNDS');
}

/* ===== BRIDGES: auto-bridge a straight road drag across water =========== */
function commitBridgeDrag(line){
  const ROADCOST = TOOLS.find(t=>t.id==='road').cost;
  if(line.length<2){ requestFlash('Bridge must start and end on land'); return; }
  const [sx0,sy0]=line[0], [ex0,ey0]=line[line.length-1];
  // start AND end of the full drag must be land of LOWLAND or higher
  const landOK=(x,y)=>{ const t=state.grid[y][x]; return t.type!==T.WATER && t.terrain>=TERRAIN.LOWLAND; };
  if(!landOK(sx0,sy0) || !landOK(ex0,ey0)){ requestFlash('Bridge must start and end on land'); return; }
  // cannot overlap an existing bridge
  if(line.some(([x,y])=> state.grid[y][x].bridge)){ requestFlash('Bridge overlaps existing bridge'); return; }

  const dir = (sx0===ex0) ? 'NS' : 'EW';
  // classify tiles + total cost (5x per water tile, 1x per new land road tile)
  const water=[], landGrass=[]; let cost=0;
  for(const [x,y] of line){ const t=state.grid[y][x];
    if(t.type===T.WATER){ water.push([x,y]); cost+=ROADCOST*5; }
    else if(t.type===T.GRASS){ landGrass.push([x,y]); cost+=ROADCOST; }
  }
  if(!water.length) return;                                   // no water crossed
  if(state.funds < cost){ requestFlash('Insufficient funds for bridge'); return; }   // all-or-nothing
  state.funds -= cost;

  // land approaches become normal road
  for(const [x,y] of landGrass) state.grid[y][x]=makeTile(T.ROAD);

  // contiguous water runs each become a bridge entity
  const isWater = new Set(water.map(([x,y])=>x+','+y));
  let run=[];
  const flush=()=>{
    if(!run.length) return;
    const id=genBridgeId();
    const tiles=run.map(([x,y])=>({x,y}));
    for(const [x,y] of run){ const t=state.grid[y][x];
      const nt=makeTile(T.ROAD);
      nt.terrain=TERRAIN.WATER; nt.elevation=t.elevation; nt.moisture=t.moisture;
      nt.bridge=true; nt.bridgeId=id;
      state.grid[y][x]=nt;
    }
    state.bridges.push({
      id, direction:dir, startTile:tiles[0], endTile:tiles[tiles.length-1],
      tiles, length:run.length, cost:run.length*ROADCOST*5
    });
    run=[];
  };
  for(const [x,y] of line){ if(isWater.has(x+','+y)) run.push([x,y]); else flush(); }
  flush();

  recomputeAllRoads();   // ROAD CONNECTORS: masks + outside connections incl. bridges
}

// BRIDGES: remove an entire bridge span -> tiles revert to water, refund 50%
function removeBridgeSpan(bridgeId){
  const b=findBridge(bridgeId); if(!b) return 0;
  for(const {x,y} of b.tiles){ const t=state.grid[y][x];
    const nt=makeTile(T.WATER); nt.terrain=TERRAIN.WATER; nt.elevation=t.elevation; nt.moisture=t.moisture;
    state.grid[y][x]=nt;
  }
  const i=state.bridges.indexOf(b); if(i>=0) state.bridges.splice(i,1);
  recomputeAllRoads();
  return Math.floor((b.cost||0)*0.5);
}

function bulldoze(gx,gy){
  if(!inBounds(gx,gy)) return;
  const t=state.grid[gy][gx];
  // BRIDGES: bulldozing any bridge tile removes the whole span and refunds 50%
  if(t.bridge && t.bridgeId!=null){ state.funds += removeBridgeSpan(t.bridgeId); return; }
  if(t.type!==T.GRASS && t.type!==T.WATER){
    const wasRoad=t.type===T.ROAD;
    if(spend(1)){ state.grid[gy][gx]=makeTile(T.GRASS);
      if(wasRoad) updateRoadsAround(gx,gy); }   // ROAD CONNECTORS
  }
}

/* ===== WATER TOOL + RIGHTCLICK DRAG: tile helpers ===================== */
// turn a land (grass) tile into water, remembering the terrain beneath it
function placeWaterTile(x,y){
  const t=state.grid[y][x];
  if(t.type!==T.GRASS) return false;
  const nt=makeTile(T.WATER);
  nt.terrain=TERRAIN.WATER; nt.origTerrain=t.terrain;     // remember base terrain
  nt.elevation=t.elevation; nt.moisture=t.moisture;
  state.grid[y][x]=nt; return true;
}
// revert a water tile to the terrain beneath it (LOWLAND if none stored)
function removeWaterTile(x,y){
  const t=state.grid[y][x];
  if(t.type!==T.WATER) return false;
  const base = (t.origTerrain ?? TERRAIN.LOWLAND);
  const nt=makeTile(T.GRASS);
  nt.terrain=base; nt.elevation=t.elevation; nt.moisture=t.moisture;
  state.grid[y][x]=nt; return true;
}
// clear a zone tile back to grass, preserving terrain (does not touch roads)
function revertToGrass(x,y){
  const t=state.grid[y][x];
  const nt=makeTile(T.GRASS);
  nt.terrain=t.terrain; nt.elevation=t.elevation; nt.moisture=t.moisture; nt.origTerrain=t.origTerrain;
  state.grid[y][x]=nt;
}
// remove a road tile; BRIDGES: a bridge tile removes its whole span (+refund)
function removeRoadTile(x,y){
  const t=state.grid[y][x];
  if(t.bridge && t.bridgeId!=null){ state.funds += removeBridgeSpan(t.bridgeId); return; }
  revertToGrass(x,y);
}
// after water changes: recompute road masks + re-run power/water propagation
function afterWaterChange(){ recomputeAllRoads(); propagatePower(); propagateWater(); }

// RIGHTCLICK DRAG: tools whose right-drag erases via the drag-preview region
// (these are all in config TOOLS, so the renderer's preview is safe). The water
// tool is a per-tile brush instead, handled separately below.
function isEraseDragTool(id){ return id==='road'||id==='res'||id==='com'||id==='ind'; }

// WATER TOOL: defer road recompute + power/water propagation to mouseup
let waterDirty=false;
// right-click clearing for non-drag tools: water brush removes water, else bulldoze
function rightClear(gx,gy){
  if(!inBounds(gx,gy)) return;
  if(state.tool==='watertile'){ if(removeWaterTile(gx,gy)) waterDirty=true; }
  else bulldoze(gx,gy);
}

// context-aware erase over the current drag region (right-click release)
function eraseDrag(){
  const tool=state.tool;
  const cells=dragTiles();
  let roadTouched=false;
  for(const [x,y] of cells){
    const t=state.grid[y][x];
    if(tool==='res'||tool==='com'||tool==='ind'){
      if(t.type===T.RES||t.type===T.COM||t.type===T.IND) revertToGrass(x,y);   // zones only, keep roads/terrain
    } else if(tool==='road'){
      if(t.type===T.ROAD){ removeRoadTile(x,y); roadTouched=true; }             // roads only
    }
  }
  if(roadTouched) recomputeAllRoads();
}

/* --- attach all listeners (called once by main after DOM is ready) --- */
export function initInput(){
  view.addEventListener('contextmenu',e=>e.preventDefault());

  view.addEventListener('mousedown',e=>{
    const [gx,gy]=pickFromEvent(e);
    dragging=true; dragBtn=e.button; lastPaint='';
    if(e.button===2){
      // RIGHTCLICK DRAG: context-aware clearing. Zone/road tools erase via the
      // drag-preview region (axis-lock/preview); water brush + bulldozer/other
      // clear per-tile.
      if(isEraseDragTool(state.tool)){
        state.drag={tool:state.tool, ox:gx, oy:gy, cx:gx, cy:gy, erase:true};
      } else {
        rightClear(gx,gy);
      }
      return;
    }
    if(e.button===0){
      if(isDragTool(state.tool)){
        state.drag={tool:state.tool, ox:gx, oy:gy, cx:gx, cy:gy};
      } else {
        placeTool(gx,gy);
      }
    }
  });

  view.addEventListener('mousemove',e=>{
    const [gx,gy]=pickFromEvent(e);
    state.hover.x=gx; state.hover.y=gy;                 // ui reads this each frame
    if(dragging){
      if(dragBtn===2){
        if(state.drag){ state.drag.cx=gx; state.drag.cy=gy; }   // RIGHTCLICK DRAG: update preview
        else rightClear(gx,gy);                                 // water brush / bulldoze per-tile
      } else if(dragBtn===0){
        if(state.drag){ state.drag.cx=gx; state.drag.cy=gy; }
        else placeTool(gx,gy);
      }
    }
  });

  window.addEventListener('mouseup',()=>{
    if(state.drag){
      if(state.drag.erase) eraseDrag(); else commitDrag();   // RIGHTCLICK DRAG vs build
      state.drag=null;
    }
    // WATER TOOL: flush road recompute + power/water propagation once per stroke
    if(waterDirty){ afterWaterChange(); waterDirty=false; }
    dragging=false; lastPaint='';
  });

  // ZOOM LEVELS: scroll wheel steps through 0.5x / 1x / 2x (ui syncs label)
  view.addEventListener('wheel',e=>{
    e.preventDefault();
    stepZoom(e.deltaY<0 ? +1 : -1);
  },{passive:false});

  // keyboard
  window.addEventListener('keydown',e=>{
    if(e.code==='Space'){ e.preventDefault(); togglePause(); }
    if(e.key==='q'||e.key==='Q') rotateView(-1);
    if(e.key==='e'||e.key==='E') rotateView(1);
    const n=parseInt(e.key);
    if(n>=1 && n<=TOOLS.length) setTool(TOOLS[n-1].id);
    const PAN=40;
    if(e.key==='ArrowLeft')  state.cam.x+=PAN;
    if(e.key==='ArrowRight') state.cam.x-=PAN;
    if(e.key==='ArrowUp')    state.cam.y+=PAN;
    if(e.key==='ArrowDown')  state.cam.y-=PAN;
  });
}
