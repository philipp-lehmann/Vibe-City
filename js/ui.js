/* ================================================================
   ui.js — the ONLY module that reads/writes HUD & panel DOM.
   Dependencies: config.js, state.js, simulation.js, renderer.js
   Holds: toolbar build, status bar / budget / population / demand /
   facing updates, tile inspector, control-button wiring, toast +
   status flash, and per-frame syncUI() that applies state -> DOM.
   ================================================================ */
import { MAP_SIZES, T, TOOLS, FACES, MONTHS, isZone } from './config.js';   // MAP SIZE
import { state, tileAt, setTool, togglePause, rotateView,
         listSaves, saveGame, loadGame, deleteSave, newGame } from './state.js'; // SAVE SYSTEM
import { igniteFire } from './simulation.js';
import { drawToolIcon, MINI_OVERLAYS, setMiniOverlay, getMiniOverlay,
         cycleZoom, zoomLabel } from './renderer.js';   // ZOOM LEVELS

const $ = id => document.getElementById(id);

/* --- toolbar: buttons with canvas icons; click selects the tool --- */
export function buildToolbar(){
  const bar=$('toolbar');
  TOOLS.forEach(tool=>{
    const btn=document.createElement('button');
    btn.className='tool'+(tool.id===state.tool?' sel':'');
    btn.dataset.tool=tool.id;
    const cv=document.createElement('canvas'); cv.width=24; cv.height=24;
    drawToolIcon(cv.getContext('2d'), tool);
    const txt=document.createElement('span');
    txt.innerHTML=`${tool.label}<span class="cost">$${tool.cost}</span>`;
    btn.appendChild(cv); btn.appendChild(txt);
    btn.onclick=()=>setTool(tool.id);
    bar.appendChild(btn);
  });
  // WATER TOOL: extra terrain tool (not part of config TOOLS) — drawn inline
  const wbtn=document.createElement('button');
  wbtn.className='tool'+(state.tool==='watertile'?' sel':'');
  wbtn.dataset.tool='watertile';
  const wcv=document.createElement('canvas'); wcv.width=24; wcv.height=24;
  const wc=wcv.getContext('2d');
  wc.fillStyle='#2a6f8f'; wc.beginPath();
  wc.moveTo(12,4); wc.lineTo(22,12); wc.lineTo(12,20); wc.lineTo(2,12); wc.closePath(); wc.fill();
  wc.fillStyle='#bfe6f5'; wc.fillRect(7,11,3,2); wc.fillRect(13,13,3,2);
  const wtx=document.createElement('span'); wtx.innerHTML='Water T<span class="cost">$20</span>';
  wbtn.appendChild(wcv); wbtn.appendChild(wtx);
  wbtn.onclick=()=>setTool('watertile');
  bar.appendChild(wbtn);
  positionDemand();
}
function positionDemand(){
  const bar=$('toolbar'), dem=$('demand');
  dem.style.top=(bar.offsetTop+bar.offsetHeight+8)+'px';
}
const barColor = k => k==='R'?'#39d353':k==='C'?'#3b9dff':'#ffd23f';

/* --- status bar / budget / population / demand / facing --- */
export function refreshHUD(){
  $('s-name').textContent = state.cityName;
  // DATE FORMAT: fixed-width "Mmm YYYY" (3-char month, 4-digit year, single space)
  const SHORT_MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const yr=1900+Math.floor(state.month/12);
  $('s-date').textContent = `${SHORT_MONTHS[state.month%12]} ${yr}`;
  $('s-face').textContent = FACES[state.rot];
  $('s-pop').textContent  = state.pop.toLocaleString();
  const f=$('s-funds');
  f.textContent = (state.funds<0?'-$':'$')+Math.abs(state.funds).toLocaleString();
  f.style.color = state.funds<0 ? 'var(--warn)' : 'var(--ink)';

  // DEMAND SYSTEM: happiness readout, coloured by band
  const hp=$('s-happy');
  hp.textContent = state.happiness;
  hp.style.color = state.happiness>=60 ? 'var(--ink)' : state.happiness>=35 ? 'var(--gold)' : 'var(--warn)';

  for(const k of ['R','C','I']){
    const el=$('dem-'+k);
    const v=state.demand[k];
    const w=Math.min(50, Math.abs(v)*50);
    el.style.width=w+'%';
    if(v>=0){ el.style.left='50%'; el.style.background = barColor(k); }
    else    { el.style.left=(50-w)+'%'; el.style.background='#7a2a2a'; }
  }
}

/* --- tile inspector for the hovered tile --- */
export function updateInspector(){
  const {x,y}=state.hover;
  const body=$('insp-body');
  const t=tileAt(x,y);
  if(!t){ body.textContent='Hover a tile…'; return; }
  const names={[T.GRASS]:'Grassland',[T.WATER]:'Water',[T.ROAD]:'Road',
    [T.POWERLINE]:'Power Line',[T.POWERPLANT]:'Coal Plant',[T.PUMP]:'Water Pump',
    [T.PARK]:'Park',[T.RES]:'Residential',[T.COM]:'Commercial',[T.IND]:'Industrial'};
  const dens=['Low','Medium','High'][t.level]||'Low';
  let rows=`<span class="k">Coords:</span> <span class="v">${x},${y}</span><br>`;
  rows+=`<span class="k">Type:</span> <span class="v">${names[t.type]}</span><br>`;
  if(isZone(t.type)){
    rows+=`<span class="k">Density:</span> <span class="v">${dens}</span><br>`;
    rows+=`<span class="k">Population:</span> <span class="v">${t.pop}</span><br>`;
    rows+=`<span class="k">Power:</span> <span class="${t.powered?'pwr-ok':'pwr-no'}">${t.powered?'YES':'NO'}</span>`;
    rows+=` <span class="k">Water:</span> <span class="${t.water?'pwr-ok':'pwr-no'}">${t.water?'YES':'NO'}</span><br>`;
    rows+=`<span class="k">Road:</span> <span class="${t.nearRoad?'pwr-ok':'pwr-no'}">${t.nearRoad?'within 3 tiles':'no road access'}</span><br>`;
    // DEMAND SYSTEM: commute + pollution status for residential tiles
    if(t.type===T.RES && !t.jobsNearby) rows+=`<span class="pwr-no">no jobs nearby</span><br>`;
    if(t.pollution>0) rows+=`<span class="k">Pollution:</span> <span class="${t.pollution>=5?'pwr-no':'v'}">${t.pollution}</span><br>`;
  } else if(t.type!==T.GRASS && t.type!==T.WATER){
    rows+=`<span class="k">Power:</span> <span class="${t.powered?'pwr-ok':'pwr-no'}">${t.powered?'ON':'OFF'}</span>`;
    if(t.type===T.PUMP) rows+=` <span class="k">Supplying:</span> <span class="${t.water?'pwr-ok':'pwr-no'}">${t.water?'YES':'NO (needs road)'}</span>`;
    rows+=`<br>`;
  }
  rows+=`<span class="k">Land value:</span> <span class="v">$${t.land}</span>`;
  if(t.onFire>0) rows+=`<br><span class="pwr-no">⚠ ON FIRE</span>`;
  body.innerHTML=rows;
}

/* --- toast + status-bar flash (own their timers) --- */
let toastTimer=null;
export function toast(msg){
  const el=$('toast');
  el.textContent=msg; el.style.display='block';
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.style.display='none',2600);
}
let flashTimer=null;
function flashStatus(msg){
  const el=$('s-flash');
  el.textContent=msg; el.style.display='inline';
  clearTimeout(flashTimer);
  flashTimer=setTimeout(()=>{ el.style.display='none'; },1800);
}

/* --- control-button wiring: buttons mutate state; labels synced below --- */
export function wireControls(){
  $('btn-pause').onclick = ()=> togglePause();
  $('btn-speed').onclick = ()=>{ state.speedIdx=(state.speedIdx+1)%state.speeds.length; };
  $('btn-zoom').onclick  = ()=> cycleZoom();   // ZOOM LEVELS: fit -> 1x -> 2x
  $('btn-rot-l').onclick = ()=> rotateView(-1);
  $('btn-rot-r').onclick = ()=> rotateView(1);
  $('btn-water').onclick = ()=>{ state.waterOverlay=!state.waterOverlay; };
  $('btn-fire').onclick  = ()=> igniteFire();
  // DEMAND SYSTEM: land-value overlay toggle + tax slider
  $('btn-landvalue').onclick = ()=>{ state.lvOverlay=!state.lvOverlay; };
  $('tax-slider').addEventListener('input', e=>{ state.taxPct = parseInt(e.target.value); });
}

/* --- per-frame DOM sync: control labels, tool highlight, indicators --- */
const SPEED_NAMES=['SLOW','NORMAL','FAST'];
function syncControls(){
  $('btn-pause').textContent = state.paused?'▶ RESUME [space]':'⏸ PAUSE [space]';
  const p=$('paused');
  p.textContent = state.paused?'PAUSED':'RUNNING';
  p.style.color = state.paused?'#ff5b3b':'#ffd23f';
  $('btn-speed').textContent = 'SPEED: '+SPEED_NAMES[state.speedIdx];
  $('btn-zoom').textContent  = 'ZOOM: '+zoomLabel();   // ZOOM LEVELS
  const zi=$('s-zoom'); if(zi) zi.textContent='Z: '+zoomLabel();
  $('btn-water').textContent = 'WATER VIEW: '+(state.waterOverlay?'ON':'OFF');
  // DEMAND SYSTEM
  $('btn-landvalue').textContent = 'LAND VALUE: '+(state.lvOverlay?'ON':'OFF');
  $('tax-val').textContent = state.taxPct+'%';
}
let lastTool=null;
function syncTools(){
  if(lastTool===state.tool) return;
  lastTool=state.tool;
  document.querySelectorAll('.tool').forEach(b=>
    b.classList.toggle('sel', b.dataset.tool===state.tool));
}

/* --- MINIMAP OVERLAYS: selector strip under the minimap (only one active) --- */
let miniBtns=[];
function buildMiniStrip(){
  const wrap=$('minimap-wrap');
  const strip=document.createElement('div');
  strip.id='mini-strip';
  strip.style.cssText='display:flex;flex-wrap:wrap;gap:2px;width:120px;margin-top:4px;';
  MINI_OVERLAYS.forEach(o=>{
    const b=document.createElement('button');
    b.textContent=o.label; b.dataset.ov=o.id; b.title=o.id;
    b.style.cssText='flex:0 0 auto;width:27px;font:9px monospace;cursor:pointer;'+
      'padding:2px 0;background:var(--panel2);color:var(--ink-mid);border:1px solid var(--line);';
    b.onclick=()=>{ setMiniOverlay(o.id); highlightMini(); };
    strip.appendChild(b); miniBtns.push(b);
  });
  wrap.appendChild(strip);
  highlightMini();
}
function highlightMini(){
  const cur=getMiniOverlay();
  miniBtns.forEach(b=>{
    const on=b.dataset.ov===cur;
    b.style.borderColor = on?'var(--ink)':'var(--line)';
    b.style.color       = on?'var(--ink)':'var(--ink-mid)';
    b.style.background   = on?'#10301a':'var(--panel2)';
    b.style.boxShadow    = on?'0 0 5px rgba(0,255,65,0.4) inset':'none';
  });
}

/* ===== SAVE SYSTEM: status-bar buttons, modal, autosave =============== */
const SAVE_SLOTS = ['slot1','slot2','slot3','slot4','slot5','slot6'];
const fmtDate = m => `${MONTHS[m%12]} ${1900+Math.floor(m/12)}`;
const liveThumb = () => { try{ return $('minimap').toDataURL(); }catch{ return null; } };

// inject SAVES + NEW buttons into the status bar
function buildSaveButtons(){
  const bar=$('statusbar');
  const mk=(id,txt)=>{ const b=document.createElement('button'); b.id=id; b.textContent=txt;
    b.style.cssText='font:11px monospace;cursor:pointer;background:var(--panel2);'+
      'color:var(--ink-mid);border:1px solid var(--line);padding:2px 7px;margin-left:6px;';
    b.onmouseenter=()=>b.style.color='var(--ink)'; b.onmouseleave=()=>b.style.color='var(--ink-mid)';
    return b; };
  const saves=mk('btn-saves','💾 SAVES'); saves.onclick=openSaves;
  const ng=mk('btn-newgame','✦ NEW');     ng.onclick=doNewGame;
  bar.appendChild(saves); bar.appendChild(ng);
  // ROAD CONNECTORS: persistent "no outside connection" warning
  const warn=document.createElement('span'); warn.id='s-roadwarn';
  warn.style.cssText='margin-left:10px;color:var(--warn);font-weight:bold;display:none;'+
    'text-shadow:0 0 6px rgba(255,91,59,0.7);';
  bar.appendChild(warn);
  // NO INITIAL PLANT: gentle startup hint for the first 6 months
  const hint=document.createElement('span'); hint.id='s-planthint';
  hint.style.cssText='margin-left:10px;color:var(--ink-dim);display:none;';
  bar.appendChild(hint);
  // ZOOM LEVELS: current zoom indicator
  const zi=document.createElement('span'); zi.id='s-zoom';
  zi.style.cssText='margin-left:10px;color:var(--ink-dim);';
  bar.appendChild(zi);
}

// build the (hidden) modal overlay once
let modal=null;
function buildSavesModal(){
  modal=document.createElement('div');
  modal.id='saves-modal';
  modal.style.cssText='position:fixed;inset:0;z-index:200;display:none;'+
    'background:rgba(5,5,12,0.78);align-items:center;justify-content:center;';
  modal.addEventListener('click',e=>{ if(e.target===modal) closeSaves(); });
  const panel=document.createElement('div');
  panel.style.cssText='background:var(--panel);border:2px solid var(--ink-dim);'+
    'padding:14px;width:560px;max-width:94vw;color:var(--ink);font:12px monospace;';
  panel.innerHTML=`<div style="display:flex;align-items:center;margin-bottom:10px;">
      <b style="color:var(--ink-dim);letter-spacing:2px;">CITY SAVES</b>
      <button id="saves-new" style="margin-left:auto;font:11px monospace;cursor:pointer;
        background:var(--panel2);color:var(--ink);border:1px solid var(--ink-dim);padding:3px 9px;">✦ NEW CITY</button>
      <button id="saves-close" style="margin-left:6px;font:11px monospace;cursor:pointer;
        background:var(--panel2);color:var(--warn);border:1px solid #5a2018;padding:3px 9px;">✕ CLOSE</button>
    </div>
    <div id="saves-grid" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;"></div>
    <div id="saves-auto" style="margin-top:10px;"></div>`;
  modal.appendChild(panel);
  document.body.appendChild(modal);
  $('saves-close').onclick=closeSaves;
  $('saves-new').onclick=doNewGame;
}
function openSaves(){ if(!modal) buildSavesModal(); renderSlots(); modal.style.display='flex'; }
// STARTUP: during the launch screen the modal stays open until a city is chosen
function closeSaves(){ if(startupMode && !gameStarted) return; if(modal) modal.style.display='none'; }

function slotCard(slot, entry){
  const card=document.createElement('div');
  card.style.cssText='background:var(--panel2);border:1px solid var(--line);padding:6px;'+
    'display:flex;flex-direction:column;gap:4px;min-height:150px;';
  if(!entry){
    card.innerHTML=`<div style="color:var(--ink-dim);text-align:center;flex:1;
        display:flex;align-items:center;justify-content:center;">— empty —</div>`;
    const b=document.createElement('button');
    b.textContent='Save Here'; b.style.cssText=btnCss('var(--ink)');
    b.onclick=()=>{ saveGame(slot, liveThumb()); renderSlots(); };
    card.appendChild(b);
    return card;
  }
  const img = entry.thumb
    ? `<img src="${entry.thumb}" style="width:100%;height:84px;object-fit:contain;image-rendering:pixelated;background:#05050c;">`
    : `<div style="height:84px;background:#05050c;"></div>`;
  card.innerHTML=`<b style="color:var(--ink);">${escapeHtml(entry.cityName||'City')}</b>
    <div style="color:var(--ink-dim);font-size:10px;">${fmtDate(entry.month||0)} · pop ${(entry.pop||0).toLocaleString()}</div>
    ${img}`;
  const row=document.createElement('div'); row.style.cssText='display:flex;gap:3px;';
  const bSave=document.createElement('button'); bSave.textContent='Save'; bSave.style.cssText=btnCss('var(--ink-mid)');
  bSave.onclick=()=>{ saveGame(slot, liveThumb()); renderSlots(); };
  const bLoad=document.createElement('button'); bLoad.textContent='Load'; bLoad.style.cssText=btnCss('var(--gold)');
  bLoad.onclick=()=>{ if(loadGame(slot)){ syncMinimapSize(); startGame(); closeSaves(); flashStatus('LOADED '+(entry.cityName||'')); } }; // MAP SIZE + STARTUP
  const bDel=document.createElement('button'); bDel.textContent='Del'; bDel.style.cssText=btnCss('var(--warn)');
  bDel.onclick=()=>{ if(confirm('Delete save "'+(entry.cityName||slot)+'"?')){ deleteSave(slot); renderSlots(); } };
  row.appendChild(bSave); row.appendChild(bLoad); row.appendChild(bDel);
  card.appendChild(row);
  return card;
}
function btnCss(col){ return `flex:1;font:10px monospace;cursor:pointer;background:var(--panel);`+
  `color:${col};border:1px solid var(--line);padding:3px 0;`; }
function escapeHtml(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function renderSlots(){
  const idx=listSaves();
  const bySlot={}; idx.forEach(e=>bySlot[e.slot]=e);
  const grid=$('saves-grid'); grid.innerHTML='';
  SAVE_SLOTS.forEach(s=> grid.appendChild(slotCard(s, bySlot[s])));
  // reserved autosave row (load-only)
  const a=bySlot['autosave']; const box=$('saves-auto'); box.innerHTML='';
  if(a){
    const card=document.createElement('div');
    card.style.cssText='background:var(--panel2);border:1px solid var(--ink-dim);padding:6px;display:flex;align-items:center;gap:8px;';
    card.innerHTML=`${a.thumb?`<img src="${a.thumb}" style="width:48px;height:48px;object-fit:contain;image-rendering:pixelated;background:#05050c;">`:''}
      <div style="flex:1;"><b>AUTOSAVE</b> <span style="color:var(--ink-dim);">${escapeHtml(a.cityName||'')} · ${fmtDate(a.month||0)} · pop ${(a.pop||0).toLocaleString()}</span></div>`;
    const bLoad=document.createElement('button'); bLoad.textContent='Load'; bLoad.style.cssText=btnCss('var(--gold)')+'flex:0 0 60px;';
    bLoad.onclick=()=>{ if(loadGame('autosave')){ syncMinimapSize(); startGame(); closeSaves(); flashStatus('LOADED AUTOSAVE'); } }; // MAP SIZE + STARTUP
    card.appendChild(bLoad); box.appendChild(card);
  }
}

// MAP SIZE: minimap canvas scales to the chosen map (Small64/Med128/Large192)
export function syncMinimapSize(){
  const m=Object.values(MAP_SIZES).find(p=>p.w===state.gridWidth);
  const px=m?m.mini:128;
  const mini=$('minimap');
  if(mini.width!==px){ mini.width=px; mini.height=px; }
  const strip=$('mini-strip'); if(strip) strip.style.width=px+'px';
}

// MAP SIZE: new game flow -> size picker modal -> name prompt -> start
let sizeModal=null, pickedSize='medium';
function buildSizeModal(){
  sizeModal=document.createElement('div');
  sizeModal.id='size-modal';
  sizeModal.style.cssText='position:fixed;inset:0;z-index:210;display:none;'+
    'background:rgba(5,5,12,0.82);align-items:center;justify-content:center;';
  sizeModal.addEventListener('click',e=>{ if(e.target===sizeModal) sizeModal.style.display='none'; });
  const panel=document.createElement('div');
  panel.style.cssText='background:var(--panel);border:2px solid var(--ink-dim);padding:16px;'+
    'width:440px;max-width:94vw;color:var(--ink);font:12px monospace;';
  panel.innerHTML=`<b style="color:var(--ink-dim);letter-spacing:2px;">NEW CITY — MAP SIZE</b>
    <div id="size-row" style="display:flex;gap:10px;margin:14px 0;"></div>
    <div style="display:flex;gap:6px;">
      <button id="size-confirm" style="flex:1;font:12px monospace;cursor:pointer;background:#10301a;
        color:var(--ink);border:1px solid var(--ink);padding:6px;">CONFIRM →</button>
      <button id="size-cancel" style="font:12px monospace;cursor:pointer;background:var(--panel2);
        color:var(--warn);border:1px solid #5a2018;padding:6px 10px;">CANCEL</button>
    </div>`;
  sizeModal.appendChild(panel);
  document.body.appendChild(sizeModal);
  const row=$('size-row');
  Object.entries(MAP_SIZES).forEach(([key,m])=>{
    const card=document.createElement('button');
    card.dataset.size=key;
    card.style.cssText='flex:1;cursor:pointer;background:var(--panel2);border:1px solid var(--line);'+
      'color:var(--ink-mid);padding:8px;display:flex;flex-direction:column;align-items:center;gap:6px;font:11px monospace;';
    // rough pixel preview of the grid aspect ratio (square presets)
    const prev=48;
    card.innerHTML=`<b>${m.label}</b>
      <div style="width:${prev}px;height:${prev}px;background:#05050c;border:1px solid var(--ink-dim);
        background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);
        background-size:${Math.max(3,prev/(m.w/8))}px ${Math.max(3,prev/(m.w/8))}px;"></div>
      <span style="color:var(--gold);">${m.dim}</span>`;
    card.onclick=()=>{ pickedSize=key; highlightSize(); };
    row.appendChild(card);
  });
  $('size-cancel').onclick=()=>{ sizeModal.style.display='none'; };
  $('size-confirm').onclick=()=>{
    sizeModal.style.display='none';
    const name=prompt('Name your city:', 'New Terminus');
    if(name===null) return;                       // cancelled at name step
    newGame(name.trim()||'New Terminus', pickedSize);  // MAP SIZE
    syncMinimapSize();
    startGame();                                       // STARTUP
    closeSaves();
    flashStatus(`NEW ${MAP_SIZES[pickedSize].label} CITY: ${state.cityName}`);
  };
}
function highlightSize(){
  sizeModal.querySelectorAll('[data-size]').forEach(c=>{
    const on=c.dataset.size===pickedSize;
    c.style.borderColor=on?'var(--ink)':'var(--line)';
    c.style.color=on?'var(--ink)':'var(--ink-mid)';
    c.style.background=on?'#10301a':'var(--panel2)';
  });
}
function doNewGame(){
  if(!sizeModal) buildSizeModal();
  pickedSize = Object.values(MAP_SIZES).find(p=>p.w===state.gridWidth) ?
               Object.keys(MAP_SIZES).find(k=>MAP_SIZES[k].w===state.gridWidth) : 'medium';
  highlightSize();
  sizeModal.style.display='flex';
}

// AUTOSAVE INTERVAL: autosave silently in the background — no status flash
export function doAutosave(){
  saveGame('autosave', liveThumb());
}

/* STARTUP: gate the sim loop behind a choice (load a city or confirm new game) */
let startupMode=false, gameStarted=false, onGameStart=null;
export function setGameStartHandler(fn){ onGameStart=fn; }
function startGame(){ if(!gameStarted){ gameStarted=true; if(onGameStart) onGameStart(); } }
// open the saves modal as the launch screen (can't be dismissed without choosing)
export function openStartup(){
  startupMode=true;
  openSaves();
  const close=$('saves-close'); if(close) close.style.display='none';   // must pick load/new
}

/* --- init + the single per-frame entry point main calls --- */
export function initUI(){
  buildToolbar(); wireControls(); buildMiniStrip(); /* MINIMAP OVERLAYS */
  buildSaveButtons(); buildSavesModal();             /* SAVE SYSTEM */
  syncMinimapSize();                                 /* MAP SIZE: match default map */
}

export function syncUI(){
  refreshHUD();
  syncControls();
  syncTools();
  updateInspector();
  // ROAD CONNECTORS: persistent outside-connection warning
  const rw=$('s-roadwarn');
  if(rw){
    if(state.outsideConnections===0){ rw.style.display='inline'; rw.textContent='⚠ No outside connection — city cannot grow'; }
    else rw.style.display='none';
  }
  // NO INITIAL PLANT: first-6-months reminder to build power
  const ph=$('s-planthint');
  if(ph){
    if(state.month<6){ ph.style.display='inline'; ph.textContent='⚡ Build a power plant to start growing your city.'; }
    else ph.style.display='none';
  }
  while(state.notices.length) toast(state.notices.shift());   // drain sim/input notices
  if(state.flash){ flashStatus(state.flash); state.flash=null; }
}
