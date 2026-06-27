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
import { initUI, syncUI, toast, doAutosave } from './ui.js';

// --- simulation timer: self-scheduling so speed changes apply live ---
function simLoop(){
  if(!state.paused){
    monthlyTick();
    // SAVE SYSTEM: autosave every 12 in-game months
    if(state.month>0 && state.month%12===0) doAutosave();
  }
  setTimeout(simLoop, state.speeds[state.speedIdx]);
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
  // seed a coal plant near the centre on a guaranteed-buildable lowland tile — MAP SIZE + TERRAIN
  const cx=state.gridWidth>>1, cy=state.gridHeight>>1;
  const plant=makeTile(T.POWERPLANT); plant.terrain=TERRAIN.LOWLAND; plant.elevation=0.5;
  state.grid[cy][cx]=plant;
  propagatePower();
  propagateWater();

  // fire spreads on its own fast cadence so the ~5s window feels right
  setInterval(()=>{ if(!state.paused) fireStep(); }, 100);

  simLoop();
  requestAnimationFrame(frame);
  toast('Welcome to '+state.cityName+'. Build roads, zones & power!');
}

boot();
