/* ================================================================
   main.js — composition root. Wires every module and runs the loops.
   Dependencies: config, state, simulation, renderer, input, ui (all).
   No game logic of its own — just init + the two timers (sim + frame).
   ================================================================ */
import { T } from './config.js';
import { state, initGrid, makeTile } from './state.js';
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
  initUI();
  initInput();

  state.tool='road';
  // seed a coal plant near the centre of the (runtime-sized) map — MAP SIZE
  state.grid[state.gridHeight>>1][state.gridWidth>>1]=makeTile(T.POWERPLANT);
  propagatePower();
  propagateWater();

  // fire spreads on its own fast cadence so the ~5s window feels right
  setInterval(()=>{ if(!state.paused) fireStep(); }, 100);

  simLoop();
  requestAnimationFrame(frame);
  toast('Welcome to '+state.cityName+'. Build roads, zones & power!');
}

boot();
