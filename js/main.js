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

  requestAnimationFrame(frame);   // render the map behind the modal

  // STARTUP: show the save/new-game modal first; sim starts only on a choice
  setGameStartHandler(startSim);
  openStartup();
}

boot();
