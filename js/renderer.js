/* ================================================================
   renderer.js — all canvas drawing. Owns the <canvas> elements only;
   it does NOT update HUD/panel DOM (that is ui.js's job).
   Dependencies: config.js, state.js
   Holds: isometric projection + rotation math, painter's-algorithm
   sort, ground/building/overlay sprites, drag preview, minimap, and
   the toolbar icon drawer used by ui.
   ================================================================ */
import { TILE_W, TILE_H, ELEV, T, TOOLS, isZone, clamp } from './config.js';   // MAP SIZE: GRID now runtime
import { state, tileAt, dragTiles } from './state.js';
import { TERRAIN } from './terrain.js';   // TERRAIN
import { getAsset } from './assets.js';   // ASSET RENDERER

// --- canvas handles (canvas is the renderer's surface, not panel DOM) ---
export const view = document.getElementById('view');
// SVG EXPORT: `ctx` was a const bound to the on-screen 2D context. It is now a
// swappable `let` so the one-time SVG exporter (js/export_assets.js) can redirect
// every draw call to a canvas2svg context and then restore. No drawing logic
// changes — this is the only edit the export feature makes to the renderer's body.
let ctx  = view.getContext('2d');
const __screenCtx = ctx;   // SVG EXPORT: the real on-screen context, kept for restore
const mini = document.getElementById('minimap');
const mctx = mini.getContext('2d');
let originX=0, originY=0;   // screen origin for grid (0,0)

export function resize(){
  view.width  = window.innerWidth;
  view.height = window.innerHeight;
  ctx.imageSmoothingEnabled=false;
  if(zoomLevel===0) applyZoomLevel();   // ZOOM LEVELS: refit fully-zoomed-out view
}
window.addEventListener('resize', resize);

/* ===== ZOOM LEVELS ====================================================
   Three levels: 0 = fully zoomed out ("0.5x" — scales so the whole map
   fits the viewport, for planning/overlays), 1 = 1x, 2 = 2x. The fit
   scale is recomputed from viewport + map size. state.zoom holds the
   actual pixel scale used everywhere; zoomLevel tracks which level.
   ===================================================================== */
let zoomLevel = 1;                      // 0=fit, 1=1x, 2=2x
const ZOOM_LABELS = ['0.5x','1x','2x'];
function fitScale(){
  const gw=state.gridWidth, gh=state.gridHeight;
  const sx = view.width  / ((gw+gh) * (TILE_W/2));
  const sy = view.height / ((gw+gh) * (TILE_H/2));
  return Math.max(0.04, Math.min(sx, sy) * 0.94);   // 0.94 = small margin
}
export function applyZoomLevel(){ state.zoom = zoomLevel===0 ? fitScale() : (zoomLevel===1?1:2); }
export function cycleZoom(){ zoomLevel=(zoomLevel+1)%3; applyZoomLevel(); }   // fit->1x->2x
export function stepZoom(dir){ zoomLevel=Math.max(0,Math.min(2,zoomLevel+dir)); applyZoomLevel(); }
export function zoomLabel(){ return ZOOM_LABELS[zoomLevel]; }

/* --- View rotation. Logical (gx,gy) -> rotated render coords (rx,ry)
   before projecting; inverted when picking. rot: 0=N 1=E 2=S 3=W. --- */
// MAP SIZE: maps are square presets, so a single N drives the rotation math.
export function rotateCoord(gx,gy,rot){
  const N=state.gridWidth;
  switch(rot&3){
    case 1: return [N-1-gy, gx];          // E
    case 2: return [N-1-gx, N-1-gy];      // S
    case 3: return [gy, N-1-gx];          // W
    default:return [gx,gy];               // N
  }
}
export function unrotateCoord(rx,ry,rot){
  const N=state.gridWidth;
  switch(rot&3){
    case 1: return [ry, N-1-rx];
    case 2: return [N-1-rx, N-1-ry];
    case 3: return [N-1-ry, rx];
    default:return [rx,ry];
  }
}

// grid -> screen (top vertex of tile diamond). Rotation/zoom/camera/elev aware.
export function isoToScreen(gx,gy,elev=0){
  const [rx,ry]=rotateCoord(gx,gy,state.rot);
  const z=state.zoom;
  const hw=(TILE_W/2)*z, hh=(TILE_H/2)*z;
  const sx=originX + (rx-ry)*hw + state.cam.x;
  const sy=originY + (rx+ry)*hh + state.cam.y - elev*ELEV*z;
  return [sx,sy];
}
// screen -> grid (ground plane), inverting current facing — used by input picking.
export function screenToIso(px,py){
  const z=state.zoom;
  const hw=(TILE_W/2)*z, hh=(TILE_H/2)*z;
  const ax=(px-originX-state.cam.x)/hw;
  const ay=(py-originY-state.cam.y)/hh;
  const frx=Math.floor((ax+ay)/2);
  const fry=Math.floor((ay-ax)/2);
  const flat=unrotateCoord(frx,fry,state.rot);   // flat-plane pick (ignores elevation)

  // ELEVATION PICK FIX: raised highland/hill tiles are drawn shifted up, so the
  // true tile under the cursor may be 1-2 tiles "behind" (smaller rx+ry) the flat
  // result. Test the flat tile + a bounded set of behind candidates against each
  // tile's *raised* top diamond and return the most-elevated tile that contains the
  // cursor; otherwise fall back to the flat pick. Bounded (<=6 candidates) so
  // drag-paint stays cheap even on 128x128 maps.
  let bx=flat[0], by=flat[1], bestE=-1, found=false;
  for(let da=0; da<=2; da++) for(let db=0; db<=2-da; db++){
    const [gx,gy]=unrotateCoord(frx-da, fry-db, state.rot);
    if(gx<0||gy<0||gx>=state.gridWidth||gy>=state.gridHeight) continue;
    const e=terrainElev(state.grid[gy][gx]);
    const [sx,sy]=isoToScreen(gx,gy, e/ELEV);    // raised top vertex (isoToScreen lifts by elev*ELEV*z)
    const cx=sx, cy=sy+hh;                        // raised diamond centre
    if(Math.abs(px-cx)/hw + Math.abs(py-cy)/hh <= 1 && e>bestE){
      bestE=e; bx=gx; by=gy; found=true;
    }
  }
  return found ? [bx,by] : flat;
}

// MAP SIZE: centre the isometric viewport on the grid's middle tile for any size
function recenter(){
  const hh=(TILE_H/2)*state.zoom;
  const cSum=((state.gridWidth-1)+(state.gridHeight-1))/2;   // (rx+ry) at grid centre
  originX = view.width/2;
  originY = view.height/2 - cSum*hh;
}

// flat diamond path (ground footprint of a tile)
function diamond(sx,sy){
  const z=state.zoom;
  const hw=(TILE_W/2)*z, hh=(TILE_H/2)*z;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx+hw, sy+hh);
  ctx.lineTo(sx, sy+2*hh);
  ctx.lineTo(sx-hw, sy+hh);
  ctx.closePath();
}

// TERRAIN: base ground colours by terrain type (drawn beneath zones/buildings)
const TERR_COL = {
  [TERRAIN.WETLAND]: '#36492f',
  [TERRAIN.LOWLAND]: '#1f3a1c',
  [TERRAIN.HIGHLAND]:'#3b4a24',
  [TERRAIN.HILL]:    '#5a4a32',
};
function groundColor(t){
  // TERRAIN: water/shallows shimmer between two tones every 2 seconds
  if(t.terrain===TERRAIN.WATER || t.terrain===TERRAIN.SHALLOWS){
    const phase = Math.floor(performance.now()/2000) % 2;
    if(t.terrain===TERRAIN.WATER)    return phase ? '#13314e' : '#163a5c';
    return phase ? '#2a6f8f' : '#2f7a9c';
  }
  if(t.type===T.ROAD) return '#2a2a30';
  if(t.type===T.PARK) return '#15521f';
  return TERR_COL[t.terrain] ?? '#1f3a1c';   // land terrain tint
}

/* ===== ASSET RENDERER ================================================
   Tiles are blitted from preloaded SVG sprites (assets.js) instead of
   redrawing canvas paths every frame. Key-selection lives here (not in
   assets.js). Each sprite is a 2x render of one tile (a tile is TILE_W*2
   px wide), with its base diamond bottom-aligned in the image; terrain
   sprites bake their own raised mesa. blitAsset() maps a sprite back to
   the current zoom (scale = zoom/2) and bottom-aligns it to the tile's
   ground vertex. Anything getAsset() can't supply falls back to the
   original path-drawing code, so partial asset sets never blank a tile.
   ===================================================================== */
// numeric terrain id -> sprite suffix (spec uses terrainType string; tiles
// store the numeric TERRAIN enum, so we map it here)
const TERRAIN_ASSET = {
  [TERRAIN.WATER]:'water', [TERRAIN.SHALLOWS]:'shallows', [TERRAIN.WETLAND]:'wetland',
  [TERRAIN.LOWLAND]:'lowland', [TERRAIN.HIGHLAND]:'highland', [TERRAIN.HILL]:'hill',
};
const ZONE_ASSET = { R:'residential', C:'commercial', I:'industrial' };
const DENSITY_ASSET = ['low','mid','high'];
const POWER_OUT_TINT = '#ff3b30';   // red multiply for unpowered (power-outage) tiles

function terrainAssetKey(t){
  const name = TERRAIN_ASSET[t.terrain];
  return name ? 'terrain_'+name : null;
}
// roadMask bits are in GRID space (N1 E2 S4 W8); the sprites were baked at the
// North view. Rotating the view moves each grid direction clockwise around the
// screen (N->E->S->W per step, verified against rotateCoord), so rotate the mask
// bits left by state.rot to pick the sprite that shows the right arms on screen.
function rotateMask(mask, rot){
  rot &= 3;
  return ((mask << rot) | (mask >> (4 - rot))) & 0b1111;
}
function roadAssetKey(t){
  const m = rotateMask(t.roadMask||0, state.rot);
  return 'road_mask_' + String(m).padStart(2,'0');
}
function buildingAssetKey(t,gx,gy,kind){
  const zone = ZONE_ASSET[kind];
  const dens = DENSITY_ASSET[t.level] || 'low';
  const variant = String.fromCharCode(97 + (((gx*31+gy*17)%3)+3)%3);   // a/b/c
  return `${zone}_${dens}_${variant}`;
}
// bridge tile -> span vs directional ramp (matches drawBridgeTile's detection)
function bridgeAssetKey(t,gx,gy){
  const br = (state.bridges||[]).find(b=>b.id===t.bridgeId);
  const dir = br && br.direction;
  const axis = dir==='EW' ? [[1,0],[-1,0]]
             : dir==='NS' ? [[0,-1],[0,1]]
             : [[1,0],[-1,0],[0,-1],[0,1]];
  const isLand = n => n && n.type!==T.WATER && !n.bridge;
  const landSides = axis.filter(([dx,dy]) => isLand(tileAt(gx+dx,gy+dy)));

  // 1-tile bridge: land on both ends → skip ramp sprites, use normal road tile
  if(dir && landSides.length === 2) return roadAssetKey(t);

  // ramp: exactly one land neighbour along the axis
  if(dir && landSides.length === 1){
    const [dx,dy] = landSides[0];
    const rot=state.rot&3;
    const rdx = rot===0?dx : rot===1?-dy : rot===2?-dx : dy;
    const rdy = rot===0?dy : rot===1?dx  : rot===2?-dy : -dx;
    const right = rdx-rdy > 0;
    const down  = rdx+rdy > 0;
    if( right && !down) return 'road_bridge_ramp_ns';
    if(!right &&  down) return 'road_bridge_ramp_ns2';
    if( right &&  down) return 'road_bridge_ramp_ew';
    return 'road_bridge_ramp_ew2';
  }

  // interior span
  if(dir){
    const eff = (state.rot & 1) ? (dir==='NS' ? 'EW' : 'NS') : dir;
    return 'road_bridge_span_' + eff.toLowerCase();
  }
  return 'road_bridge_span';
}

// spec-provided tint helper: draw image, then multiply a colour over its box
function drawTinted(ctx, img, x, y, w, h, color, alpha){
  ctx.drawImage(img, x, y, w, h);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.fillRect(x, y, w, h);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}
// place a tile sprite, bottom-aligned to a ground vertex. scale = zoom/2 maps
// the 2x sprite to the current zoom (img.width 128 -> TILE_W*zoom on screen).
function blitAsset(img, sx, groundBottomY, tint, alpha){
  const scale = state.zoom/2;
  const w = img.width*scale, h = img.height*scale;
  const x = sx - w/2, y = groundBottomY - h;
  if(tint) drawTinted(ctx, img, x, y, w, h, tint, alpha);
  else     ctx.drawImage(img, x, y, w, h);
}
/* ===== end ASSET RENDERER ============================================ */

/* --- Main draw: painter's algorithm in rotated order so depth sort
   stays correct at every facing. --- */
export function render(){
  ctx.clearRect(0,0,view.width,view.height);
  recenter();

  const z=state.zoom;
  const hw=(TILE_W/2)*z, hh=(TILE_H/2)*z;

  const GW=state.gridWidth, GH=state.gridHeight;   // MAP SIZE
  for(let s=0; s<=(GW-1)+(GH-1); s++){
    for(let rx=0; rx<GW; rx++){
      const ry=s-rx;
      if(ry<0||ry>=GH) continue;
      const [gx,gy]=unrotateCoord(rx,ry,state.rot);
      const t=state.grid[gy][gx];
      const [sx,sy0]=isoToScreen(gx,gy,0);
      // ELEVATED TERRAIN: raise the top face (and any content) by the terrain's height
      const sy = sy0 - terrainElev(t)*z;

      if(sx< -hw*2 || sx> view.width+hw*2 || sy< -hh*4 || sy> view.height+hh*4) continue;

      drawGroundTile(sx,sy,t,gx,gy);   // TERRAIN TOOLS: gx,gy for coast fringe

      // water overlay tint (under buildings, over ground)
      if(state.waterOverlay && t.water){
        diamond(sx,sy);
        ctx.fillStyle='rgba(43,180,221,0.35)';
        ctx.fill();
      }
      // DEMAND SYSTEM: land-value overlay (green = high, red = low)
      if(state.lvOverlay){
        const g=clamp((t.land-20)/120,0,1);
        diamond(sx,sy);
        ctx.fillStyle=`rgba(${Math.round(235*(1-g))},${Math.round(210*g)},45,0.40)`;
        ctx.fill();
      }

      drawTileContent(sx,sy,t,gx,gy);

      // hover highlight
      if(state.hover.x===gx && state.hover.y===gy){
        diamond(sx,sy);
        ctx.fillStyle='rgba(232,232,232,0.18)';
        ctx.fill();
        ctx.strokeStyle='#e8e8e8'; ctx.lineWidth=1.5; ctx.stroke();
      }

      // PLACEMENT MODE: highlight the NxN block under the cursor
      if(state.placementMode && state.hover.x !== undefined){
        const pm   = state.placementMode;
        const size = pm.size || 3;
        const half = Math.floor(size / 2);
        const gw   = state.gridWidth, gh = state.gridHeight;
        const hx   = state.hover.x,   hy = state.hover.y;
        // Clamp origin so the whole NxN block stays in-grid (same as input.js)
        const ox = Math.max(0, Math.min(hx - half, gw - size));
        const oy = Math.max(0, Math.min(hy - half, gh - size));
        if(gx >= ox && gx < ox + size && gy >= oy && gy < oy + size){
          diamond(sx,sy);
          ctx.fillStyle='rgba(255,140,0,0.32)';
          ctx.fill();
          ctx.strokeStyle='rgba(255,140,0,0.85)'; ctx.lineWidth=1.5; ctx.stroke();
        }
      }
    }
  }
  drawDragPreview();
}

// ELEVATED TERRAIN: raised-terrain height in px @ zoom 1 (highland 6, hill 12)
function terrainElev(t){ return t.terrain===TERRAIN.HILL ? 12 : t.terrain===TERRAIN.HIGHLAND ? 6 : 0; }

function drawGroundTile(sx,sy,t,gx,gy){
  const z=state.zoom;
  const hw=(TILE_W/2)*z, hh=(TILE_H/2)*z;

  // ASSET RENDERER: at >=1x draw the terrain sprite (its raised mesa is baked
  // in, so bottom-align to the FLAT ground vertex); coast fringe stays code-drawn
  // on top. 0.5x and any missing sprite fall through to the path code below.
  if(z>=1){
    const img = getAsset(terrainAssetKey(t));
    if(img){
      const groundBottom = sy + terrainElev(t)*z + 2*hh;   // un-raise: elevation is baked in
      blitAsset(img, sx, groundBottom);
      if(t.coast && t.type!==T.WATER && gx!==undefined) drawCoastFringe(sx,sy,gx,gy);
      return;
    }
  }

  // ELEVATED TERRAIN: draw a solid block (left+right walls down to ground) so the
  // raised top face reads as a grounded mesa rather than a floating diamond.
  const elev = terrainElev(t)*z;
  if(elev>0){
    const top=groundColor(t);
    const L=[sx-hw, sy+hh], B=[sx, sy+2*hh], R=[sx+hw, sy+hh];   // front-left/-right corners + front corner
    const Lg=[L[0], L[1]+elev], Bg=[B[0], B[1]+elev], Rg=[R[0], R[1]+elev];
    // left wall — top colour darkened 25%
    ctx.beginPath(); ctx.moveTo(L[0],L[1]); ctx.lineTo(B[0],B[1]); ctx.lineTo(Bg[0],Bg[1]); ctx.lineTo(Lg[0],Lg[1]); ctx.closePath();
    ctx.fillStyle=_mix(top,'#000000',0.25); ctx.fill();
    // right wall — top colour darkened 40% (shaded)
    ctx.beginPath(); ctx.moveTo(R[0],R[1]); ctx.lineTo(B[0],B[1]); ctx.lineTo(Bg[0],Bg[1]); ctx.lineTo(Rg[0],Rg[1]); ctx.closePath();
    ctx.fillStyle=_mix(top,'#000000',0.40); ctx.fill();
  }

  diamond(sx,sy);
  ctx.fillStyle=groundColor(t);
  ctx.fill();
  ctx.strokeStyle='rgba(0,0,0,0.35)';
  ctx.lineWidth=1; ctx.stroke();

  // COAST FIX: sandy fringe only on land (coast-flagged) tiles — never on
  // shallows or deep water (both are type WATER), which get tint only.
  if(t.coast && t.type!==T.WATER && gx!==undefined) drawCoastFringe(sx,sy,gx,gy);

  if(t.type===T.WATER){
    ctx.strokeStyle='rgba(60,140,200,0.4)';
    ctx.beginPath();
    ctx.moveTo(sx-hw*0.4, sy+hh); ctx.lineTo(sx, sy+hh*0.7);
    ctx.stroke();
  }
}

// TERRAIN TOOLS: draw a thin sandy fringe (+ wave line) on each diamond edge that
// faces a deep-water neighbour. Drawn after the ground fill, before zone/buildings.
function drawCoastFringe(sx,sy,gx,gy){
  const z=state.zoom, hw=(TILE_W/2)*z, hh=(TILE_H/2)*z;
  // diamond edges keyed by the facing direction (corner a -> b)
  const edges=[
    {a:[sx,sy],        b:[sx+hw,sy+hh], mid:[sx+hw/2, sy+hh/2]},   // toward +? (use dot)
    {a:[sx+hw,sy+hh],  b:[sx,sy+2*hh],  mid:[sx+hw/2, sy+1.5*hh]},
    {a:[sx,sy+2*hh],   b:[sx-hw,sy+hh], mid:[sx-hw/2, sy+1.5*hh]},
    {a:[sx-hw,sy+hh],  b:[sx,sy],       mid:[sx-hw/2, sy+hh/2]},
  ];
  const C=[sx, sy+hh];
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const n=tileAt(gx+dx,gy+dy);
    if(!n || n.terrain!==TERRAIN.WATER) continue;
    const [nsx,nsy]=isoToScreen(gx+dx,gy+dy,0); const NC=[nsx,nsy+hh];
    const v=[NC[0]-C[0], NC[1]-C[1]];
    let best=-Infinity, be=null;
    edges.forEach(e=>{ const ed=[e.mid[0]-C[0],e.mid[1]-C[1]]; const d=ed[0]*v[0]+ed[1]*v[1]; if(d>best){best=d; be=e;} });
    if(!be) continue;
    ctx.strokeStyle='rgba(255,255,255,0.15)'; ctx.lineWidth=2.5*z;        // sandy fringe
    ctx.beginPath(); ctx.moveTo(be.a[0],be.a[1]); ctx.lineTo(be.b[0],be.b[1]); ctx.stroke();
    ctx.strokeStyle='rgba(255,255,255,0.15)'; ctx.lineWidth=1*z;   // wave line just inside
    const ix=(be.mid[0]-C[0])*0.18, iy=(be.mid[1]-C[1])*0.18;
    ctx.beginPath(); ctx.moveTo(be.a[0]-ix,be.a[1]-iy); ctx.lineTo(be.b[0]-ix,be.b[1]-iy); ctx.stroke();
  }
}

function drawTileContent(sx,sy,t,gx,gy){
  // TERRAIN TOOLS: never draw a building/zone sprite on a hill tile
  if(t.terrain===TERRAIN.HILL && isZone(t.type)) return;
  switch(t.type){
    case T.ROAD:       drawRoad(sx,sy,gx,gy,t); break; // ROAD CONNECTORS
    case T.POWERLINE:  drawPowerLine(sx,sy,t); break;
    case T.POWERPLANT: drawPowerPlantTile(sx,sy,t); drawSmoke(sx,sy,118); break; // ASSET RENDERER
    case T.PUMP:       drawPumpTile(sx,sy,t); break;                            // ASSET RENDERER
    case T.PARK:       drawPark(sx,sy); break;
    case T.RES:        drawZoneBuilding(sx,sy,t,gx,gy,'R'); break; // BUILDING SPRITES
    case T.COM:        drawZoneBuilding(sx,sy,t,gx,gy,'C'); break; // BUILDING SPRITES
    case T.IND:        drawZoneBuilding(sx,sy,t,gx,gy,'I'); break; // BUILDING SPRITES
  }
  if(isZone(t.type) && t.pop===0 && t.level===0 && (!t.powered || !t.water || !t.nearRoad)){
    drawNeedIcon(sx,sy,t);
  }
  if(t.onFire>0) drawFire(sx,sy);
  // SCENARIOS: contract zone marker — overlay on every locked tile
  if(t.contractId){
    const img=getAsset('contract_generic');
    if(img){
      const z=state.zoom, hh=(TILE_H/2)*z;
      blitAsset(img, sx, sy+2*hh);
    }
  }
}

/* ===== ROAD CONNECTORS ================================================
   Topology-aware road rendering. tile.roadMask (bits N1 E2 S4 W8) selects
   which of the 4 arms exist, yielding all 16 connector shapes (isolated
   pad, dead-ends, straights, corners, T-junctions, 4-way). Open edges drop
   their curb and gain a dashed centre line; bridges sit on pillars; edge
   tiles draw a highway "EXIT" apron. Geometry is derived from neighbour
   screen positions so it stays correct under view rotation.
   ===================================================================== */
function popcount(n){ let c=0; while(n){ c+=n&1; n>>=1; } return c; }
function isEdgeTile(gx,gy){ return gx===0||gy===0||gx===state.gridWidth-1||gy===state.gridHeight-1; }

function drawRoad(sx,sy,gx,gy,t){
  const z=state.zoom, hw=(TILE_W/2)*z, hh=(TILE_H/2)*z;
  const mask=t.roadMask||0;

  // ZOOM LEVELS: at 0.5x roads collapse to a flat grey diamond (no detail)
  if(state.zoom<1){ diamond(sx,sy); ctx.fillStyle='#555'; ctx.fill(); return; }

  // ASSET RENDERER: bridge tiles -> span/ramp sprite (deck + pillars baked in);
  // road tiles -> connector sprite. EXIT sign for edge tiles stays code-drawn on
  // top. Missing sprite -> fall through to the original path code.
  if(t.bridge){
    const bimg = getAsset(bridgeAssetKey(t,gx,gy));
    if(bimg){
      blitAsset(bimg, sx, sy + 2*hh);
      if(isEdgeTile(gx,gy)) drawExitSign(sx, sy);
      return;
    }
    drawBridgeTile(sx,sy,gx,gy,t,mask); return;   // fallback
  }
  {
    const rimg = getAsset(roadAssetKey(t));
    if(rimg){
      blitAsset(rimg, sx, sy + 2*hh);
      if(isEdgeTile(gx,gy)) drawExitSign(sx, sy);
      return;
    }
  }

  // flush road lifts a hair off the ground
  const lift=1.2*z;
  const topY=sy-lift;
  const C=[sx, topY+hh];

  // road surface = the (raised) tile diamond
  diamond(sx,topY); ctx.fillStyle='#555'; ctx.fill();

  // four diamond edges (corner pts + midpoint)
  const edges=[
    {a:[sx,topY],          b:[sx+hw,topY+hh],   mid:[sx+hw/2, topY+hh/2]},   // TR
    {a:[sx+hw,topY+hh],    b:[sx,topY+2*hh],    mid:[sx+hw/2, topY+1.5*hh]}, // RB
    {a:[sx,topY+2*hh],     b:[sx-hw,topY+hh],   mid:[sx-hw/2, topY+1.5*hh]}, // BL
    {a:[sx-hw,topY+hh],    b:[sx,topY],         mid:[sx-hw/2, topY+hh/2]},   // TL
  ];
  // match each connected grid neighbour to the diamond edge facing it
  const dirs=[[0,-1,1],[1,0,2],[0,1,4],[-1,0,8]];
  const open=[false,false,false,false], arms=[];
  for(const [dx,dy,bit] of dirs){
    if(!(mask&bit)) continue;
    const [nsx,nsy]=isoToScreen(gx+dx,gy+dy,0); const NC=[nsx,nsy+hh];
    const v=[NC[0]-C[0], NC[1]-C[1]];
    let best=-Infinity, bi=0;
    edges.forEach((e,i)=>{ const ed=[e.mid[0]-C[0], e.mid[1]-C[1]];
      const d=ed[0]*v[0]+ed[1]*v[1]; if(d>best){best=d;bi=i;} });
    open[bi]=true; arms.push(edges[bi].mid);
  }
  // curb (#888) on every closed edge
  ctx.strokeStyle='#888'; ctx.lineWidth=1.5*z;
  edges.forEach((e,i)=>{ if(!open[i]){ ctx.beginPath(); ctx.moveTo(e.a[0],e.a[1]); ctx.lineTo(e.b[0],e.b[1]); ctx.stroke(); } });
  // dashed white centre line toward each arm
  ctx.strokeStyle='#fff'; ctx.lineWidth=1*z; ctx.setLineDash([3*z,3*z]);
  arms.forEach(m=>{ ctx.beginPath(); ctx.moveTo(C[0],C[1]); ctx.lineTo(m[0],m[1]); ctx.stroke(); });
  ctx.setLineDash([]);
  // intersection marker (3/4-way) ; isolated pad (mask 0) gets an inner square
  if(popcount(mask)>=3){ ctx.fillStyle='rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(C[0],C[1],2.2*z,0,Math.PI*2); ctx.fill(); }
  else if(mask===0){ ctx.strokeStyle='#888'; ctx.lineWidth=1*z; ctx.strokeRect(C[0]-hw*0.28, C[1]-hh*0.28, hw*0.56, hh*0.56); }

  // EXIT FIX: edge tiles render as a normal road connector + a small EXIT sign on top
  if(isEdgeTile(gx,gy)) drawExitSign(sx,topY);
}

// EXIT FIX: just a small green "EXIT" sign plate above the edge tile — no apron,
// no stripes, no special road shape.
function drawExitSign(sx,topY){
  const z=state.zoom, hh=(TILE_H/2)*z;
  const cx=sx, sgW=22*z, sgH=10*z, sgx=cx-sgW/2, sgy=topY-16*z;
  ctx.fillStyle='#0a7a2a'; ctx.fillRect(sgx,sgy,sgW,sgH);
  ctx.strokeStyle='#fff'; ctx.lineWidth=1*z; ctx.strokeRect(sgx,sgy,sgW,sgH);
  ctx.fillStyle='#fff'; ctx.font=`${6*z}px 'JetBrains Mono', monospace`; ctx.textAlign='center';
  ctx.fillText('EXIT', cx, sgy+7*z); ctx.textAlign='start';
}

/* ===== BRIDGE RENDERING ==============================================
   A bridge tile draws its own elevated deck. Per-corner heights let the
   two end (ramp) tiles slope symmetrically from ground (land side) up to
   full deck height (water side); interior tiles sit flat at full height.
   Pillars: one centred pair per full water tile only, drawn BEFORE the
   deck so they read as behind it. Railings: a continuous low wall along
   both side (closed) edges of every span tile, following the ramp slope,
   drawn AFTER the deck so it sits on top.
   ==================================================================== */
const BRIDGE_H = 10;   // deck height above water (px @ zoom 1)
const RAIL_H   = 4;    // railing wall height (px @ zoom 1)
function drawBridgeTile(sx,sy,gx,gy,t,mask){
  const z=state.zoom, hw=(TILE_W/2)*z, hh=(TILE_H/2)*z;
  const H=BRIDGE_H*z, RAIL=RAIL_H*z;

  // ground corner positions: 0=top 1=right 2=bottom 3=left ; edges join corner pairs
  const P=[[sx,sy],[sx+hw,sy+hh],[sx,sy+2*hh],[sx-hw,sy+hh]];
  const Ec=[[0,1],[1,2],[2,3],[3,0]];
  const centerG=[sx, sy+hh];
  const EmidG=Ec.map(([a,b])=>[(P[a][0]+P[b][0])/2,(P[a][1]+P[b][1])/2]);
  const facingEdge=(dx,dy)=>{ const [nsx,nsy]=isoToScreen(gx+dx,gy+dy,0); const NC=[nsx,nsy+hh];
    const v=[NC[0]-centerG[0],NC[1]-centerG[1]]; let best=-Infinity, bi=0;
    EmidG.forEach((m,i)=>{ const e=[m[0]-centerG[0],m[1]-centerG[1]]; const d=e[0]*v[0]+e[1]*v[1]; if(d>best){best=d;bi=i;} });
    return bi; };

  // ramp detection: land approaches along the span axis pull their facing edge to ground
  const br=(state.bridges||[]).find(b=>b.id===t.bridgeId);
  const axis = br && br.direction==='EW' ? [[1,0],[-1,0]]
             : br && br.direction==='NS' ? [[0,-1],[0,1]]
             : [[1,0],[-1,0],[0,-1],[0,1]];
  const cornerH=[H,H,H,H];
  let isRamp=false;
  for(const [dx,dy] of axis){
    const n=tileAt(gx+dx,gy+dy);
    if(!n || n.type===T.WATER || n.bridge) continue;       // land side -> ramp down
    isRamp=true;
    const ei=facingEdge(dx,dy);
    cornerH[Ec[ei][0]]=0; cornerH[Ec[ei][1]]=0;
  }

  // --- pillars: only full water tiles (not ramps), drawn before the deck ---
  if(!isRamp){
    ctx.strokeStyle='#2e2e36'; ctx.lineWidth=2*z;
    for(const px of [sx-hw*0.4, sx+hw*0.4]){
      ctx.beginPath(); ctx.moveTo(px, sy+hh - H); ctx.lineTo(px, sy+1.7*hh); ctx.stroke();
    }
  }

  // lifted corner / midpoint / centre positions
  const S=P.map((p,i)=>[p[0], p[1]-cornerH[i]]);
  const EmidS=Ec.map(([a,b],i)=>[EmidG[i][0], EmidG[i][1]-(cornerH[a]+cornerH[b])/2]);
  const centerH=(cornerH[0]+cornerH[1]+cornerH[2]+cornerH[3])/4;
  const centerS=[centerG[0], centerG[1]-centerH];

  // --- road surface (sloped deck) ---
  ctx.beginPath(); ctx.moveTo(S[0][0],S[0][1]);
  for(let i=1;i<4;i++) ctx.lineTo(S[i][0],S[i][1]);
  ctx.closePath(); ctx.fillStyle='#555'; ctx.fill();

  // --- connector mask: dashed centre lines + intersection dot (heights follow slope) ---
  const dirs=[[0,-1,1],[1,0,2],[0,1,4],[-1,0,8]];
  const open=[false,false,false,false], arms=[];
  for(const [dx,dy,bit] of dirs){ if(!(mask&bit)) continue;
    const ei=facingEdge(dx,dy); open[ei]=true; arms.push(EmidS[ei]); }
  ctx.strokeStyle='#fff'; ctx.lineWidth=1*z; ctx.setLineDash([3*z,3*z]);
  arms.forEach(m=>{ ctx.beginPath(); ctx.moveTo(centerS[0],centerS[1]); ctx.lineTo(m[0],m[1]); ctx.stroke(); });
  ctx.setLineDash([]);
  if(popcount(mask)>=3){ ctx.fillStyle='rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(centerS[0],centerS[1],2.2*z,0,Math.PI*2); ctx.fill(); }

  // --- railings: low wall along each side (closed) edge, on top of the deck ---
  for(let i=0;i<4;i++){ if(open[i]) continue;
    const [a,b]=Ec[i]; const at=S[a], bt=S[b];
    const ar=[at[0], at[1]-RAIL], brp=[bt[0], bt[1]-RAIL];
    ctx.beginPath(); ctx.moveTo(at[0],at[1]); ctx.lineTo(bt[0],bt[1]);
    ctx.lineTo(brp[0],brp[1]); ctx.lineTo(ar[0],ar[1]); ctx.closePath();
    ctx.fillStyle='#b0b0b0'; ctx.fill();
    ctx.strokeStyle='#888'; ctx.lineWidth=1*z;
    ctx.beginPath(); ctx.moveTo(ar[0],ar[1]); ctx.lineTo(brp[0],brp[1]); ctx.stroke();   // dark cap line on top
  }

  // EXIT sign for bridge tiles that reach the map edge
  if(isEdgeTile(gx,gy)) drawExitSign(sx, sy-H);
}
/* ===== end BRIDGE RENDERING ========================================== */
/* ===== end ROAD CONNECTORS =========================================== */

function drawPowerLine(sx,sy,t){
  const z=state.zoom, hh=(TILE_H/2)*z;
  const cx=sx, cy=sy+hh;
  ctx.strokeStyle= t.powered? '#ffd23f':'#665';
  ctx.lineWidth=1.5*z;
  ctx.beginPath();
  ctx.moveTo(cx, cy-2); ctx.lineTo(cx, cy-12*z);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx-6*z, cy-10*z); ctx.lineTo(cx+6*z, cy-10*z);
  ctx.stroke();
}

// generic extruded box building of given height (units)
function drawBox(sx,sy,h,topCol,sideCol,powered){
  const z=state.zoom, hw=(TILE_W/2)*z, hh=(TILE_H/2)*z;
  const H=h*ELEV*z*1.4;
  const cx=sx, cyTop=sy;
  const right=[sx+hw, sy+hh];
  const left =[sx-hw, sy+hh];
  const bottom=[sx, sy+2*hh];

  ctx.beginPath();
  ctx.moveTo(right[0], right[1]-H);
  ctx.lineTo(bottom[0],bottom[1]-H);
  ctx.lineTo(bottom[0],bottom[1]);
  ctx.lineTo(right[0], right[1]);
  ctx.closePath();
  ctx.fillStyle=shade(sideCol,-25); ctx.fill();

  ctx.beginPath();
  ctx.moveTo(left[0], left[1]-H);
  ctx.lineTo(bottom[0],bottom[1]-H);
  ctx.lineTo(bottom[0],bottom[1]);
  ctx.lineTo(left[0], left[1]);
  ctx.closePath();
  ctx.fillStyle=shade(sideCol,-5); ctx.fill();

  ctx.beginPath();
  ctx.moveTo(cx, cyTop-H);
  ctx.lineTo(right[0], right[1]-H);
  ctx.lineTo(bottom[0], bottom[1]-H);
  ctx.lineTo(left[0], left[1]-H);
  ctx.closePath();
  ctx.fillStyle=topCol; ctx.fill();
  ctx.strokeStyle='rgba(0,0,0,0.4)'; ctx.stroke();

  if(powered){
    ctx.fillStyle='rgba(255,210,63,0.8)';
    for(let i=0;i<h;i++){
      ctx.fillRect(cx-2*z, cyTop-H+6*z+i*6*z, 2*z, 2*z);
    }
  }
}

/* ===== BUILDING SPRITES ================================================
   Procedural, seeded building variety. Each zone+density picks one of
   several silhouette variants deterministically from grid coords, so a
   tile always draws the same building. Volumes are stacked isometric
   boxes via canvas paths; each gets a soft drop shadow. Newly placed
   zones show a scaffold for the first 2 sim months.
   Painter's note: the main render loop already draws strictly back-to-
   front by (rx+ry); building height extends upward (−y), which only
   overlaps tiles drawn earlier (further back), so tall towers correctly
   overhang the tiles behind them with no extra sorting needed.
   ===================================================================== */

// per-zone palettes — CYBERPUNK ZONING: R weathered green-gray (moss/algae
// accents) / C neon blue-violet office glass / I yellow-dark industrial
// (cold gray + rust wear accents)
// CONTRAST RATIO: base faces are pushed dark (top is a dark-mid plane, right
// darker, left = near-black shadow face) so the building reads as a dark mass.
// `win` stays bright — it is the ~15% lit highlight, drawn as thin strokes.
const PAL = {
  R:{ top:'#3f4a3a', right:'#2e362b', left:'#1b211a', roof:'#262d24', roof2:'#2f382c',
      win:'#ffe2a6', door:'#181d16', line:'rgba(0,12,4,0.45)', trim:'#43503e' },
  C:{ top:'#453f6b', right:'#2f2956', left:'#191430', roof:'#352f5a', roof2:'#2b264c',
      win:'#cda9ff', door:'#161228', line:'rgba(12,0,40,0.42)', trim:'#9a93c0', accent:'#7a4ee0' },
  I:{ top:'#5a4a16', right:'#403510', left:'#261f0a', roof:'#272927', roof2:'#313431',
      win:'#ffb84a', rust:'#52301c', rust2:'#633a22', metal:'#363833', line:'rgba(0,0,0,0.50)' }
};
const DARK_WIN = '#23232b';   // unlit window
const FRAC = [0.40, 0.65, 0.96];          // tile-height fraction per density level
const HPX  = [34, 60, 92];                // pixel height per density level (×zoom)

// construction timer: tile object -> sim month first seen (survives leveling,
// resets when a tile is bulldozed/replaced because that makes a new object).
const buildAge = new WeakMap();

// unit-square -> screen point on the tile diamond, lifted by h pixels.
// u,v may exceed [0,1] to let high-density footprints overhang the tile.
function bp(sx,sy,u,v,h){
  const z=state.zoom, hw=(TILE_W/2)*z, hh=(TILE_H/2)*z;
  return [ sx + (u-v)*hw, sy + (u+v)*hh - h ];
}
function poly(pts){
  ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]);
  for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]);
  ctx.closePath();
}
function lerpP(a,b,t){ return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t]; }

// soft drop shadow under a footprint (offset 2px down-right, 20% black)
function buildingShadow(sx,sy,u0,v0,u1,v1){
  ctx.save(); ctx.translate(2,2);
  poly([bp(sx,sy,u0,v0,0),bp(sx,sy,u1,v0,0),bp(sx,sy,u1,v1,0),bp(sx,sy,u0,v1,0)]);
  ctx.fillStyle='rgba(0,0,0,0.20)'; ctx.fill();
  ctx.restore();
}

// extruded box; returns its 8 corner points (A..D base/top). Front corner is C.
function box(sx,sy,u0,v0,u1,v1,base,H,pal,stroke=true){
  const A0=bp(sx,sy,u0,v0,base),B0=bp(sx,sy,u1,v0,base),C0=bp(sx,sy,u1,v1,base),D0=bp(sx,sy,u0,v1,base);
  const A1=bp(sx,sy,u0,v0,base+H),B1=bp(sx,sy,u1,v0,base+H),C1=bp(sx,sy,u1,v1,base+H),D1=bp(sx,sy,u0,v1,base+H);
  poly([B0,C0,C1,B1]); ctx.fillStyle=pal.right; ctx.fill(); if(stroke){ctx.strokeStyle=pal.line;ctx.lineWidth=1;ctx.stroke();}
  poly([D0,C0,C1,D1]); ctx.fillStyle=pal.left;  ctx.fill(); if(stroke){ctx.stroke();}
  poly([A1,B1,C1,D1]); ctx.fillStyle=pal.top;   ctx.fill(); if(stroke){ctx.stroke();}
  return {A0,B0,C0,D0,A1,B1,C1,D1};
}

/* ===== LIT STRIPES (replaces the old window grid) ====================
   WINDOW SHAPE: lit windows are no longer filled rect panes — each face
   gets a set of parallel STROKED lines (constraint 3+4). Direction is
   chosen per building from the existing variant selector k = seed%3
   (k===0 -> horizontal bands, else vertical columns) via _stripeSeed,
   which drawZoneBuilding sets before dispatching. LIGHT VARIATION: every
   stripe's colour is jittered ±5% hue / ±5% value, and its stroke-width
   and stroke-dasharray are perturbed — all deterministically from the
   seed (constraint 2), so renders/exports stay reproducible.
   ===================================================================== */
let _stripeSeed = 0;   // set per building by drawZoneBuilding (= gx*31+gy*17)

// deterministic 0..1 hash from an integer (no global RNG -> reproducible)
function srand(n){ const x=Math.sin((n>>>0)*12.9898+1.0)*43758.5453; return x-Math.floor(x); }
// horizontal (true) vs vertical stripes, picked by the k=seed%3 variant selector
function stripeHoriz(seed){ return (((seed%3)+3)%3)===0; }

// hex/rgb -> [h,s,l] (0..1) ; supports '#rgb','#rrggbb','rgb(...)'
function _toRGB(col){
  if(col[0]==='#'){ let h=col.slice(1);
    if(h.length===3) h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    const c=parseInt(h,16); return [c>>16&255,c>>8&255,c&255]; }
  const m=col.match(/(\d+(?:\.\d+)?)/g); return m?[+m[0],+m[1],+m[2]]:[255,255,255];
}
function _rgb2hsl(r,g,b){ r/=255;g/=255;b/=255;
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn; let h=0,s=0,l=(mx+mn)/2;
  if(d){ s=l>0.5?d/(2-mx-mn):d/(mx+mn);
    h = mx===r ? ((g-b)/d+(g<b?6:0)) : mx===g ? ((b-r)/d+2) : ((r-g)/d+4); h/=6; }
  return [h,s,l];
}
function _hsl2str(h,s,l){
  const hue2=(p,q,t)=>{ if(t<0)t+=1; if(t>1)t-=1;
    if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; };
  let r,g,b;
  if(s===0){ r=g=b=l; }
  else{ const q=l<0.5?l*(1+s):l+s-l*s, p=2*l-q;
    r=hue2(p,q,h+1/3); g=hue2(p,q,h); b=hue2(p,q,h-1/3); }
  return `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`;
}
// jitter a colour ±5% hue and ±5% lightness, deterministically from seed
function jitterCol(col,seed){
  const [r,g,b]=_toRGB(col); let [h,s,l]=_rgb2hsl(r,g,b);
  h=(h+(srand(seed)*2-1)*0.05+1)%1;
  l=clamp(l*(1+(srand(seed+97)*2-1)*0.05),0,1);
  return _hsl2str(h,s,l);
}

// parallel stroked lit stripes across a quad face (TL,TR,BR,BL screen pts).
// `cols`/`rows` carry over from the old grid as the across/along stripe counts.
function faceWindows(TL,TR,BR,BL,cols,rows,col,inset=0.18,faceOff=0){
  const z=state.zoom;
  const horiz=stripeHoriz(_stripeSeed);
  const n=Math.max(1, horiz ? rows : cols);     // stripes run along the chosen axis
  for(let i=0;i<n;i++){
    const p=inset+(i+0.5)/n*(1-2*inset);        // position across the face
    let a,b;
    if(horiz){ a=lerpP(TL,BL,p); b=lerpP(TR,BR,p); }   // horizontal band L->R at height p
    else     { a=lerpP(TL,TR,p); b=lerpP(BL,BR,p); }   // vertical column T->B at width p
    const sd=(_stripeSeed+faceOff+i*7+(horiz?211:101))>>>0;
    ctx.strokeStyle=jitterCol(col,sd);
    ctx.lineWidth=(0.7+srand(sd+3)*1.7)*z;             // seeded irregular width
    ctx.setLineDash([(1.5+srand(sd+5)*3.5)*z, (1.0+srand(sd+9)*2.5)*z]);  // seeded dash
    ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke();
  }
  ctx.setLineDash([]);
}
// lit stripes on both visible faces of a box result `v` (faces get distinct seeds)
function boxWindows(v,cols,rows,col){
  faceWindows(v.B1,v.C1,v.C0,v.B0,cols,rows,col,0.18,0);    // right face
  faceWindows(v.D1,v.C1,v.C0,v.D0,cols,rows,col,0.18,37);   // left face
}

// hip roof (4-slope, apex at centre) — only the 2 front slopes are visible
function hipRoof(sx,sy,u0,v0,u1,v1,base,peak,col1,col2){
  const apex=bp(sx,sy,(u0+u1)/2,(v0+v1)/2,base+peak);
  const B=bp(sx,sy,u1,v0,base),C=bp(sx,sy,u1,v1,base),D=bp(sx,sy,u0,v1,base);
  poly([B,C,apex]); ctx.fillStyle=col2; ctx.fill(); ctx.strokeStyle='rgba(0,0,0,0.3)'; ctx.stroke();
  poly([D,C,apex]); ctx.fillStyle=col1; ctx.fill(); ctx.stroke();
}
// gable roof (ridge along u at mid-v): front slope + right gable end
function gableRoof(sx,sy,u0,v0,u1,v1,base,peak,col1,col2){
  const vm=(v0+v1)/2;
  const r0=bp(sx,sy,u0,vm,base+peak), r1=bp(sx,sy,u1,vm,base+peak);
  const B=bp(sx,sy,u1,v0,base),C=bp(sx,sy,u1,v1,base),D=bp(sx,sy,u0,v1,base);
  poly([D,C,r1,r0]); ctx.fillStyle=col1; ctx.fill(); ctx.strokeStyle='rgba(0,0,0,0.3)'; ctx.stroke();
  poly([B,C,r1]);    ctx.fillStyle=col2; ctx.fill(); ctx.stroke();
}
// small chimney / stack box centred at (u,v)
function stack(sx,sy,u,v,base,h,col,s=0.06){
  box(sx,sy,u-s,v-s,u+s,v+s,base,h,{top:col,right:shade(col,-15),left:shade(col,-35),line:'rgba(0,0,0,0.4)'});
}
// rooftop antenna with red tip
function antenna(sx,sy,u,v,base,h){
  const z=state.zoom, p0=bp(sx,sy,u,v,base), p1=bp(sx,sy,u,v,base+h);
  ctx.strokeStyle='#bbb'; ctx.lineWidth=1*z;
  ctx.beginPath(); ctx.moveTo(p0[0],p0[1]); ctx.lineTo(p1[0],p1[1]); ctx.stroke();
  ctx.fillStyle='#ff5b3b'; ctx.beginPath(); ctx.arc(p1[0],p1[1],1.6*z,0,Math.PI*2); ctx.fill();
}
// shop awning: a short striped sloped band on the front-left face
function awning(sx,sy,u0,u1,vF,base,col){
  const z=state.zoom;
  const a=bp(sx,sy,u0,vF,base), b=bp(sx,sy,u1,vF,base);
  const a2=bp(sx,sy,u0,vF+0.18,base-5*z), b2=bp(sx,sy,u1,vF+0.18,base-5*z);
  poly([a,b,b2,a2]); ctx.fillStyle=col; ctx.fill();
  ctx.strokeStyle='#fff'; ctx.lineWidth=1*z;
  for(let i=1;i<4;i++){ const t=i/4; const p=lerpP(a,b,t),q=lerpP(a2,b2,t);
    ctx.beginPath(); ctx.moveTo(p[0],p[1]); ctx.lineTo(q[0],q[1]); ctx.stroke(); }
}

// ---- dispatcher -------------------------------------------------------
function drawZoneBuilding(sx,sy,t,gx,gy,kind){
  // ZOOM LEVELS: at fully-zoomed-out (0.5x) draw only a flat base diamond in zone colour
  if(state.zoom<1){
    diamond(sx,sy);
    ctx.fillStyle = kind==='R'?'#7caa6b' : kind==='C'?'#8a5cf6' : '#d9a72c';
    ctx.fill();
    return;
  }
  // LOADED CITY SCAFFOLD FIX: a tile that's already developed (loaded from a save)
  // registers as built 2 months ago so it skips the construction scaffold; genuinely
  // new placements (pop 0, level 0) still show the 2-month scaffold.
  if(!buildAge.has(t)) buildAge.set(t, (t.pop>0||t.level>0) ? state.month-2 : state.month);
  const elapsed = state.month - buildAge.get(t);
  if(elapsed < 2){ drawScaffold(sx,sy); return; }        // 2-month construction
  if(t.pop===0 && t.level===0){ drawVacantLot(sx,sy,kind); return; }
  // ASSET RENDERER: finished building -> SVG variant. Unpowered tiles get a red
  // multiply tint (power-outage overlay state). Missing sprite -> path fallback.
  const aimg = getAsset(buildingAssetKey(t,gx,gy,kind));
  if(aimg){
    const hh=(TILE_H/2)*state.zoom;
    if(!t.powered) blitAsset(aimg, sx, sy + 2*hh, POWER_OUT_TINT, 0.45);
    else           blitAsset(aimg, sx, sy + 2*hh);
    return;
  }
  const seed = (gx*31 + gy*17);                          // deterministic variant
  _stripeSeed = seed;                                    // LIT STRIPES: drives dir + jitter
  const P = PAL[kind];
  const lit = t.powered ? P.win : DARK_WIN;
  if(kind==='R') drawRes(sx,sy,t.level,seed,P,lit);
  else if(kind==='C') drawCom(sx,sy,t.level,seed,P,lit);
  else drawInd(sx,sy,t.level,seed,P,lit);
}

// scaffold: bare frame with diagonal cross-bracing
function drawScaffold(sx,sy){
  const z=state.zoom, u0=0.16,v0=0.16,u1=0.84,v1=0.84, H=20*z;
  const A0=bp(sx,sy,u0,v0,0),B0=bp(sx,sy,u1,v0,0),C0=bp(sx,sy,u1,v1,0),D0=bp(sx,sy,u0,v1,0);
  const A1=bp(sx,sy,u0,v0,H),B1=bp(sx,sy,u1,v0,H),C1=bp(sx,sy,u1,v1,H),D1=bp(sx,sy,u0,v1,H);
  const L=(p,q)=>{ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);ctx.stroke();};
  ctx.setLineDash([]); ctx.lineWidth=1*z; ctx.strokeStyle='#caa05a';
  L(A0,B0);L(B0,C0);L(C0,D0);L(D0,A0);                  // base ring
  L(A0,A1);L(B0,B1);L(C0,C1);L(D0,D1);                  // verticals
  L(A1,B1);L(B1,C1);L(C1,D1);L(D1,A1);                  // top ring
  ctx.strokeStyle='rgba(202,160,90,0.65)';
  L(B0,C1);L(C0,B1);                                     // right-face X brace
  L(D0,C1);L(C0,D1);                                     // left-face X brace
}

// vacant (developed lot still empty / unpowered): dashed plot marker
function drawVacantLot(sx,sy,kind){
  const z=state.zoom, col = kind==='R'?'#7caa6b':kind==='C'?'#8a5cf6':'#d9a72c';
  diamond(sx,sy);
  ctx.fillStyle=hexA(col,0.12); ctx.fill();
  ctx.setLineDash([3*z,2*z]); ctx.strokeStyle=hexA(col,0.6);
  ctx.stroke(); ctx.setLineDash([]);
}

// ---- RESIDENTIAL ------------------------------------------------------
function drawRes(sx,sy,level,seed,P,lit){
  const z=state.zoom;
  if(level===0){                                  // low: house / cottage / bungalow
    const k=seed%3;
    if(k===0){ // small house, gable roof + door
      buildingShadow(sx,sy,0.26,0.26,0.78,0.78);
      const v=box(sx,sy,0.26,0.26,0.78,0.78,0, 22*z, P);
      faceWindows(v.B1,v.C1,v.C0,v.B0,2,1,lit);
      faceWindows(v.D1,v.C1,v.C0,v.D0,1,1,P.door,0.34);
      gableRoof(sx,sy,0.26,0.26,0.78,0.78,22*z,15*z,P.roof,P.roof2);
    } else if(k===1){ // cottage, hip roof + chimney
      buildingShadow(sx,sy,0.24,0.24,0.80,0.80);
      const v=box(sx,sy,0.24,0.24,0.80,0.80,0, 19*z, P);
      boxWindows(v,2,1,lit);
      hipRoof(sx,sy,0.24,0.24,0.80,0.80,19*z,16*z,P.roof,P.roof2);
      stack(sx,sy,0.66,0.34,32*z,9*z,P.left);
    } else { // wide low bungalow
      buildingShadow(sx,sy,0.16,0.30,0.86,0.74);
      const v=box(sx,sy,0.16,0.30,0.86,0.74,0, 16*z, P);
      faceWindows(v.B1,v.C1,v.C0,v.B0,3,1,lit);
      faceWindows(v.D1,v.C1,v.C0,v.D0,3,1,lit);
      gableRoof(sx,sy,0.16,0.30,0.86,0.74,16*z,10*z,P.roof,P.roof2);
    }
  } else if(level===1){                           // mid: walkup / townhouse / duplex
    const k=seed%3, H=HPX[1]*z;
    if(k===0){ // narrow 3-floor walkup
      buildingShadow(sx,sy,0.30,0.30,0.72,0.72);
      const v=box(sx,sy,0.30,0.30,0.72,0.72,0,H,P);
      boxWindows(v,2,3,lit);
    } else if(k===1){ // wider townhouse block
      buildingShadow(sx,sy,0.16,0.18,0.84,0.82);
      const v=box(sx,sy,0.16,0.18,0.84,0.82,0,H*0.85,P);
      boxWindows(v,3,3,lit);
      faceWindows(v.D1,v.C1,v.C0,v.D0,1,1,P.door,0.36);
    } else { // duplex: two gabled blocks
      buildingShadow(sx,sy,0.16,0.20,0.84,0.80);
      const a=box(sx,sy,0.16,0.20,0.50,0.80,0,H*0.7,P); boxWindows(a,1,2,lit);
      gableRoof(sx,sy,0.16,0.20,0.50,0.80,H*0.7,12*z,P.roof,P.roof2);
      const b=box(sx,sy,0.50,0.20,0.84,0.80,0,H*0.7,P); boxWindows(b,1,2,lit);
      gableRoof(sx,sy,0.50,0.20,0.84,0.80,H*0.7,12*z,P.roof,P.roof2);
    }
  } else {                                        // high: tower / slab+setback / stepped
    const k=seed%3, H=HPX[2]*z;
    if(k===0){ // apartment tower + antenna
      buildingShadow(sx,sy,0.14,0.14,0.90,0.90);
      const v=box(sx,sy,0.14,0.14,0.90,0.90,0,H,P);
      boxWindows(v,3,5,lit);
      antenna(sx,sy,0.5,0.5,H,12*z);
    } else if(k===1){ // slab block with setback base
      buildingShadow(sx,sy,0.10,0.10,0.92,0.92);
      const base=box(sx,sy,0.10,0.10,0.92,0.92,0,26*z,P); boxWindows(base,4,1,lit);
      const tow=box(sx,sy,0.22,0.22,0.80,0.80,26*z,H-26*z,P); boxWindows(tow,3,4,lit);
    } else { // stepped tower
      buildingShadow(sx,sy,0.16,0.16,0.88,0.88);
      const a=box(sx,sy,0.16,0.16,0.88,0.88,0,H*0.55,P); boxWindows(a,3,3,lit);
      const b=box(sx,sy,0.26,0.26,0.78,0.78,H*0.55,H*0.45,P); boxWindows(b,2,2,lit);
      antenna(sx,sy,0.5,0.5,H,10*z);
    }
  }
}

// ---- COMMERCIAL -------------------------------------------------------
function drawCom(sx,sy,level,seed,P,lit){
  const z=state.zoom;
  if(level===0){                                  // low: corner shop / small office
    const k=seed%3;
    if(k===0){ // corner shop with awning + big shopfront
      buildingShadow(sx,sy,0.22,0.22,0.82,0.82);
      const v=box(sx,sy,0.22,0.22,0.82,0.82,0,24*z,P);
      faceWindows(v.B1,v.C1,v.C0,v.B0,1,1,P.accent,0.12);
      awning(sx,sy,0.22,0.82,0.82,10*z,P.accent);
    } else if(k===1){ // small office with awning
      buildingShadow(sx,sy,0.24,0.24,0.80,0.80);
      const v=box(sx,sy,0.24,0.24,0.80,0.80,0,30*z,P);
      boxWindows(v,2,2,lit);
      awning(sx,sy,0.24,0.80,0.80,12*z,'#5a6e82');
    } else { // kiosk + flat roof box
      buildingShadow(sx,sy,0.20,0.28,0.84,0.76);
      const v=box(sx,sy,0.20,0.28,0.84,0.76,0,22*z,P);
      faceWindows(v.B1,v.C1,v.C0,v.B0,3,1,P.accent,0.14);
    }
  } else if(level===1){                           // mid: glass-front / L-retail / plaza
    const k=seed%3, H=HPX[1]*z;
    if(k===0){ // glass-front store: large glazed panels
      buildingShadow(sx,sy,0.16,0.16,0.86,0.86);
      const v=box(sx,sy,0.16,0.16,0.86,0.86,0,H*0.9,P);
      faceWindows(v.B1,v.C1,v.C0,v.B0,2,3,P.win,0.08);
      faceWindows(v.D1,v.C1,v.C0,v.D0,2,3,P.win,0.08);
    } else if(k===1){ // L-shaped retail block
      buildingShadow(sx,sy,0.14,0.14,0.88,0.88);
      const a=box(sx,sy,0.14,0.14,0.88,0.55,0,H*0.8,P); boxWindows(a,3,2,lit);
      const b=box(sx,sy,0.14,0.55,0.52,0.88,0,H*0.8,P); boxWindows(b,2,2,lit);
    } else { // mid cube with banded glazing
      buildingShadow(sx,sy,0.16,0.16,0.86,0.86);
      const v=box(sx,sy,0.16,0.16,0.86,0.86,0,H,P); boxWindows(v,3,3,P.win);
    }
  } else {                                        // high: office tower / dept-store cube
    const k=seed%3, H=HPX[2]*z;
    if(k===0){ // office tower with stepped crown + antenna
      buildingShadow(sx,sy,0.14,0.14,0.90,0.90);
      const a=box(sx,sy,0.14,0.14,0.90,0.90,0,H*0.7,P); boxWindows(a,3,5,P.win);
      const b=box(sx,sy,0.24,0.24,0.80,0.80,H*0.7,H*0.18,P); boxWindows(b,2,1,P.win);
      const c=box(sx,sy,0.34,0.34,0.70,0.70,H*0.88,H*0.12,P);
      antenna(sx,sy,0.5,0.5,H,12*z);
    } else if(k===1){ // department store cube (full footprint, banded)
      buildingShadow(sx,sy,0.08,0.08,0.94,0.94);
      const v=box(sx,sy,0.08,0.08,0.94,0.94,0,H*0.78,P);
      boxWindows(v,4,4,P.win);
    } else { // twin glass slab
      buildingShadow(sx,sy,0.12,0.12,0.90,0.90);
      const a=box(sx,sy,0.12,0.16,0.52,0.86,0,H,P); boxWindows(a,2,5,P.win);
      const b=box(sx,sy,0.54,0.16,0.90,0.86,0,H*0.82,P); boxWindows(b,2,4,P.win);
    }
  }
}

// ---- INDUSTRIAL -------------------------------------------------------
function drawInd(sx,sy,level,seed,P,lit){
  const z=state.zoom;
  if(level===0){                                  // low: warehouse shed / small unit
    const k=seed%3;
    if(k===0){ // warehouse shed with gable + big door
      buildingShadow(sx,sy,0.14,0.22,0.88,0.78);
      const v=box(sx,sy,0.14,0.22,0.88,0.78,0,24*z,P);
      faceWindows(v.D1,v.C1,v.C0,v.D0,1,1,P.metal,0.30);
      gableRoof(sx,sy,0.14,0.22,0.88,0.78,24*z,9*z,P.roof,P.roof2);
    } else if(k===1){ // small factory unit + short stack
      buildingShadow(sx,sy,0.20,0.24,0.82,0.80);
      const v=box(sx,sy,0.20,0.24,0.82,0.80,0,28*z,P);
      faceWindows(v.B1,v.C1,v.C0,v.B0,3,1,P.win);
      stack(sx,sy,0.72,0.34,28*z,16*z,P.rust);
    } else { // flat storage box with vents
      buildingShadow(sx,sy,0.16,0.20,0.86,0.80);
      const v=box(sx,sy,0.16,0.20,0.86,0.80,0,22*z,P);
      stack(sx,sy,0.34,0.34,22*z,7*z,P.metal,0.05);
      stack(sx,sy,0.60,0.34,22*z,7*z,P.metal,0.05);
    }
  } else if(level===1){                           // mid: chimney factory / loading depot
    const k=seed%3, H=HPX[1]*z;
    if(k===0){ // factory with tall chimney stack
      buildingShadow(sx,sy,0.16,0.18,0.84,0.82);
      const v=box(sx,sy,0.16,0.18,0.84,0.82,0,H*0.7,P);
      faceWindows(v.B1,v.C1,v.C0,v.B0,4,2,P.win);
      stack(sx,sy,0.74,0.30,H*0.7,H*0.7,P.rust,0.07);   // rust-banded chimney
      stack(sx,sy,0.74,0.30,H*0.7+H*0.35,2*z,P.rust2,0.075);
    } else if(k===1){ // depot with loading bays
      buildingShadow(sx,sy,0.10,0.26,0.90,0.74);
      const v=box(sx,sy,0.10,0.26,0.90,0.74,0,H*0.6,P);
      faceWindows(v.D1,v.C1,v.C0,v.D0,4,1,P.metal,0.16);  // bay doors
    } else { // dual-roof workshop
      buildingShadow(sx,sy,0.14,0.20,0.86,0.80);
      const v=box(sx,sy,0.14,0.20,0.86,0.80,0,H*0.55,P); boxWindows(v,3,2,P.win);
      gableRoof(sx,sy,0.14,0.20,0.50,0.80,H*0.55,10*z,P.roof,P.roof2);
      gableRoof(sx,sy,0.50,0.20,0.86,0.80,H*0.55,10*z,P.roof,P.roof2);
    }
  } else {                                        // high: large plant / refinery
    const k=seed%3, H=HPX[2]*z;
    if(k===0){ // large plant with multiple stacks
      buildingShadow(sx,sy,0.10,0.12,0.92,0.90);
      const v=box(sx,sy,0.10,0.12,0.92,0.90,0,H*0.5,P);
      faceWindows(v.B1,v.C1,v.C0,v.B0,5,2,P.win);
      stack(sx,sy,0.30,0.30,H*0.5,H*0.5,P.rust,0.07);
      stack(sx,sy,0.52,0.30,H*0.5,H*0.62,P.metal,0.06);
      stack(sx,sy,0.72,0.34,H*0.5,H*0.42,P.rust2,0.06);
    } else if(k===1){ // refinery: tall silos + flare stack
      buildingShadow(sx,sy,0.10,0.12,0.92,0.90);
      const v=box(sx,sy,0.10,0.12,0.92,0.90,0,H*0.32,P);
      stack(sx,sy,0.30,0.36,H*0.32,H*0.55,P.metal,0.10);  // fat silo
      stack(sx,sy,0.54,0.36,H*0.32,H*0.55,P.metal,0.10);
      stack(sx,sy,0.76,0.30,H*0.32,H*0.85,P.rust,0.05);   // tall flare stack
    } else { // big hall + control tower
      buildingShadow(sx,sy,0.10,0.16,0.92,0.86);
      const v=box(sx,sy,0.10,0.16,0.92,0.86,0,H*0.5,P);
      faceWindows(v.D1,v.C1,v.C0,v.D0,5,2,P.win);
      const tw=box(sx,sy,0.18,0.24,0.40,0.50,H*0.5,H*0.4,P); boxWindows(tw,1,3,P.win);
      stack(sx,sy,0.74,0.34,H*0.5,H*0.5,P.rust,0.07);
    }
  }
}
/* ===== end BUILDING SPRITES ========================================== */

/* ===== UTILITY BUILDINGS ===============================================
   Power plant + pump get the same asset-first / procedural-fallback
   treatment as zone buildings: a real silhouette built from the same
   box()/stack()/faceWindows() helpers, swapped for a preloaded SVG sprite
   (assets/utilities/) when one is exported, same as the R/C/I sprites.
   ===================================================================== */
const UTIL_PAL = {
  plant: { top:'#3a3a42', right:'rgb(57,57,67)', left:'rgb(77,77,87)',
           rust:'#6b4a30', rust2:'#7a5638', win:'#ffd23f', line:'rgba(0,0,0,0.4)' },
  pump:  { top:'#4a5258', right:'#384048', left:'#242a2e',
           win:'#bdf3ff', line:'rgba(0,0,0,0.4)' },
};

// power plant: industrial hall + low control block + twin smoke stacks
// (taller than the hall, each with a banded tip) — stacks feed drawSmoke().
function drawPowerPlantBuilding(sx,sy,powered){
  const z=state.zoom;
  const P=UTIL_PAL.plant;
  const lit = powered ? P.win : DARK_WIN;
  buildingShadow(sx,sy,0.08,0.10,0.92,0.90);
  const hall=box(sx,sy,0.08,0.10,0.92,0.90,0,48*z,P);
  faceWindows(hall.B1,hall.C1,hall.C0,hall.B0,5,2,lit,0.16);
  const ctrl=box(sx,sy,0.10,0.58,0.42,0.86,0,16*z,P);
  faceWindows(ctrl.B1,ctrl.C1,ctrl.C0,ctrl.B0,2,1,lit,0.22);
  stack(sx,sy,0.30,0.34,48*z,60*z,P.rust,0.075);
  stack(sx,sy,0.30,0.34,108*z,6*z,P.rust2,0.09);
  stack(sx,sy,0.60,0.30,48*z,78*z,P.rust,0.07);
  stack(sx,sy,0.60,0.30,126*z,6*z,P.rust2,0.085);
}

// pump / water station: small shed + elevated tank with a domed cap
function drawPumpBuilding(sx,sy,powered){
  const z=state.zoom;
  const P=UTIL_PAL.pump;
  const lit = powered ? P.win : DARK_WIN;
  buildingShadow(sx,sy,0.20,0.22,0.80,0.80);
  const shed=box(sx,sy,0.50,0.50,0.84,0.84,0,20*z,P);
  faceWindows(shed.D1,shed.C1,shed.C0,shed.D0,1,1,lit,0.26);
  stack(sx,sy,0.30,0.34,6*z,42*z,'#22bbdd',0.16);
  stack(sx,sy,0.30,0.34,48*z,6*z,'#0d8aca',0.13);
}

// ---- dispatchers: asset sprite first, procedural silhouette as fallback ----
function drawPowerPlantTile(sx,sy,t){
  const aimg=getAsset('powerplant');
  if(aimg){
    const hh=(TILE_H/2)*state.zoom;
    if(!t.powered) blitAsset(aimg, sx, sy+2*hh, POWER_OUT_TINT, 0.45);
    else           blitAsset(aimg, sx, sy+2*hh);
    return;
  }
  drawPowerPlantBuilding(sx,sy,t.powered);
}
function drawPumpTile(sx,sy,t){
  const aimg=getAsset('pump');
  if(aimg){
    const hh=(TILE_H/2)*state.zoom;
    if(!t.powered) blitAsset(aimg, sx, sy+2*hh, POWER_OUT_TINT, 0.45);
    else           blitAsset(aimg, sx, sy+2*hh);
    return;
  }
  drawPumpBuilding(sx,sy,t.powered);
}
/* ===== end UTILITY BUILDINGS =========================================== */

function drawPark(sx,sy){
  const z=state.zoom, hh=(TILE_H/2)*z;
  ctx.fillStyle='#0c8a2a';
  ctx.beginPath();
  ctx.arc(sx, sy+hh*0.9, 6*z, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle='#5a3a1a';
  ctx.fillRect(sx-1*z, sy+hh*0.9, 2*z, 5*z);
}

function drawSmoke(sx,sy,riseY=30){
  ctx.fillStyle='rgba(120,120,130,0.5)';
  const t=performance.now()/400;
  for(let i=0;i<3;i++){
    const o=(t+i)%3;
    ctx.beginPath();
    ctx.arc(sx+Math.sin(t+i)*3, sy-riseY*state.zoom - o*8*state.zoom, (2+o)*state.zoom, 0, Math.PI*2);
    ctx.fill();
  }
}

function drawFire(sx,sy){
  const z=state.zoom, hh=(TILE_H/2)*z;
  const t=performance.now()/100;
  for(let i=0;i<5;i++){
    const fx=sx+Math.sin(t+i*1.7)*5*z;
    const fy=sy+hh - (i%3)*6*z - 4*z;
    ctx.fillStyle=i%2?'#ff5b3b':'#ffd23f';
    ctx.beginPath();
    ctx.arc(fx, fy, (3-i*0.3)*z, 0, Math.PI*2);
    ctx.fill();
  }
}

function drawNeedIcon(sx,sy,t){
  const z=state.zoom, hh=(TILE_H/2)*z;
  ctx.font=`${10*z}px 'JetBrains Mono', monospace`;
  ctx.textAlign='center';
  let msg = !t.powered?'⚡': !t.water?'💧':'🛣';
  ctx.fillStyle = !t.powered? '#ffd23f': !t.water?'#2bd':'#ff5b3b';
  ctx.fillText(msg, sx, sy+hh*0.6);
  ctx.textAlign='start';
}

/* --- Drag preview overlay — reads state.drag, never writes the grid. --- */
function drawDragPreview(){
  if(!state.drag) return;
  const tool=state.drag.tool;
  let fill, stroke;
  if(tool==='res')      { fill='rgba(124,170,107,0.30)'; stroke='#7caa6b'; }
  else if(tool==='com') { fill='rgba(138,92,246,0.30)';  stroke='#8a5cf6'; }
  else if(tool==='ind') { fill='rgba(217,167,44,0.30)';  stroke='#d9a72c'; }
  else                  { fill='rgba(232,232,232,0.32)'; stroke='#e8e8e8'; }
  const tiles=dragTiles();
  for(const [x,y] of tiles){
    const [sx,sy]=isoToScreen(x,y,0);
    diamond(sx,sy);
    ctx.fillStyle=fill; ctx.fill();
    ctx.strokeStyle=stroke; ctx.lineWidth=1.5; ctx.stroke();
  }
  if(tiles.length){
    // BRIDGE PREVIEW COST: a road drag over water is charged 5x per water tile
    // (matches commitBridgeDrag); other tools keep grass-tiles * toolCost.
    const toolCost=TOOLS.find(t2=>t2.id===tool).cost;
    let cost;
    if(tool==='road' && tiles.some(([x,y])=>state.grid[y][x].type===T.WATER)){
      let water=0, grass=0;
      for(const [x,y] of tiles){ const ty=state.grid[y][x].type;
        if(ty===T.WATER) water++; else if(ty===T.GRASS) grass++; }
      cost = water*toolCost*5 + grass*toolCost;
    } else {
      cost = tiles.filter(([x,y])=>state.grid[y][x].type===T.GRASS).length * toolCost;
    }
    const [cx,cy]=isoToScreen(state.drag.cx,state.drag.cy,0);
    ctx.font='11px \'JetBrains Mono\', monospace'; ctx.textAlign='center';
    ctx.fillStyle='#000'; ctx.fillRect(cx-26, cy-6, 52, 14);
    ctx.fillStyle = cost<=state.funds ? '#e8e8e8' : '#ff5b3b';
    ctx.fillText(tiles.length+'t $'+cost, cx, cy+4);
    ctx.textAlign='start';
  }
}

/* ===== MINIMAP OVERLAYS ===============================================
   Multiple value-map encodings over the minimap. Each maps 1:1 to a grid
   tile, recomputes on every redraw (the minimap is redrawn each frame, so
   sim ticks / placements / overlay switches are all reflected), respects
   the current view rotation, and stays hard-pixelated. No new simulation:
   every overlay reads fields already present on tiles/state.
   ===================================================================== */
export const MINI_OVERLAYS = [
  {id:'zones',      label:'ZN'},
  {id:'power',      label:'PW'},
  {id:'water',      label:'WT'},
  {id:'pollution',  label:'PO'},
  {id:'land value', label:'LV'},
  {id:'density',    label:'DN'},
  {id:'roads',      label:'RD'},
  {id:'commute',    label:'CM'},
];
let miniOverlay='zones';                       // default = current zone view
export function setMiniOverlay(id){ miniOverlay=id; }
export function getMiniOverlay(){ return miniOverlay; }

// color helpers (smooth lerps, no banding)
function _rgb(h){ const c=parseInt(h.slice(1),16); return [c>>16,(c>>8)&255,c&255]; }
function _mix(a,b,t){ const A=_rgb(a),B=_rgb(b); t=t<0?0:t>1?1:t;
  return `rgb(${Math.round(A[0]+(B[0]-A[0])*t)},${Math.round(A[1]+(B[1]-A[1])*t)},${Math.round(A[2]+(B[2]-A[2])*t)})`; }
function _grad(stops,t){ t=clamp(t,0,1);
  for(let i=1;i<stops.length;i++){ if(t<=stops[i][0]){ const a=stops[i-1],b=stops[i];
    const u=(t-a[0])/((b[0]-a[0])||1); return _mix(a[1],b[1],u); } }
  return stops[stops.length-1][1];
}
const MGREY='#3a3a40', MDARK='#14141c';        // neutral grey / neutral dark

// read-only road-proximity for the ROAD ACCESS overlay (visualization only)
function _roadNear(x,y){
  for(let dy=-3;dy<=3;dy++) for(let dx=-3;dx<=3;dx++){
    if(Math.abs(dx)+Math.abs(dy)>3) continue;
    const n=tileAt(x+dx,y+dy);
    if(n && n.type===T.ROAD) return true;
  }
  return false;
}

// pick a tile's minimap colour for the active overlay
function miniColor(t,x,y){
  // ROAD CONNECTORS: edge road = outside connection -> bright white in every overlay
  if(t.type===T.ROAD && (x===0||y===0||x===state.gridWidth-1||y===state.gridHeight-1)) return '#ffffff';
  const zone = isZone(t.type);
  switch(miniOverlay){
    case 'power':
      if(t.powered) return '#ffe23a';                 // powered: bright yellow
      if(zone)      return '#5a1414';                 // unpowered zone: dark red
      return MGREY;
    case 'water':
      if(t.water)   return '#23d3dd';                 // connected: bright cyan
      if(zone)      return '#7a3a10';                 // unconnected zone: dark orange
      return MGREY;
    case 'pollution':
      if(t.pollution<=0) return MDARK;
      return _grad([[0,'#2a3a1a'],[0.30,'#9acd32'],[0.60,'#ff8c1a'],[1,'#8b1a1a']], t.pollution/100);
    case 'land':
      if(!zone && t.type!==T.PARK) return MGREY;       // empty/road neutral grey
      return _grad([[0,'#8b1a1a'],[0.5,'#ffd23f'],[1,'#2ecf4a']], clamp((t.land-20)/150,0,1));
    case 'density': {
      if(!zone || (t.pop===0 && t.level===0)) return MDARK;
      const hue = t.type===T.RES?'#7caa6b':t.type===T.COM?'#8a5cf6':'#d9a72c';
      const f=[0.5,0.75,1][t.level]||0.5;             // brightness by density level
      return _mix('#0a0a10', hue, f);
    }
    case 'road':
      if(t.type===T.ROAD) return MGREY;
      return _roadNear(x,y) ? '#f0f0f0' : '#5a1414';   // in/out of 3-tile road access
    case 'commute':
      if(t.type===T.ROAD) return MGREY;
      if(t.type===T.COM || t.type===T.IND) return '#f0f0f0';   // job tiles themselves
      if(t.type===T.RES)  return t.jobsNearby ? '#39e85a' : '#5a1414';
      return MDARK;
    case 'zones':
    default:
      switch(t.type){
        case T.WATER: return '#15324f';
        case T.ROAD:  return '#555';
        case T.POWERPLANT: return '#fff';
        case T.POWERLINE:  return '#776';
        case T.PUMP:  return '#2bd';
        case T.PARK:  return '#1e8';
        case T.RES:   return t.pop>0?'#7caa6b':'#222a20';
        case T.COM:   return t.pop>0?'#8a5cf6':'#241a3a';
        case T.IND:   return t.pop>0?'#d9a72c':'#3a2e10';
        default: return '#13260f';
      }
  }
}

// Minimap draw — 1:1 tile->pixel, rotation-aware, recomputed every redraw.
export function drawMinimap(){
  const GW=state.gridWidth, GH=state.gridHeight;   // MAP SIZE
  const s=mini.width/GW;
  mctx.clearRect(0,0,mini.width,mini.height);
  for(let y=0;y<GH;y++) for(let x=0;x<GW;x++){
    const t=state.grid[y][x];
    const [rx,ry]=rotateCoord(x,y,state.rot);    // MINIMAP OVERLAYS: respect view rotation
    mctx.fillStyle=miniColor(t,x,y);
    mctx.fillRect(rx*s, ry*s, Math.ceil(s), Math.ceil(s));
    // keep the fire indicator only in the default zones view
    if(miniOverlay==='zones' && t.onFire>0){
      mctx.fillStyle='#ff5b3b'; mctx.fillRect(rx*s,ry*s,Math.ceil(s),Math.ceil(s));
    }
  }
  mctx.strokeStyle='rgba(232,232,232,0.6)';
  mctx.strokeRect(1,1,mini.width-2,mini.height-2);
}
/* ===== end MINIMAP OVERLAYS ========================================== */

/* --- Toolbar icon drawer — draws into a small ctx supplied by ui. --- */
export function drawToolIcon(c,tool){
  c.clearRect(0,0,24,24);
  c.fillStyle=tool.color;
  switch(tool.id){
    case 'res': case 'com': case 'ind':
      c.fillRect(5,9,5,11); c.fillRect(13,5,6,15);
      c.fillStyle='#000';
      c.fillRect(6,11,1,1); c.fillRect(8,11,1,1);
      c.fillRect(14,7,1,1); c.fillRect(17,7,1,1); break;
    case 'road':
      c.fillStyle='#444'; c.fillRect(2,9,20,6);
      c.fillStyle='#e8e8e8'; c.fillRect(4,11,3,1); c.fillRect(11,11,3,1); c.fillRect(18,11,3,1); break;
    case 'power':
      c.strokeStyle=tool.color; c.lineWidth=1;
      c.beginPath(); c.moveTo(12,4); c.lineTo(12,20); c.moveTo(6,7); c.lineTo(18,7); c.stroke(); break;
    case 'plant':
      c.fillStyle='#555'; c.fillRect(4,10,16,10);
      c.fillStyle='#333'; c.fillRect(7,4,3,7); c.fillRect(13,4,3,7);
      c.fillStyle='#888'; c.fillRect(6,2,2,2); break;
    case 'pump':
      c.fillStyle='#2bd'; c.fillRect(6,8,12,12);
      c.fillStyle='#fff'; c.fillRect(10,11,4,4); break;
    case 'park':
      c.fillStyle='#1e8'; c.beginPath(); c.arc(12,12,7,0,7); c.fill();
      c.fillStyle='#5a3a1a'; c.fillRect(11,12,2,6); break;
    case 'bull':
      c.fillStyle='#c33'; c.fillRect(4,12,12,6);
      c.fillStyle='#c33'; c.fillRect(16,8,4,10); break;
  }
}

// --- colour utilities (rendering-local) ---
function shade(hex,amt){
  const c=parseInt(hex.slice(1),16);
  let r=(c>>16)+amt, g=((c>>8)&255)+amt, b=(c&255)+amt;
  r=clamp(r,0,255);g=clamp(g,0,255);b=clamp(b,0,255);
  return `rgb(${r},${g},${b})`;
}
function hexA(hex,a){
  const c=parseInt(hex.slice(1),16);
  return `rgba(${c>>16},${(c>>8)&255},${c&255},${a})`;
}

/* ===== SVG EXPORT =====================================================
   Minimal, additive seam used ONLY by js/export_assets.js (the one-time
   asset exporter). It does three things and changes no rendering logic:
     • __setExportTarget(c) — redirect all draw calls to a supplied
       canvas2svg context; pass null/undefined to restore the screen ctx.
     • __setExportOrigin(x,y) — override the iso projection origin so the
       exporter can place a single tile (and its neighbour lookups, used
       by the road/bridge connectors) at a known canvas position. The
       per-frame render() resets the origin via recenter(), so this only
       holds for the synchronous block in which the exporter draws.
     • __exportDrawers — the private per-variant draw functions, exposed
       so the exporter renders through the REAL sprite code (no drift).
   ===================================================================== */
export function __setExportTarget(c){ ctx = c || __screenCtx; }       // SVG EXPORT
export function __setExportOrigin(x,y){ originX = x; originY = y; }    // SVG EXPORT
export const __exportDrawers = {                                      // SVG EXPORT
  ground:     drawGroundTile,       // terrain + coast-free ground diamond / raised mesa
  road:       drawRoad,             // 16 masks, edge EXIT sign, and bridges (drawBridgeTile)
  building:   drawZoneBuilding,     // R/C/I dispatcher (density via t.level, variant via gx,gy)
  scaffold:   drawScaffold,         // construction frame
  powerplant: drawPowerPlantBuilding, // hall + control block + twin smoke stacks
  pump:       drawPumpBuilding,       // shed + elevated water tank
};
