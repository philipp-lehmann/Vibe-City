/* ================================================================
   main.js — composition root. Wires every module and runs the loops.
   Dependencies: config, state, simulation, renderer, input, ui (all).
   No game logic of its own — just init + the two timers (sim + frame).
   ================================================================ */
import { T } from './config.js';
import { state, initGrid, makeTile, applyTerrain } from './state.js';
import { generateTerrain, TERRAIN } from './terrain.js';   // TERRAIN
import { propagatePower, propagateWater, monthlyTick, fireStep } from './simulation.js';
import { resize, render, drawMinimap } from './renderer.js';
import { initInput } from './input.js';
import { initUI, syncUI, toast, doAutosave, openStartup, setGameStartHandler } from './ui.js';
import { loadAllAssets, isLoaded } from './assets.js';   // ASSET RENDERER

// --- simulation timer: self-scheduling so speed changes apply live ---
let simRunning=false;   // STARTUP: don't tick until a city is chosen
function simLoop(){
  if(!state.paused){
    monthlyTick();
    // AUTOSAVE INTERVAL: autosave every 120 in-game months (10 years)
    if(state.month>0 && state.month%120===0) doAutosave();
  }
  setTimeout(simLoop, state.speeds[state.speedIdx]);
}
// STARTUP: begin the simulation once the player loads or starts a city
function startSim(){
  if(simRunning) return;
  simRunning=true;
  simLoop();
}

// --- render/frame loop: draw + push state to the DOM (ui.syncUI) ---
function frame(){
  render();
  drawMinimap();
  syncUI();
  requestAnimationFrame(frame);
}

// ASSET RENDERER: full-screen loading bar shown while SVG sprites preload
function showLoadingBar(){
  const o=document.createElement('div'); o.id='asset-loading';
  o.style.cssText='position:fixed;inset:0;z-index:300;display:flex;flex-direction:column;'+
    'align-items:center;justify-content:center;gap:14px;background:#05050c;color:#e8e8e8;'+
    'font:13px \'JetBrains Mono\', monospace;letter-spacing:2px;';
  o.innerHTML=`<div>LOADING ASSETS</div>
    <div style="width:300px;height:14px;border:1px solid #e8e8e8;background:#0a0a14;box-shadow:0 0 8px rgba(232,232,232,0.4);">
      <div id="asset-bar" style="height:100%;width:0%;background:#e8e8e8;transition:width .08s linear;"></div></div>
    <div id="asset-pct" style="color:#cfcfcf;">0%</div>`;
  document.body.appendChild(o); return o;
}
function updateLoadingBar(done,total){
  const pct = total ? Math.round(done/total*100) : 100;
  const bar=document.getElementById('asset-bar'); if(bar) bar.style.width=pct+'%';
  const p=document.getElementById('asset-pct'); if(p) p.textContent=`${pct}%  (${done}/${total})`;
}

function boot(){
  resize();
  initGrid();
  // TERRAIN: generate the initial map's terrain before simulation starts
  applyTerrain(generateTerrain(state.gridWidth, state.gridHeight, (Math.random()*1e9)>>>0));
  initUI();
  initInput();

  state.tool='road';
  // NO INITIAL PLANT: grid starts empty (terrain only); player builds their own power
  propagatePower();
  propagateWater();

  // fire spreads on its own fast cadence so the ~5s window feels right
  setInterval(()=>{ if(!state.paused && simRunning) fireStep(); }, 100);

  // ASSET RENDERER: preload every SVG sprite before the render loop starts, so
  // tiles never flash unstyled. The sim still waits for a city choice (openStartup).
  const overlay=showLoadingBar();
  loadAllAssets(updateLoadingBar).then(()=>{
    if(overlay) overlay.remove();
    if(!isLoaded()) console.warn('[ASSET RENDERER] some assets failed; using canvas fallback');
    requestAnimationFrame(frame);                    // start the render loop once loaded
    setGameStartHandler(startSim);                   // STARTUP: sim starts on city choice
    openStartup();                                   // show the save/new-game modal
  });
}

boot();
