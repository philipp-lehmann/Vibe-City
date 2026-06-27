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
         updateRoadsAround, recomputeAllRoads } from './state.js';   // ROAD CONNECTORS
import { view, screenToIso, stepZoom } from './renderer.js';   // ZOOM LEVELS
import { isWaterTerrain } from './terrain.js';   // ROAD CONNECTORS: bridge over water

let dragging=false, dragBtn=0, lastPaint='';

// --- single-tile placement (used by non-drag tools and per-tile paint) ---
function placeTool(gx,gy){
  if(!inBounds(gx,gy)) return;
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
  // ROAD CONNECTORS: road over water -> build a bridge at 5x cost
  if(tool.id==='road' && t.type===T.WATER && isWaterTerrain(t.terrain)){
    const key=gx+','+gy+':bridge';
    if(key===lastPaint) return;
    if(spend(tool.cost*5)){
      const nt=makeTile(T.ROAD);
      nt.terrain=t.terrain; nt.elevation=t.elevation; nt.moisture=t.moisture; nt.bridge=true;
      state.grid[gy][gx]=nt; lastPaint=key;
      updateRoadsAround(gx,gy);
    }
    return;
  }
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

// --- which left-click tools use click-and-drag building ---
function isDragTool(id){ return id==='road'||id==='res'||id==='com'||id==='ind'; }

// --- commit a road/zone drag: cost = built tiles x tool cost; build only on
// grass; if funds short, build as many as affordable from the origin & flash. ---
function commitDrag(){
  const d=state.drag;
  const tool=TOOLS.find(t=>t.id===d.tool);
  const buildable=dragTiles().filter(([x,y])=> state.grid[y][x].type===T.GRASS);
  if(!buildable.length) return;

  const per=tool.cost;
  const affordable=Math.floor(state.funds/per);
  const count=Math.min(buildable.length, affordable);
  if(count<buildable.length) requestFlash('INSUFFICIENT FUNDS');
  for(let i=0;i<count;i++){ const [x,y]=buildable[i]; state.grid[y][x]=makeTile(tool.tile); }
  state.funds -= count*per;
  if(tool.tile===T.ROAD) recomputeAllRoads();   // ROAD CONNECTORS: recompute after a road drag
}

function bulldoze(gx,gy){
  if(!inBounds(gx,gy)) return;
  const t=state.grid[gy][gx];
  if(t.type!==T.GRASS && t.type!==T.WATER){
    const wasRoad=t.type===T.ROAD;
    if(spend(1)){ state.grid[gy][gx]=makeTile(T.GRASS);
      if(wasRoad) updateRoadsAround(gx,gy); }   // ROAD CONNECTORS
  }
}

/* --- attach all listeners (called once by main after DOM is ready) --- */
export function initInput(){
  view.addEventListener('contextmenu',e=>e.preventDefault());

  view.addEventListener('mousedown',e=>{
    const [gx,gy]=pickFromEvent(e);
    dragging=true; dragBtn=e.button; lastPaint='';
    if(e.button===2){ bulldoze(gx,gy); return; }       // right-click bulldoze
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
      if(dragBtn===2) bulldoze(gx,gy);
      else if(dragBtn===0){
        if(state.drag){ state.drag.cx=gx; state.drag.cy=gy; }
        else placeTool(gx,gy);
      }
    }
  });

  window.addEventListener('mouseup',()=>{
    if(state.drag){ commitDrag(); state.drag=null; }    // build on release
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
