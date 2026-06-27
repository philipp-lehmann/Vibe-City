/* ================================================================
   terrain.js — TERRAIN: procedural terrain generation.
   Dependencies: NONE (leaf module; a minimal public-domain 2D simplex
   noise implementation is inlined below, no external packages).
   Exports generateTerrain(gw,gh,seed) -> 2D array of base tile data:
     { elevation:0..1, moisture:0..1, terrain:<TERRAIN id> }
   ================================================================ */

// terrain type ids (separate from tile/zone types in config.T)
export const TERRAIN = { WATER:0, SHALLOWS:1, WETLAND:2, LOWLAND:3, HIGHLAND:4, HILL:5 };
export const TERRAIN_NAMES = {
  0:'Deep Water', 1:'Shallows', 2:'Wetland', 3:'Lowland', 4:'Highland', 5:'Hill'
};
// water-class terrain can't be zoned/built on
export const isWaterTerrain = tt => tt===TERRAIN.WATER || tt===TERRAIN.SHALLOWS;
// ROAD CONNECTORS: a road over water terrain must be built as a bridge
export const needsBridge = tt => isWaterTerrain(tt);

// --- seeded PRNG (mulberry32) ---
function mulberry32(a){
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ a>>>15, 1 | a);
    t = (t + Math.imul(t ^ t>>>7, 61 | t)) ^ t;
    return ((t ^ t>>>14) >>> 0) / 4294967296;
  };
}

// --- 2D simplex noise (public domain, Gustavson-style), seeded permutation ---
function makeSimplex(seed){
  const rng = mulberry32(seed>>>0 || 1);
  const p = new Uint8Array(256);
  for(let i=0;i<256;i++) p[i]=i;
  for(let i=255;i>0;i--){ const j=(rng()*(i+1))|0; const t=p[i]; p[i]=p[j]; p[j]=t; } // Fisher-Yates
  const perm = new Uint8Array(512), permMod12 = new Uint8Array(512);
  for(let i=0;i<512;i++){ perm[i]=p[i&255]; permMod12[i]=perm[i]%12; }
  const grad3=[[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[1,0],[-1,0],[0,1],[0,-1],[0,1],[0,-1]];
  const F2=0.5*(Math.sqrt(3)-1), G2=(3-Math.sqrt(3))/6;
  return function(xin,yin){
    let n0=0,n1=0,n2=0;
    const s=(xin+yin)*F2; const i=Math.floor(xin+s), j=Math.floor(yin+s);
    const t=(i+j)*G2; const X0=i-t, Y0=j-t; const x0=xin-X0, y0=yin-Y0;
    let i1,j1; if(x0>y0){i1=1;j1=0;}else{i1=0;j1=1;}
    const x1=x0-i1+G2, y1=y0-j1+G2; const x2=x0-1+2*G2, y2=y0-1+2*G2;
    const ii=i&255, jj=j&255;
    const gi0=permMod12[ii+perm[jj]], gi1=permMod12[ii+i1+perm[jj+j1]], gi2=permMod12[ii+1+perm[jj+1]];
    let t0=0.5-x0*x0-y0*y0; if(t0>=0){ t0*=t0; n0=t0*t0*(grad3[gi0][0]*x0+grad3[gi0][1]*y0); }
    let t1=0.5-x1*x1-y1*y1; if(t1>=0){ t1*=t1; n1=t1*t1*(grad3[gi1][0]*x1+grad3[gi1][1]*y1); }
    let t2=0.5-x2*x2-y2*y2; if(t2>=0){ t2*=t2; n2=t2*t2*(grad3[gi2][0]*x2+grad3[gi2][1]*y2); }
    return 70*(n0+n1+n2);   // ~[-1,1]
  };
}

const clamp01 = v => v<0?0:v>1?1:v;

// elevation + moisture -> terrain type (thresholds per spec)
export function classifyTerrain(e,m){
  if(e < 0.30) return TERRAIN.WATER;
  if(e < 0.38) return TERRAIN.SHALLOWS;
  if(e < 0.50 && m > 0.60) return TERRAIN.WETLAND;
  if(e < 0.65) return TERRAIN.LOWLAND;
  if(e < 0.82) return TERRAIN.HIGHLAND;
  return TERRAIN.HILL;
}

// fractal sampler: 2 octaves, lacunarity 2.0, gain 0.5, normalised to [0,1]
function fractal(noise, x, y, f0){
  let amp=1, freq=f0, sum=0, norm=0;
  for(let o=0;o<2;o++){ sum += amp*noise(x*freq, y*freq); norm += amp; amp*=0.5; freq*=2.0; }
  return clamp01((sum/norm + 1) / 2);
}

/* generateTerrain(gridWidth, gridHeight, seed) -> [y][x] base tile data */
export function generateTerrain(gw, gh, seed){
  seed = (seed>>>0) || 1;
  const elevNoise  = makeSimplex(seed);
  const moistNoise = makeSimplex(seed ^ 0x9e3779b9);   // independent layer
  const f0 = 2.4 / Math.max(gw, gh);                    // ~2-3 features across the map
  const out = [];
  for(let y=0;y<gh;y++){
    const row = [];
    for(let x=0;x<gw;x++){
      const e = fractal(elevNoise,  x, y, f0);
      const m = fractal(moistNoise, x, y, f0);
      row.push({ elevation:e, moisture:m, terrain:classifyTerrain(e,m) });
    }
    out.push(row);
  }
  return out;
}
