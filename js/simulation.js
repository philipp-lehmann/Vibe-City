/* ================================================================
   simulation.js — the economy/heartbeat. NO DOM access.
   Dependencies: config.js, state.js
   Holds: power propagation, water propagation, road access, land
   value, the monthly tick (taxes/upkeep/growth/leveling), demand
   model, and the fire disaster. User-facing messages are emitted
   via state.pushNotice (drained by ui), never via the DOM.
   ================================================================ */
import { T, isZone, conducts, clamp, lerp } from './config.js';   // MAP SIZE: GRID now runtime
import { state, tileAt, makeTile, pushNotice, requestFlash, pushHistory } from './state.js';
import { TERRAIN } from './terrain.js';   // TERRAIN TOOLS: terrain land-value effects

const POP_MILESTONES = [
  [10_000,  '10,000 residents — Village!'],
  [50_000,  '50,000 residents — Town!'],
  [100_000, '100,000 residents — City!'],
];

/* --- Power propagation: flood fill from every coal plant. --- */
export function propagatePower(){
  for(let y=0;y<state.gridHeight;y++) for(let x=0;x<state.gridWidth;x++) state.grid[y][x].powered=false;

  const queue=[];
  let capacity = 0; let plants = 0;
  for(let y=0;y<state.gridHeight;y++) for(let x=0;x<state.gridWidth;x++){
    if(state.grid[y][x].type===T.POWERPLANT){
      state.grid[y][x].powered=true;
      queue.push([x,y]);
      capacity += 300;                       // each coal plant powers ~300 tiles
      plants++;
    }
  }
  state.powerPlantCount = plants;

  let used = 0;
  const N=[[1,0],[-1,0],[0,1],[0,-1]];
  while(queue.length && used < capacity){
    const [x,y]=queue.shift();
    for(const [dx,dy] of N){
      const nx=x+dx, ny=y+dy;
      const t=tileAt(nx,ny);
      if(!t || t.powered) continue;
      if(conducts(t.type)){ t.powered=true; used++; queue.push([nx,ny]); }
    }
  }
}

/* --- Water propagation: floods from every road-connected pump. --- */
export function propagateWater(){
  for(let y=0;y<state.gridHeight;y++) for(let x=0;x<state.gridWidth;x++) state.grid[y][x].water=false;

  const queue=[]; let capacity=0;
  for(let y=0;y<state.gridHeight;y++) for(let x=0;x<state.gridWidth;x++){
    const t=state.grid[y][x];
    if(t.type===T.PUMP && roadWithin(x, y, 3)){     // pump needs a road within 3 tiles
      t.water=true; queue.push([x,y]); capacity+=120; // each pump serves ~120 tiles
    }
  }
  let used=0;
  const N=[[1,0],[-1,0],[0,1],[0,-1]];
  while(queue.length && used<capacity){
    const [x,y]=queue.shift();
    for(const [dx,dy] of N){
      const nx=x+dx, ny=y+dy; const t=tileAt(nx,ny);
      if(!t || t.water) continue;
      if(t.type!==T.WATER){            // mains run through land, not across open water
        t.water=true; used++; queue.push([nx,ny]);
      }
    }
  }
}

/* --- True if a road tile lies within `dist` tiles (Manhattan). Shared
   by zone road-access and pump activation. --- */
export function roadWithin(x,y,dist){
  for(let dy=-dist;dy<=dist;dy++) for(let dx=-dist;dx<=dist;dx++){
    if(Math.abs(dx)+Math.abs(dy)>dist) continue;
    const n=tileAt(x+dx,y+dy);
    if(n && n.type===T.ROAD) return true;
  }
  return false;
}

/* --- Road access: a zone grows if any road is within 3 tiles. --- */
export function computeRoadAccess(){
  for(let y=0;y<state.gridHeight;y++) for(let x=0;x<state.gridWidth;x++){
    // nearRoad LAND VALUE: computed for ALL tiles so non-zone tiles also get the
    // road-proximity land-value bonus (runs monthly, so the cost is fine).
    state.grid[y][x].nearRoad = roadWithin(x,y,3);
  }
}

/* --- DEMAND SYSTEM: Industrial pollution. Each industrial tile radiates
   pollution over a 3-tile Manhattan radius (stronger when closer). Parks
   counter it: each park within 2 tiles offsets ~one industrial tile's worth.
   Result is stored per tile as t.pollution and used by land value + growth. --- */
export const POLL_HEAVY = 5;   // residential can't level past low at/above this
export function computePollution(){
  for(let y=0;y<state.gridHeight;y++) for(let x=0;x<state.gridWidth;x++){
    let raw=0, parkOffset=0;
    for(let dy=-3;dy<=3;dy++) for(let dx=-3;dx<=3;dx++){
      const d=Math.abs(dx)+Math.abs(dy);
      const n=tileAt(x+dx,y+dy); if(!n) continue;
      if(n.type===T.IND && d<=3) raw += (4-d);          // 3 adjacent .. 1 at edge
      if(n.type===T.PARK && d<=2) parkOffset += 3;        // a park ~= one industry's peak
    }
    state.grid[y][x].pollution = Math.max(0, Math.min(99, raw - parkOffset));
  }
}

/* --- DEMAND SYSTEM: Commute. A residential tile contributes to C/I demand
   only if a road-connected commercial/industrial zone lies within 8 tiles of
   PATH distance along roads. We multi-source BFS over the road graph from
   every road tile adjacent to a C/I zone, then a residential tile "has jobs"
   if one of its access roads (within Manhattan 3) is within 8 road-steps. --- */
export function computeCommute(){
  const INF=1e9;
  const dist = Array.from({length:state.gridHeight},()=>new Array(state.gridWidth).fill(INF)); // MAP SIZE
  const queue=[];
  // sources: road tiles orthogonally adjacent to a C or I zone
  const N=[[1,0],[-1,0],[0,1],[0,-1]];
  const onEdge=(x,y)=> x===0||y===0||x===state.gridWidth-1||y===state.gridHeight-1;
  for(let y=0;y<state.gridHeight;y++) for(let x=0;x<state.gridWidth;x++){
    if(state.grid[y][x].type!==T.ROAD) continue;
    let adjJob=false;
    for(const [dx,dy] of N){ const n=tileAt(x+dx,y+dy); if(n && (n.type===T.COM||n.type===T.IND)) adjJob=true; }
    // ROAD CONNECTORS: an edge road is an off-map endpoint — sims can leave to reach jobs
    if(adjJob || onEdge(x,y)){ dist[y][x]=0; queue.push([x,y]); }
  }
  // BFS along roads
  for(let h=0; h<queue.length; h++){
    const [x,y]=queue[h]; const d=dist[y][x];
    for(const [dx,dy] of N){
      const nx=x+dx, ny=y+dy; const n=tileAt(nx,ny);
      if(n && n.type===T.ROAD && dist[ny][nx]>d+1){ dist[ny][nx]=d+1; queue.push([nx,ny]); }
    }
  }
  // assign jobsNearby to residential tiles (others: true / irrelevant)
  for(let y=0;y<state.gridHeight;y++) for(let x=0;x<state.gridWidth;x++){
    const t=state.grid[y][x];
    if(t.type!==T.RES){ t.jobsNearby=true; continue; }
    let best=INF;
    for(let dy=-3;dy<=3;dy++) for(let dx=-3;dx<=3;dx++){
      if(Math.abs(dx)+Math.abs(dy)>3) continue;
      const rx=x+dx, ry=y+dy;
      if(tileAt(rx,ry) && state.grid[ry][rx].type===T.ROAD) best=Math.min(best, dist[ry][rx]);
    }
    t.jobsNearby = best <= 8;     // within 8 road-steps of a job-adjacent road
  }
}

/* --- DEMAND SYSTEM: Happiness 0-100 from tax band, unemployment and
   pollution exposure of residents. Computed before growth so it can gate it. --- */
export function computeHappiness(){
  let rPop=0, rJobs=0, polSum=0, rTiles=0;
  for(let y=0;y<state.gridHeight;y++) for(let x=0;x<state.gridWidth;x++){
    const t=state.grid[y][x];
    if(t.type!==T.RES) continue;
    rTiles++; rPop+=t.pop; polSum+=t.pollution;
    if(t.jobsNearby) rJobs+=t.pop;
  }
  const tax=state.taxPct;
  const taxAdj = tax<5 ? +10 : tax<10 ? 0 : tax<15 ? -10 : -30;   // band modifier
  const jobPenalty = rPop>0 ? (1 - rJobs/rPop)*25 : 0;            // unemployment
  const polPenalty = rTiles>0 ? Math.min(30, (polSum/rTiles)*3) : 0;
  state.happiness = Math.max(0, Math.min(100, Math.round(72 + taxAdj - jobPenalty - polPenalty)));
}

/* --- Land value: parks/water/roads raise value; pollution lowers it. --- */
export function computeLandValue(){
  for(let y=0;y<state.gridHeight;y++) for(let x=0;x<state.gridWidth;x++){
    const t=state.grid[y][x];
    let v=20;
    for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++){
      const n=tileAt(x+dx,y+dy); if(!n) continue;
      const d=Math.abs(dx)+Math.abs(dy);
      const w=(3-d); if(w<=0) continue;
      if(n.type===T.PARK)  v+=6*w;
      if(n.type===T.WATER) v+=3*w;
      if(n.type===T.PUMP)  v+=2*w;
      if(n.terrain===TERRAIN.HILL) v+=4*w;   // TERRAIN TOOLS: hills raise nearby value (2-tile)
    }
    if(t.powered) v+=15;
    if(t.nearRoad) v+=10;
    v += t.level*15;                  // denser = pricier
    v -= t.pollution*5;               // DEMAND SYSTEM: pollution degrades land value
    // TERRAIN TOOLS: per-tile terrain value
    if(t.terrain===TERRAIN.HIGHLAND) v+=20;
    else if(t.terrain===TERRAIN.WETLAND) v-=10;
    t.land = Math.max(5, Math.min(250, v));
  }
}

/* --- Monthly update: power/water/roads/value, then taxes, upkeep,
   growth, leveling and demand. Emits notices, never touches the DOM. --- */
export function monthlyTick(){
  state.month++;

  // DEMAND SYSTEM: derive rate from the tax slider before computing income
  state.taxRate = state.taxPct/100;

  propagatePower();
  computeRoadAccess();
  propagateWater();
  computePollution();      // DEMAND SYSTEM
  computeLandValue();
  computeCommute();        // DEMAND SYSTEM
  computeHappiness();      // DEMAND SYSTEM (uses last tick's pops)

  let income=0, upkeep=0, totalPop=0;
  // DEMAND SYSTEM: aggregates for derived demand
  let resPop=0, resJobPop=0, comCap=0, indCap=0;
  const CAPS=[12,40,110];

  // DEMAND SYSTEM: tax-band growth modifiers
  const slowGrowth = state.taxPct>=10;   // residential growth slows
  const fleeing    = state.taxPct>=15;   // residents leave each month
  const happyScale = 0.5 + state.happiness/100;

  for(let y=0;y<state.gridHeight;y++) for(let x=0;x<state.gridWidth;x++){
    const t=state.grid[y][x];

    if(t.type===T.ROAD)       upkeep+=1;
    if(t.type===T.POWERLINE)  upkeep+=1;
    if(t.type===T.POWERPLANT) upkeep+=50;
    if(t.type===T.PUMP)       upkeep+=10;
    if(t.type===T.PARK)       upkeep+=2;

    if(!isZone(t.type)) continue;

    const isRes=t.type===T.RES, isCom=t.type===T.COM, isInd=t.type===T.IND;
    const key = isRes?'R':isCom?'C':'I';
    const dem = state.demand[key];
    const cap = CAPS[t.level];
    // ROAD CONNECTORS: residential can't grow with no outside connection
    const valid = t.powered && t.water && t.nearRoad && t.onFire===0
                  && !(isRes && state.outsideConnections===0);

    // DEMAND SYSTEM: oversupplied commercial/industrial (negative demand) stagnate
    const oversupplied = (isCom||isInd) && dem < 0;
    const heavyPoll = isRes && t.pollution >= POLL_HEAVY;

    if(valid && !oversupplied){
      let pull = dem + 0.1 + t.land/400;
      if(isRes){
        pull *= happyScale;                 // happiness scales housing growth
        if(slowGrowth) pull *= 0.5;          // 10%+ tax slows growth
        if(!t.jobsNearby) pull *= 0.3;       // commute: few reachable jobs
      }
      t.grow += pull;

      const target = Math.round(cap * Math.min(1, 0.3 + t.grow*0.12));
      t.pop += Math.sign(target - t.pop) * Math.max(1, Math.abs(target-t.pop)*0.4|0);
      t.pop = Math.max(0, Math.min(cap, t.pop));

      // level up — pollution caps residential at low density
      let canLevel = t.level<2 && t.grow>6 && t.pop>=cap*0.85 && dem>0.1;
      if(heavyPoll) canLevel=false;          // DEMAND SYSTEM: pollution caps residential
      if(canLevel){ t.level++; t.grow=0; }
    } else {
      // unmet conditions or oversupply -> stagnate / de-densify
      t.grow = Math.max(0, t.grow-1);
      t.pop  = Math.max(0, t.pop-2);
      if(t.pop===0 && t.level>0 && Math.random()<0.15) t.level--;
    }

    // DEMAND SYSTEM: heavy pollution pushes denser residential back down
    if(heavyPoll && t.level>0 && Math.random()<0.3){ t.level--; t.grow=0; }
    // DEMAND SYSTEM: punitive tax makes residents leave outright
    if(isRes && fleeing){
      t.pop=Math.max(0, t.pop-4);
      if(t.pop===0 && t.level>0 && Math.random()<0.2) t.level--;
    }

    // aggregates
    if(isRes){ resPop+=t.pop; if(t.jobsNearby) resJobPop+=t.pop; }
    if(isCom)  comCap+=cap;
    if(isInd)  indCap+=cap;
    totalPop += t.pop;

    income += t.land * state.taxRate * (t.pop/cap || 0);
  }

  state.pop = totalPop;
  for (const [n, msg] of POP_MILESTONES) {
    if (totalPop >= n && !state.milestones.includes(n)) {
      state.milestones.push(n);
      requestFlash(msg);
    }
  }

  state.funds += Math.round(income - upkeep);
  pushHistory();   // STATISTICS: sample this month's pop/happiness/funds for sparklines + stats panel

  updateDemand(resPop, resJobPop, comCap, indCap);
  tickFire();

  if(state.funds < 0) pushNotice('TREASURY OVERDRAWN! Raise income or cut upkeep.');
}

/* --- (legacy helper, retained) pumps within radius 4 provide water --- */
export function hasWaterNearby(x,y){
  for(let dy=-4;dy<=4;dy++) for(let dx=-4;dx<=4;dx++){
    const n=tileAt(x+dx,y+dy);
    if(n && n.type===T.PUMP && Math.abs(dx)+Math.abs(dy)<=4) return true;
  }
  return false;
}

/* --- DEMAND SYSTEM: DERIVED demand. Commercial and industrial demand are
   computed from residential population (only residents who can reach jobs via
   the commute check contribute) minus the existing zoned capacity:
       C demand = resJobPop/3 - commercialCapacity
       I demand = resJobPop/4 - industrialCapacity
   So overbuilt C/I (or too few employed residents) drives demand negative and
   those zones de-densify. Residential demand reflects desirability: happiness,
   tax and available jobs. Values are normalised to [-1,1] and smoothed. --- */
const DEM_SCALE = 70;   // raw units that map to a full bar
export function updateDemand(resPop, resJobPop, comCap, indCap){
  // --- derived commercial / industrial demand ---
  let rawC = resJobPop/3 - comCap;
  let rawI = resJobPop/4 - indCap;
  let dC = rawC / DEM_SCALE;
  let dI = rawI / DEM_SCALE;

  // No residents can reach jobs but housing exists -> businesses have no
  // workforce: show clearly negative C/I demand (pure-residential sprawl).
  if(resJobPop===0 && resPop>0){ dC=Math.min(dC,-0.6); dI=Math.min(dI,-0.6); }

  // --- residential demand: desirability from happiness, tax, job availability ---
  let dR = 0.35 + (state.happiness-60)/80;
  if(state.taxPct>=10) dR -= 0.2;
  if(state.taxPct>=15) dR -= 0.3;
  if(resPop>0 && resJobPop===0) dR -= 0.2;   // nowhere to work hurts desirability
  if(state.pop < 40) dR = Math.max(dR, 0.55); // gentle early-game kickstart
  // ROAD CONNECTORS: no off-map link -> R demand forced to 0; extra links -> +10%
  if(state.outsideConnections===0) dR = 0;
  else if(state.outsideConnections>1) dR *= 1.1;

  const noise=()=> (Math.random()-0.5)*0.08;
  state.demand.R = clamp(lerp(state.demand.R, dR+noise(), 0.4), -1, 1);
  state.demand.C = clamp(lerp(state.demand.C, dC+noise(), 0.4), -1, 1);
  state.demand.I = clamp(lerp(state.demand.I, dI+noise(), 0.4), -1, 1);
  if(state.outsideConnections===0) state.demand.R = 0;   // ROAD CONNECTORS: hard zero
}

/* --- Fire disaster: ignite a building; spreads ~5s then burns out. --- */
export function igniteFire(x,y){
  let tx=x, ty=y;
  if(tx===undefined){
    const cands=[];
    for(let yy=0;yy<state.gridHeight;yy++) for(let xx=0;xx<state.gridWidth;xx++){
      const t=state.grid[yy][xx];
      if(isZone(t.type)||t.type===T.PARK) cands.push([xx,yy]);
    }
    if(!cands.length){ pushNotice('Nothing flammable to burn!'); return; }
    [tx,ty]=cands[(Math.random()*cands.length)|0];
  }
  const t=tileAt(tx,ty);
  if(t && (isZone(t.type)||t.type===T.PARK)){
    t.onFire = 50;
    state.fireActive=true;
    state.fireEnds = performance.now()+5000;
    pushNotice('🔥 FIRE reported at '+tx+','+ty+' — it will burn ~5s');
  }
}

/* --- Fire spread, run on its own fast cadence from main. --- */
export function fireStep(){
  if(!state.fireActive) return;
  const now=performance.now();
  const spread=[];
  for(let y=0;y<state.gridHeight;y++) for(let x=0;x<state.gridWidth;x++){
    const t=state.grid[y][x];
    if(t.onFire>0){
      t.onFire--;
      if(now < state.fireEnds && Math.random()<0.25){
        const N=[[1,0],[-1,0],[0,1],[0,-1]];
        const [dx,dy]=N[(Math.random()*4)|0];
        const n=tileAt(x+dx,y+dy);
        if(n && (isZone(n.type)||n.type===T.PARK) && n.onFire===0) spread.push(n);
      }
      if(t.onFire===0){ t.type=T.GRASS; t.pop=0; t.level=0; t.grow=0; }
    }
  }
  if(now < state.fireEnds) spread.forEach(n=> n.onFire=Math.max(n.onFire,30));

  if(now >= state.fireEnds){
    let any=false;
    for(let y=0;y<state.gridHeight;y++) for(let x=0;x<state.gridWidth;x++) if(state.grid[y][x].onFire>0) any=true;
    if(!any){ state.fireActive=false; pushNotice('Fire extinguished.'); }
  }
}

export function tickFire(){ /* monthly hook reserved; fire runs on fast timer */ }
