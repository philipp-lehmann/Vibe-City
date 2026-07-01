/* ================================================================
   ui.js — the ONLY module that reads/writes HUD & panel DOM.
   Dependencies: config.js, state.js, simulation.js, renderer.js
   Holds: toolbar build, status bar / budget / population / demand /
   facing updates, tile inspector, control-button wiring, toast +
   status flash, and per-frame syncUI() that applies state -> DOM.
   ================================================================ */
import { MAP_SIZES, WATER_LEVELS, DEFAULT_WATER, T, TOOLS, FACES, SHORT_MONTHS, isZone } from './config.js';   // MAP SIZE / WATER AMOUNT
import {
  state, tileAt, setTool, togglePause, rotateView,
  listSaves, saveGame, loadGame, deleteSave, newGame
} from './state.js'; // SAVE SYSTEM
import { igniteFire } from './simulation.js';
import { scenarioManager } from './scenario.js';              // SCENARIOS
import {
  drawToolIcon, MINI_OVERLAYS, setMiniOverlay, getMiniOverlay,
  cycleZoom, zoomLabel
} from './renderer.js';   // ZOOM LEVELS
import { TERRAIN_TOOLS } from './input.js';   // TERRAIN TOOLS
import { exportAllAssets } from './export_assets.js';   // SVG EXPORT

const $ = id => document.getElementById(id);

/* --- toolbar: buttons with canvas icons; click selects the tool --- */
export function buildToolbar() {
  const toolBody = $('tool-body');
  TOOLS.forEach(tool => {
    const btn = document.createElement('button');
    btn.className = 'tool' + (tool.id === state.tool ? ' sel' : '');
    btn.dataset.tool = tool.id;
    const cv = document.createElement('canvas'); cv.width = 24; cv.height = 24;
    drawToolIcon(cv.getContext('2d'), tool);
    const txt = document.createElement('span');
    txt.innerHTML = `${tool.label}<span class="cost">$${tool.cost}</span>`;
    btn.appendChild(cv); btn.appendChild(txt);
    btn.onclick = () => setTool(tool.id);
    toolBody.appendChild(btn);
  });
  const terrainBody = $('terrain-body');
  for (const [id, cfg] of Object.entries(TERRAIN_TOOLS)) {
    const b = document.createElement('button');
    b.className = 'tool' + (state.tool === id ? ' sel' : ''); b.dataset.tool = id;
    const cv = document.createElement('canvas'); cv.width = 24; cv.height = 24; const c = cv.getContext('2d');
    c.fillStyle = cfg.color; c.beginPath();
    c.moveTo(12, 4); c.lineTo(22, 12); c.lineTo(12, 20); c.lineTo(2, 12); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.4)'; c.stroke();
    const tx = document.createElement('span'); tx.innerHTML = `${cfg.label}<span class="cost">§${cfg.cost}</span>`;
    b.appendChild(cv); b.appendChild(tx);
    b.onclick = () => setTool(id);
    terrainBody.appendChild(b);
  }
}
const barColor = k => k === 'R' ? '#7caa6b' : k === 'C' ? '#8a5cf6' : '#d9a72c';

/* --- status bar / budget / population / demand / facing --- */
export function refreshHUD() {
  $('s-name').textContent = state.cityName;
  // DATE FORMAT: fixed-width "Mmm YYYY" (3-char month, 4-digit year, single space)
  const yr = 1900 + Math.floor(state.month / 12);
  $('s-date').textContent = `${SHORT_MONTHS[state.month % 12]} ${yr}`;
  $('s-face').textContent = FACES[state.rot];
  $('s-pop').textContent = state.pop.toLocaleString();
  const f = $('s-funds');
  f.textContent = (state.funds < 0 ? '-$' : '$') + Math.abs(state.funds).toLocaleString();
  f.style.color = state.funds < 0 ? 'var(--warn)' : 'var(--ink)';

  // DEMAND SYSTEM: happiness readout, coloured by band
  const hp = $('s-happy');
  hp.textContent = state.happiness;
  hp.style.color = state.happiness >= 60 ? 'var(--ink)' : state.happiness >= 35 ? 'var(--gold)' : 'var(--warn)';

  for (const k of ['R', 'C', 'I']) {
    const el = $('dem-' + k);
    const v = state.demand[k];
    const w = Math.min(50, Math.abs(v) * 50);
    el.style.width = w + '%';
    if (v >= 0) { el.style.left = '50%'; el.style.background = barColor(k); }
    else { el.style.left = (50 - w) + '%'; el.style.background = '#7a2a2a'; }
  }
}

/* ===== STATISTICS: statusbar sparklines + the Statistics dropdown panel.
   state.history (pop/happiness/funds, last 24 monthly samples) is owned by
   state.js and appended to once per monthlyTick. This module only reads it
   and draws/refreshes the DOM — same decoupling rule as the rest of ui.js. */
function drawSparkline(canvas, values, opts = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!values.length) return;
  const min = opts.min ?? Math.min(...values);
  const max = opts.max ?? Math.max(...values);
  const range = (max - min) || 1;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = values.length > 1 ? (i / (values.length - 1)) * (w - 1) : w - 1;
    const y = h - 1 - ((v - min) / range) * (h - 2);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = opts.color || '#e8e8e8';
  ctx.lineWidth = 1;
  ctx.stroke();
}

// STATISTICS: per-metric colors live in css/ui.css (--stat-pop/--stat-happiness/
// --stat-funds) so the statusbar sparklines, the panel's big combined chart,
// and its legend swatches all stay in sync from one place. Read once and cache
// — :root custom properties don't change at runtime.
let _statColorCache = null;
function getStatColors() {
  if (_statColorCache) return _statColorCache;
  const cs = getComputedStyle(document.documentElement);
  _statColorCache = {
    pop: cs.getPropertyValue('--stat-pop').trim() || '#e8e8e8',
    happiness: cs.getPropertyValue('--stat-happiness').trim() || '#ffd23f',
    funds: cs.getPropertyValue('--stat-funds').trim() || '#2bd1d4',
  };
  return _statColorCache;
}

// NOTE: history arrays are capped at HISTORY_LEN (24) and shift() once full,
// so array length stops changing after month 24 — guard on state.month
// (always increasing) instead, or redraws silently stop forever past month 24.
let _statHistMonth = -1;
let _chartHistMonth = -1;
// New Game / Load both reset state.month to a value the redraw guards may
// already hold from a prior city — force the next draw call through.
function resetStatsHistoryGuards() { _statHistMonth = -1; _chartHistMonth = -1; }
function drawSparklines() {
  const h = state.history;
  if (state.month === _statHistMonth) return;   // only redraw when a new sample lands
  _statHistMonth = state.month;
  const c = getStatColors();
  drawSparkline($('spark-pop'), h.pop, { color: c.pop });
  drawSparkline($('spark-happy'), h.happiness, { min: 0, max: 100, color: c.happiness });
  drawSparkline($('spark-funds'), h.funds, { color: c.funds });
}

// draw every toggled-on series on the bigger panel chart. Population/funds
// have no natural bound, so they're auto-ranged to their own min/max; happiness
// is a fixed 0-100 score (same as its small statusbar sparkline), so it gets a
// fixed range instead — auto-ranging it would either flatten small swings to
// fill the whole height or, worse, collapse a near-constant value to the
// bottom edge instead of showing where it actually sits on the 0-100 scale.
function drawStatsChart(force) {
  const canvas = $('stats-chart');
  if (!canvas || !isStatsPanelOpen()) return;
  const h = state.history;
  if (!force && state.month === _chartHistMonth) return;
  _chartHistMonth = state.month;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, ch = canvas.height;
  ctx.clearRect(0, 0, w, ch);
  const c = getStatColors();
  for (const key of ['pop', 'happiness', 'funds']) {
    if (!state.statsVisible[key]) continue;
    const values = h[key];
    if (!values.length) continue;
    const min = key === 'happiness' ? 0 : Math.min(...values);
    const max = key === 'happiness' ? 100 : Math.max(...values);
    const range = (max - min) || 1;
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = values.length > 1 ? (i / (values.length - 1)) * (w - 4) + 2 : w - 2;
      const y = ch - 4 - ((v - min) / range) * (ch - 8);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = c[key];
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}



let _statsDidAutoPause = false;   // true only if WE paused the sim for the panel (so we don't un-pause a manual pause)
function isStatsPanelOpen() { return $('stats-panel')?.style.display === 'flex'; }
function openStatsPanel(anchorEl) {
  $('stats-panel').style.display = 'flex';
  if (state.statsAutoPause && !state.paused) { _statsDidAutoPause = true; state.paused = true; }
  refreshStatsPanel();
  drawStatsChart(true);
}
function closeStatsPanel() {
  $('stats-panel').style.display = 'none';
  if (_statsDidAutoPause) { state.paused = false; _statsDidAutoPause = false; }
}

function fmtDelta(n) { const r = Math.round(n); return (r > 0 ? '+' : '') + r.toLocaleString(); }
function deltaColor(n) { return n > 0 ? 'var(--gold)' : n < 0 ? 'var(--warn)' : 'var(--ink-dim)'; }

function refreshStatsPanel() {
  if (!isStatsPanelOpen()) return;
  const h = state.history;
  const lastDelta = arr => arr.length >= 2 ? arr[arr.length - 1] - arr[arr.length - 2] : 0;

  $('stat-pop').textContent = state.pop.toLocaleString();
  const dPop = lastDelta(h.pop);
  $('stat-pop-delta').textContent = fmtDelta(dPop);
  $('stat-pop-delta').style.color = deltaColor(dPop);

  $('stat-happy').textContent = state.happiness;
  const dHappy = lastDelta(h.happiness);
  $('stat-happy-delta').textContent = fmtDelta(dHappy);
  $('stat-happy-delta').style.color = deltaColor(dHappy);

  const fv = $('stat-funds');
  fv.textContent = (state.funds < 0 ? '-$' : '$') + Math.abs(state.funds).toLocaleString();
  fv.style.color = state.funds < 0 ? 'var(--warn)' : 'var(--ink)';
  const dFunds = lastDelta(h.funds);
  const fd = $('stat-funds-delta');
  fd.textContent = (dFunds >= 0 ? '+$' : '-$') + Math.abs(Math.round(dFunds)).toLocaleString();
  fd.style.color = deltaColor(dFunds);

  drawStatsChart();
}

// maps each statusbar trigger's data-stats-trigger value (matches its label
// text) to the state.statsVisible / state.history key it represents
const TRIGGER_TO_STAT = { population: 'pop', happyness: 'happiness', funds: 'funds' };

function initStatsPanel() {
  // clicking a stat's own trigger opens the panel anchored there and makes
  // sure that metric's line is switched on; re-clicking the same one closes it
  document.querySelectorAll('[data-stats-trigger]').forEach(lbl => {
    const grp = lbl.closest('.grp') || lbl;
    const statKey = TRIGGER_TO_STAT[lbl.dataset.statsTrigger];
    grp.onclick = () => {
      if (isStatsPanelOpen()) { closeStatsPanel(); return; }
      if (statKey && !state.statsVisible[statKey]) {
        state.statsVisible[statKey] = true;
        const toggle = $('stat-toggle-' + statKey);
        if (toggle) toggle.checked = true;
      }
      openStatsPanel(grp);
    };
  });
  $('stats-head').onclick = closeStatsPanel;

  // STATISTICS: per-row checkboxes show/hide that metric's line on the chart
  document.querySelectorAll('.stat-toggle').forEach(toggle => {
    const key = toggle.closest('.stat-row').dataset.stat;
    toggle.checked = state.statsVisible[key];
    toggle.onchange = e => {
      state.statsVisible[key] = e.target.checked;
      drawStatsChart(true);
    };
  });

  const cb = $('stats-autopause');
  cb.checked = state.statsAutoPause;
  cb.onchange = e => {
    state.statsAutoPause = e.target.checked;
    if (!isStatsPanelOpen()) return;
    if (state.statsAutoPause && !state.paused) { _statsDidAutoPause = true; state.paused = true; }
    else if (!state.statsAutoPause && _statsDidAutoPause) { _statsDidAutoPause = false; state.paused = false; }
  };
  window.addEventListener('resize', () => { if (isStatsPanelOpen()) positionStatsPanel(); });
}

/* --- tile inspector for the hovered tile --- */
export function updateInspector() {
  const { x, y } = state.hover;
  const panel = $('inspector');
  const t = tileAt(x, y);
  if (!t) { panel.style.display = 'none'; return; }
  panel.style.display = '';

  // SCENARIOS: contract tile — show contract info instead of standard tile info
  if (t.contractId) {
    const scenario = scenarioManager.getScenario(t.contractId);
    if (scenario && scenario.status === 'ACTIVE') {
      panel.innerHTML = buildContractInspectorHTML(scenario);
      const declineBtn = document.createElement('button');
      declineBtn.textContent = 'Decline contract';
      declineBtn.className = 'contract-decline';
      declineBtn.style.marginTop = 'var(--sp-2)';
      declineBtn.onclick = () => showDeclineModal(t.contractId);
      panel.querySelector('#insp-body').appendChild(declineBtn);
      return;
    }
  }

  const body = $('insp-body');
  const names = {
    [T.GRASS]: 'Grassland', [T.WATER]: 'Water', [T.ROAD]: 'Road',
    [T.POWERLINE]: 'Power Line', [T.POWERPLANT]: 'Coal Plant', [T.PUMP]: 'Water Pump',
    [T.PARK]: 'Park', [T.RES]: 'Residential', [T.COM]: 'Commercial', [T.IND]: 'Industrial'
  };
  panel.querySelector('.ttl').textContent = names[t.type] || 'Tile';
  const dens = ['Low', 'Medium', 'High'][t.level] || 'Low';
  let rows = `<span class="k">Coords:</span> <span class="v">${x},${y}</span><br>`;
  rows += `<span class="k">Type:</span> <span class="v">${names[t.type]}</span><br>`;
  if (isZone(t.type)) {
    rows += `<span class="k">Density:</span> <span class="v">${dens}</span><br>`;
    rows += `<span class="k">Population:</span> <span class="v">${t.pop}</span><br>`;
    rows += `<span class="k">Power:</span> <span class="${t.powered ? 'pwr-ok' : 'pwr-no'}">${t.powered ? 'YES' : 'NO'}</span>`;
    rows += ` <span class="k">Water:</span> <span class="${t.water ? 'pwr-ok' : 'pwr-no'}">${t.water ? 'YES' : 'NO'}</span><br>`;
    rows += `<span class="k">Road:</span> <span class="${t.nearRoad ? 'pwr-ok' : 'pwr-no'}">${t.nearRoad ? 'within 3 tiles' : 'no road access'}</span><br>`;
    // DEMAND SYSTEM: commute + pollution status for residential tiles
    if (t.type === T.RES && !t.jobsNearby) rows += `<span class="pwr-no">no jobs nearby</span><br>`;
    if (t.pollution > 0) rows += `<span class="k">Pollution:</span> <span class="${t.pollution >= 5 ? 'pwr-no' : 'v'}">${t.pollution}</span><br>`;
  } else if (t.type !== T.GRASS && t.type !== T.WATER) {
    rows += `<span class="k">Power:</span> <span class="${t.powered ? 'pwr-ok' : 'pwr-no'}">${t.powered ? 'ON' : 'OFF'}</span>`;
    if (t.type === T.PUMP) rows += ` <span class="k">Supplying:</span> <span class="${t.water ? 'pwr-ok' : 'pwr-no'}">${t.water ? 'YES' : 'NO (needs road)'}</span>`;
    rows += `<br>`;
  }
  rows += `<span class="k">Land value:</span> <span class="v">$${t.land}</span>`;
  if (t.onFire > 0) rows += `<br><span class="pwr-no">⚠ ON FIRE</span>`;
  body.innerHTML = rows;
}

/* --- Notification centre --- */
let _prevPersistentKeys = [];

function syncNotifBadge() {
  const badge = $('notif-badge');
  if (!badge) return;
  const n = ($('notif-log')?.childElementCount ?? 0)
           + ($('notif-persistent')?.childElementCount ?? 0);
  badge.textContent = n || '';
  badge.style.display = n ? 'inline' : 'none';
}

function openNotifPanel() {
  const body = $('notif-body'); const arrow = $('notif-arrow');
  if (body)  body.classList.add('open');
  if (arrow) arrow.textContent = '▴';
}

function addTransientNotif(msg, kind = 'city') {
  const log = $('notif-log');
  if (!log) return;
  const el = document.createElement('div');
  el.className = 'notif-entry notif-' + kind;
  el.textContent = msg;
  log.prepend(el);
  syncNotifBadge();
  openNotifPanel();
  setTimeout(() => { el.remove(); syncNotifBadge(); }, 10_000);
}

function syncPersistentWarnings() {
  const pers = $('notif-persistent');
  if (!pers) return;
  const active = [];
  if (state.outsideConnections === 0)
    active.push('⚠ No outside connection — city cannot grow');
  if (state.powerPlantCount === 0)
    active.push('⚡ No power plant — city cannot grow');
  const added = active.filter(w => !_prevPersistentKeys.includes(w));
  _prevPersistentKeys = active;
  pers.innerHTML = active
    .map(w => `<div class="notif-entry notif-warn">${w}</div>`)
    .join('');
  syncNotifBadge();
  if (added.length) openNotifPanel();
}

function initAdminPanel() {
  document.querySelectorAll('.ap-header').forEach(h => {
    h.onclick = () => {
      const body = h.nextElementSibling;
      const open = body.classList.toggle('open');
      h.querySelector('.ap-arrow').textContent = open ? '▴' : '▾';
    };
  });
}

function initNotifCenter() {
  $('notif-header').onclick = () => {
    const isOpen = $('notif-body').classList.toggle('open');
    $('notif-arrow').textContent = isOpen ? '▴' : '▾';
  };
}

export function toast(msg)     { addTransientNotif(msg, 'city'); }
function flashStatus(msg)      { addTransientNotif(msg, 'action'); }

/* --- control-button wiring: buttons mutate state; labels synced below --- */
export function wireControls() {
  $('btn-pause').onclick = () => togglePause();
  $('btn-speed').onclick = () => { state.speedIdx = (state.speedIdx + 1) % state.speeds.length; };
  $('btn-zoom').onclick = () => cycleZoom();   // ZOOM LEVELS: fit -> 1x -> 2x
  $('btn-rot-l').onclick = () => rotateView(-1);
  $('btn-rot-r').onclick = () => rotateView(1);
  $('btn-fire').onclick = () => igniteFire();
  $('tax-slider').addEventListener('input', e => { state.taxPct = parseInt(e.target.value); });
  $('btn-saves').onclick = openSaves;
  $('btn-newgame').onclick = doNewGame;
}

/* --- per-frame DOM sync: control labels, tool highlight, indicators --- */
function syncControls() {
  const pb = $('btn-pause');
  pb.textContent = state.paused ? '▶ Paused' : '⏸ Running';
  pb.style.color = state.paused ? 'var(--warn)' : 'var(--gold)';
  $('btn-speed').innerHTML = [0,1,2].map(i =>
    `<span style="opacity:${i <= state.speedIdx ? 1 : 0.25};pointer-events:none">▶</span>`).join('');
  $('btn-zoom').textContent = zoomLabel();
  $('tax-val').textContent = state.taxPct + '%';
}
let lastTool = null;
function syncTools() {
  if (lastTool === state.tool) return;
  lastTool = state.tool;
  document.querySelectorAll('.tool').forEach(b =>
    b.classList.toggle('sel', b.dataset.tool === state.tool));
  state.waterOverlay = (state.tool === 'pump');
}

/* --- MINIMAP OVERLAYS: selector strip under the minimap (only one active) --- */
let miniBtns = [];
function buildMiniStrip() {
  const wrap = $('minimap-wrap');
  const strip = document.createElement('div');
  strip.id = 'mini-strip';
  strip.style.cssText = 'display:flex;flex-wrap:wrap;gap:2px;width:120px;margin-top:4px;';
  MINI_OVERLAYS.forEach(o => {
    const b = document.createElement('button');
    b.textContent = o.label; b.dataset.ov = o.id; b.title = o.id;
    b.style.cssText = 'flex:0 0 calc(50% - 1px);pointer-events:auto;';
    b.onclick = () => { setMiniOverlay(o.id); highlightMini(); };
    strip.appendChild(b); miniBtns.push(b);
  });
  wrap.appendChild(strip);
  highlightMini();
}
function highlightMini() {
  const cur = getMiniOverlay();
  miniBtns.forEach(b => {
    const on = b.dataset.ov === cur;
    b.style.borderColor = on ? 'var(--ink)' : 'var(--line)';
    b.style.color = on ? 'var(--ink)' : 'var(--ink-mid)';
    b.style.background = on ? '#2a2a2a' : 'var(--panel2)';
    b.style.boxShadow = on ? '0 0 5px rgba(232,232,232,0.4) inset' : 'none';
  });
}

/* ===== SAVE SYSTEM: status-bar buttons, modal, autosave =============== */
const SAVE_SLOTS = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6'];
const fmtDate = m => `${SHORT_MONTHS[m % 12]} ${1900 + Math.floor(m / 12)}`;
const liveThumb = () => { try { return $('minimap').toDataURL(); } catch { return null; } };

// build the (hidden) modal overlay once
let modal = null;
function buildSavesModal() {
  modal = document.createElement('div');
  modal.id = 'saves-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:200;display:none;' +
    'background:rgba(5,5,12,0.78);align-items:center;justify-content:center;';
  modal.addEventListener('click', e => { if (e.target === modal) closeSaves(); });
  const panel = document.createElement('div');
  panel.classList = 'modal-panel';
  panel.style.cssText = 'background:var(--panel);border:1px solid var(--ink-dim);' +
    'padding:14px;width:560px;max-width:94vw;color:var(--ink);font:12px \'JetBrains Mono\', monospace;';
  panel.innerHTML = `<div style="display:flex;align-items:center;margin-bottom:10px;"">
      <h2 class="modal-title">Vibe City</h2>
      <button id="saves-new" class="border" style="margin-left:auto;">New City</button>
      <button id="saves-close">✕ CLOSE</button>
    </div>
    <div id="saves-grid" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;"></div>
    <div id="saves-auto" style="margin-top:10px;"></div>`;
  modal.appendChild(panel);
  document.body.appendChild(modal);
  $('saves-close').onclick = closeSaves;
  $('saves-new').onclick = doNewGame;
}
function openSaves() { if (!modal) buildSavesModal(); renderSlots(); modal.style.display = 'flex'; }
// STARTUP: during the launch screen the modal stays open until a city is chosen
function closeSaves() { if (startupMode && !gameStarted) return; if (modal) modal.style.display = 'none'; }

function slotCard(slot, entry) {
  const card = document.createElement('div');
  card.style.cssText = 'background:var(--panel2);border:1px solid var(--line);padding:6px;' +
    'display:flex;flex-direction:column;gap:4px;min-height:150px;';
  if (!entry) {
    card.innerHTML = ``;
    const b = document.createElement('button');
    b.textContent = 'Save Here'; b.style.cssText = btnCss('var(--ink)');
    b.onclick = () => { saveGame(slot, liveThumb()); renderSlots(); };
    card.appendChild(b);
    return card;
  }
  const img = entry.thumb
    ? `<img src="${entry.thumb}" style="width:100%;height:84px;object-fit:contain;image-rendering:pixelated;background:#05050c;">`
    : `<div style="height:84px;background:#05050c;"></div>`;
  card.innerHTML = `<b style="color:var(--ink);">${escapeHtml(entry.cityName || 'City')}</b>
    <div style="color:var(--ink-dim);font-size:var(--font-sm)">${fmtDate(entry.month || 0)} · pop ${(entry.pop || 0).toLocaleString()}</div>
    ${img}`;
  const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:var(--sp-1);';

  const bLoad = document.createElement('button'); bLoad.textContent = 'Load'; bLoad.style.cssText = btnCss('var(--gold)');
  bLoad.onclick = () => { if (loadGame(slot)) { syncMinimapSize(); resetStatsHistoryGuards(); resetGameUI(); startGame(); closeSaves(); flashStatus('Loaded ' + (entry.cityName || '')); } }; // MAP SIZE + STARTUP
  const bDel = document.createElement('button'); bDel.textContent = 'Delete'; bDel.style.cssText = btnCss('var(--warn)');
  bDel.onclick = () => { if (confirm('Delete save "' + (entry.cityName || slot) + '"?')) { deleteSave(slot); renderSlots(); } };
  row.appendChild(bLoad); row.appendChild(bDel);
  card.appendChild(row);
  return card;
}
function btnCss(col) {
  return `flex:1;font-size:var(--font-sm);` +
    `color:${col};`;
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function renderSlots() {
  const idx = listSaves();
  const bySlot = {}; idx.forEach(e => bySlot[e.slot] = e);
  const grid = $('saves-grid'); grid.innerHTML = '';
  SAVE_SLOTS.forEach(s => grid.appendChild(slotCard(s, bySlot[s])));
  // reserved autosave row (load-only)
  const a = bySlot['autosave']; const box = $('saves-auto'); box.innerHTML = '';
  if (a) {
    const card = document.createElement('div');
    card.classList = 'card';
    card.style.cssText = 'display:flex;align-items:center;gap:8px;';
    card.innerHTML = `${a.thumb ? `<img src="${a.thumb}" style="width:48px;height:48px;object-fit:contain;image-rendering:pixelated;background:#05050c;">` : ''}
      <div style="flex:1;"><b>AUTOSAVE</b> <span style="color:var(--ink-dim);">${escapeHtml(a.cityName || '')} · ${fmtDate(a.month || 0)} · pop ${(a.pop || 0).toLocaleString()}</span></div>`;
    const bLoad = document.createElement('button'); bLoad.textContent = 'Load'; bLoad.style.cssText = btnCss('var(--gold)') + 'flex:0 0 60px;';
    bLoad.onclick = () => { if (loadGame('autosave')) { syncMinimapSize(); resetStatsHistoryGuards(); resetGameUI(); startGame(); closeSaves(); flashStatus('Loaded autosave'); } }; // MAP SIZE + STARTUP
    card.appendChild(bLoad); box.appendChild(card);
  }
}

export function syncMinimapSize() {
  const mini = $('minimap');
  if (mini.width !== 120) { mini.width = 120; mini.height = 120; }
  const strip = $('mini-strip'); if (strip) strip.style.width = '120px';
}

// MAP SIZE: new game flow -> size picker modal -> name prompt -> start
const _CITY_FEATURES = ['Amber', 'Ash', 'Bay', 'Boulder', 'Brook', 'Cedar', 'Cinder', 'Clay', 'Cliff',
  'Coal', 'Cobble', 'Copper', 'Crest', 'Crown', 'Dell', 'Dune', 'Dust', 'Elm', 'Ember', 'Fern',
  'Flint', 'Fog', 'Forge', 'Frost', 'Glen', 'Gold', 'Granite', 'Gravel', 'Harbor', 'Hazel',
  'Heath', 'Hickory', 'Highland', 'Hill', 'Hollow', 'Iron', 'Ivy', 'Jade', 'Jasper', 'Lake',
  'Larch', 'Lark', 'Laurel', 'Lime', 'Linden', 'Maple', 'Marsh', 'Mesa', 'Mill', 'Mist',
  'Moss', 'Oak', 'Obsidian', 'Ore', 'Peak', 'Pine', 'Quartz', 'Rail', 'Reed', 'Ridge',
  'River', 'Rock', 'Rust', 'Salt', 'Sand', 'Shale', 'Shore', 'Silver', 'Slate', 'Smoke',
  'Soot', 'Spruce', 'Steel', 'Stone', 'Storm', 'Summit', 'Thorn', 'Tide', 'Timber', 'Vale'];
const _CITY_SUFFIXES = ['borough', 'bridge', 'burg', 'bury', 'city', 'dale', 'field', 'ford',
  'gate', 'grove', 'haven', 'heights', 'hill', 'hollow', 'hurst', 'junction', 'landing',
  'moor', 'mount', 'port', 'ridge', 'shore', 'side', 'stead', 'ton', 'vale', 'view',
  'ville', 'ward', 'wick'];
function randomCityName() {
  const f = _CITY_FEATURES[Math.random() * _CITY_FEATURES.length | 0];
  const s = _CITY_SUFFIXES[Math.random() * _CITY_SUFFIXES.length | 0];
  return f + s;
}
let sizeModal = null, pickedSize = 'medium', pickedWater = DEFAULT_WATER;   // WATER AMOUNT
function buildSizeModal() {
  sizeModal = document.createElement('div');
  sizeModal.id = 'size-modal';
  sizeModal.addEventListener('click', e => { if (e.target === sizeModal) sizeModal.style.display = 'none'; });
  const panel = document.createElement('div');
  panel.className = 'modal-panel';
  panel.innerHTML = `<h2 class="modal-title">New City</h2>
    <div class="modal-field">
      <label>City Name</label>
      <div class="modal-field-row">
        <input id="city-name-input" class="modal-input" type="text" maxlength="48">
        <button id="city-name-shuffle" class="btn-shuffle" title="Shuffle name">Random</button>
      </div>
    </div>
    <div class="modal-field">
      <label>Map Size</label>
      <div id="size-row"></div>
    </div>
    <div class="modal-field">
      <label>Water</label>
      <div id="water-row"></div>
    </div>
    <div class="modal-actions">
      <button id="size-confirm" class="btn-confirm">Start</button>
      <button id="size-cancel" class="btn-cancel">Cancel</button>
    </div>`;
  sizeModal.appendChild(panel);
  document.body.appendChild(sizeModal);
  const row = $('size-row');
  Object.entries(MAP_SIZES).forEach(([key, m]) => {
    const card = document.createElement('button');
    card.dataset.size = key;
    card.className = 'size-card';
    // rough pixel preview of the grid aspect ratio (square presets)
    const prev = 48;
    const bsz = `${Math.max(3, prev / (m.w / 8))}px ${Math.max(3, prev / (m.w / 8))}px`;
    card.innerHTML = `<b>${m.label}</b>
      <div class="size-card-preview" style="width:${prev}px;height:${prev}px;background-size:${bsz};"></div>
      <span class="size-dim">${m.dim}</span>`;
    card.onclick = () => { pickedSize = key; highlightSize(); };
    row.appendChild(card);
  });
  // WATER AMOUNT: same card style as size, just a % label instead of a preview
  const waterRow = $('water-row');
  Object.entries(WATER_LEVELS).forEach(([key, w]) => {
    const card = document.createElement('button');
    card.dataset.water = key;
    card.className = 'size-card';
    card.innerHTML = `<b>${w.label}</b><span class="size-dim">Water</span>`;
    card.onclick = () => { pickedWater = key; highlightWater(); };
    waterRow.appendChild(card);
  });
  $('city-name-shuffle').onclick = () => { $('city-name-input').value = randomCityName(); };
  $('size-cancel').onclick = () => { sizeModal.style.display = 'none'; };
  $('size-confirm').onclick = () => {
    sizeModal.style.display = 'none';
    const name = ($('city-name-input').value || '').trim() || randomCityName();
    newGame(name, pickedSize, WATER_LEVELS[pickedWater].pct);  // MAP SIZE / WATER AMOUNT
    syncMinimapSize();
    resetStatsHistoryGuards();
    resetGameUI();
    startGame();                                       // STARTUP
    closeSaves();
    flashStatus(`NEW ${MAP_SIZES[pickedSize].label} CITY: ${state.cityName}`);
  };
}
function highlightSize() {
  sizeModal.querySelectorAll('[data-size]').forEach(c => {
    const on = c.dataset.size === pickedSize;
    c.style.borderColor = on ? 'var(--ink)' : 'var(--line)';
    c.style.color = on ? 'var(--ink)' : 'var(--ink-mid)';
    c.style.background = on ? '#2a2a2a' : 'var(--panel2)';
  });
}
function highlightWater() {
  sizeModal.querySelectorAll('[data-water]').forEach(c => {
    const on = c.dataset.water === pickedWater;
    c.style.borderColor = on ? 'var(--ink)' : 'var(--line)';
    c.style.color = on ? 'var(--ink)' : 'var(--ink-mid)';
    c.style.background = on ? '#2a2a2a' : 'var(--panel2)';
  });
}
function doNewGame() {
  if (!sizeModal) buildSizeModal();
  pickedSize = Object.values(MAP_SIZES).find(p => p.w === state.gridWidth) ?
    Object.keys(MAP_SIZES).find(k => MAP_SIZES[k].w === state.gridWidth) : 'medium';
  highlightSize();
  highlightWater();
  $('city-name-input').value = randomCityName();
  sizeModal.style.display = 'flex';
  setTimeout(() => $('city-name-input').select(), 50);
}

// AUTOSAVE INTERVAL: autosave silently in the background — no status flash
export function doAutosave() {
  saveGame('autosave', liveThumb());
}

/* STARTUP: gate the sim loop behind a choice (load a city or confirm new game) */
let startupMode = false, gameStarted = false, onGameStart = null;
export function setGameStartHandler(fn) { onGameStart = fn; }
function startGame() { if (!gameStarted) { gameStarted = true; if (onGameStart) onGameStart(); } }
// open the saves modal as the launch screen (can't be dismissed without choosing)
export function openStartup() {
  startupMode = true;
  openSaves();
  const close = $('saves-close'); if (close) close.style.display = 'none';   // must pick load/new
}

// SVG EXPORT: hidden one-time asset-export button — only present with ?export=true
// (e.g. localhost?export=true). Clicking it runs exportAllAssets(), which
// downloads every asset variant as an individual .svg.
function buildExportButton() {
  if (new URLSearchParams(location.search).get('export') !== 'true') return;
  const btn = document.createElement('button'); btn.id = 'btn-export-svg';
  btn.textContent = 'Export SVGs';
  btn.onclick = () => {
    btn.disabled = true;
    exportAllAssets()
      .catch(err => { console.error('[SVG EXPORT]', err); flashStatus('Export failed — see console'); })
      .finally(() => { btn.disabled = false; });
  };
  const adminFirst = $('admin-panel')?.querySelector('.ap-inner');
  (adminFirst || document.body).appendChild(btn);
}

/* ===== SCENARIOS: contracts panel, modals, inspector =============== */

// Track whether we paused the game to show a contract offer
let _pausedForContract = false;

// ── Contracts panel ───────────────────────────────────────────────

let _contractsPanelFP = '';   // fingerprint — only rebuild DOM when data changes

function syncContractsPanel() {
  const panel = $('contracts-panel');
  if (!panel) return;

  const contracts = scenarioManager.getContractStatus();

  // Cheap fingerprint — avoids destroying button elements every frame (which
  // swallows click events before they fire, the same bug as the placement banner).
  const fp = contracts.map(c =>
    `${c.id}:${c.status}:${c.deadlineIn}:${c.stageStatus}:` +
    Object.entries(c.requirementDetails).map(([k, v]) => `${k}=${v.current}`).join(',')
  ).join('|');
  if (fp === _contractsPanelFP) return;
  _contractsPanelFP = fp;

  if (contracts.length === 0) {
    panel.innerHTML = '';
    return;
  }

  const fmt = n => '$' + Math.abs(n).toLocaleString();
  const REQ_LABELS = {
    tiles:        'Zone tiles',
    power_access: 'Power access',
    power:        'Spare power',
    water:        'Water coverage',
    happiness:    'Happiness',
    labor:        'Available workers',
    road:         'Road access'
  };
  const reqLabel = k => REQ_LABELS[k] || (k.charAt(0).toUpperCase() + k.slice(1));

  panel.innerHTML = contracts.map(c => {
    // PLACEMENT scenarios show a special "placing zone" card
    if (c.status === 'PLACEMENT') {
      return `<div class="contract-card contract-placement">
        <div class="contract-head">
          <span class="contract-name">${c.type.replace(/_/g, ' ')}</span>
          <span class="contract-stage-badge">S${c.stage}/${c.totalStages}</span>
        </div>
        <div class="contract-stage-name">${c.stageName}</div>
        <div class="contract-reqs"><span class="req-unmet">📍 Placing zone: ${c.tilesSelected}/${c.tilesRequired} tiles</span></div>
      </div>`;
    }

    const pct = Math.max(4, Math.min(100, (c.deadlineIn / c.maxDeadline) * 100));
    const barColor = c.deadlineIn <= 12 ? 'var(--warn)'
                   : c.deadlineIn <= 36 ? 'var(--gold)'
                   : 'var(--ink-mid)';
    // v is now { met, current, required } — show "Power: 3/8" style
    const reqs = Object.entries(c.requirementDetails)
      .map(([k, v]) =>
        `<span class="${v.met ? 'req-met' : 'req-unmet'}" title="${reqLabel(k)}">` +
        `${v.met ? '✓' : '✗'} ${reqLabel(k)}: ${v.current}/${v.required}</span>`
      ).join('');
    const statusLabel = c.requirementsMet
      ? `<span style="color:var(--gold)">READY</span>`
      : `<span style="color:var(--ink-dim)">IN PROGRESS</span>`;
    const earnedNote = c.earnedRevenue > 0
      ? `<div class="contract-earned">+${fmt(c.earnedRevenue)}/mo earned</div>` : '';

    return `<div class="contract-card">
      <div class="contract-head">
        <span class="contract-name">${c.type.replace(/_/g, ' ')}</span>
        <span class="contract-stage-badge">S${c.stage}/${c.totalStages}</span>
      </div>
      <div class="contract-stage-name">${c.stageName}</div>
      <div class="contract-bar">
        <div class="contract-bar-fill" style="width:${pct}%;background:${barColor}"></div>
      </div>
      <div class="contract-deadline">
        <span>${c.deadlineIn} months</span>
        ${statusLabel}
      </div>
      <div class="contract-reqs">${reqs}</div>
      <div class="contract-revenue">+${fmt(c.pendingRevenue)}/month pending</div>
      ${earnedNote}
      <button class="contract-decline" data-scenario-id="${c.id}">CANCEL CONTRACT</button>
    </div>`;
  }).join('');

  // Wire decline buttons (rebuilt every sync, so re-wire each time)
  panel.querySelectorAll('.contract-decline').forEach(btn => {
    btn.onclick = () => showDeclineModal(btn.dataset.scenarioId);
  });
}

// ── Contract modal (shared overlay) ──────────────────────────────

let _contractModal = null;

function ensureContractModal() {
  if (_contractModal) return;
  _contractModal = document.createElement('div');
  _contractModal.id = 'contract-modal';
  _contractModal.addEventListener('click', e => {
    if (e.target === _contractModal) closeContractModal();
  });
  document.body.appendChild(_contractModal);
}

function closeContractModal() {
  if (_contractModal) { _contractModal.style.display = 'none'; _contractModal.innerHTML = ''; }
}

function openContractModal(html) {
  ensureContractModal();
  _contractModal.innerHTML = html;
  _contractModal.style.display = 'flex';
}

// ── Decline confirmation modal ────────────────────────────────────

export function showDeclineModal(scenarioId) {
  const scenario = scenarioManager.getScenario(scenarioId);
  if (!scenario) return;
  const p = scenario.currentStage.penalties.ifDeclined;
  const typeName = scenario.type.replace(/_/g, ' ');
  const blacklistYears = p.contractBlacklist
    ? Math.round(p.contractBlacklist / 12) : 0;

  openContractModal(`
    <div class="contract-modal-panel">
      <div class="contract-modal-title">⚠ CANCEL CONTRACT?</div>
      <div class="contract-modal-subtitle">${typeName} — ${scenario.currentStage.name}</div>

      <div class="contract-modal-section">CONSEQUENCES</div>
      <div class="contract-modal-row consequence">Lost Revenue: $${(p.revenue || 0).toLocaleString()}</div>
      <div class="contract-modal-row consequence">Prestige: ${p.prestige || 0}</div>
      <div class="contract-modal-row consequence">Population Loss: −${Math.abs(p.populationLoss || 0).toLocaleString()}</div>
      ${blacklistYears ? `<div class="contract-modal-row consequence">No ${typeName} contracts for ${blacklistYears} years</div>` : ''}

      <div class="contract-modal-warning">This is permanent and cannot be undone.</div>

      <div class="contract-modal-footer">
        <button class="btn-confirm-action" id="cm-cancel">KEEP CONTRACT</button>
        <button class="btn-danger" id="cm-confirm">CANCEL CONTRACT — I'M SURE</button>
      </div>
    </div>
  `);

  _contractModal.querySelector('#cm-cancel').onclick  = closeContractModal;
  _contractModal.querySelector('#cm-confirm').onclick = () => {
    scenarioManager.declineScenario(scenarioId);
    closeContractModal();
  };
}

// ── Renegotiation offer modal ─────────────────────────────────────

export function showRenegotiationModal(scenarioId) {
  const scenario = scenarioManager.getScenario(scenarioId);
  if (!scenario || !scenario.renegotiationOffer) return;
  const offer    = scenario.renegotiationOffer;
  const stage    = scenario.currentStage;
  const typeName = scenario.type.replace(/_/g, ' ');

  openContractModal(`
    <div class="contract-modal-panel">
      <div class="contract-modal-title">📋 RENEGOTIATION OFFER</div>
      <div class="contract-modal-subtitle">${typeName} — Stage ${scenario.currentStageIndex + 1} Failed</div>

      ${offer.message ? `<div class="contract-modal-quote">"${offer.message}"</div>` : ''}

      <div class="contract-modal-section">OLD TERMS</div>
      <div class="contract-modal-row term-old">Revenue: $${stage.rewards.revenue.toLocaleString()}/month</div>

      <div class="contract-modal-section">NEW TERMS</div>
      <div class="contract-modal-row term-new">Revenue: $${offer.newRevenue.toLocaleString()}/month</div>
      <div class="contract-modal-row term-new">Extra time: +${offer.newDeadline} months</div>

      <div class="contract-modal-footer">
        <button class="btn-confirm-action" id="cm-accept">Accept</button>
        <button class="btn-danger" id="cm-reject">Decline</button>
      </div>
    </div>
  `);

  _contractModal.querySelector('#cm-accept').onclick = () => {
    scenarioManager.acceptRenegotiation(scenarioId);
    closeContractModal();
  };
  _contractModal.querySelector('#cm-reject').onclick = () => {
    scenarioManager.rejectRenegotiation(scenarioId);
    closeContractModal();
  };
}

// ── Contract offer modal ──────────────────────────────────────────

function formatReqForOffer(key, req) {
  switch (key) {
    case 'tiles':        return `Place a <b>${req.size || req.count}×${req.size || req.count}</b> zone on the map`;
    case 'power_access': return `Run power to the zone edge (road or powerline adjacent)`;
    case 'power':        return `<b>${req.amount} MW</b> spare city power capacity`;
    case 'water':        return `Water coverage of the zone`;
    case 'happiness':    return `City happiness ≥ <b>${req.minValue}</b>`;
    case 'labor':        return `<b>${req.skilled}</b> skilled workers available`;
    case 'road':         return `Road access — <b>${req.quality || 'nearby'}</b>`;
    default:             return `${key}: ${JSON.stringify(req)}`;
  }
}

export function showContractOfferModal(scenarioId) {
  const scenario = scenarioManager.getScenario(scenarioId);
  if (!scenario || scenario.status !== 'OFFERED') return;
  const stage    = scenario.currentStage;
  const typeName = scenario.type.replace(/_/g, ' ');
  const years    = Math.round(stage.monthsUntilDeadline / 12);
  const p        = stage.penalties.ifDeclined;
  const blacklistYears = p.contractBlacklist ? Math.round(p.contractBlacklist / 12) : 0;

  const reqRows = Object.entries(stage.requirements)
    .map(([k, req]) => `<div class="contract-modal-row offer-req">• ${formatReqForOffer(k, req)}</div>`)
    .join('');

  openContractModal(`
    <div class="contract-modal-panel">
      <div class="contract-modal-title">Contract offer</div>
      <div class="contract-modal-subtitle">${typeName}</div>
      <div class="contract-modal-meta">Stage ${scenario.currentStageIndex + 1} of ${scenario.stages.length} — ${stage.name}</div>
      <div class="contract-modal-meta">Deadline: ${stage.monthsUntilDeadline} months (${years} years)</div>

      <div class="contract-modal-section">Requirements</div>
      ${reqRows}

      <div class="contract-modal-section">Rewards on completion</div>
      <div class="contract-modal-row offer-reward">+$${stage.rewards.revenue.toLocaleString()}/month revenue</div>
      <div class="contract-modal-row offer-reward">+${stage.rewards.jobs} jobs · +${stage.rewards.prestige} prestige</div>

      <div class="contract-modal-section">Effects if declined</div>
      <div class="contract-modal-row consequence">Fine: $${(p.revenue || 0).toLocaleString()}</div>
      <div class="contract-modal-row consequence">Prestige: ${p.prestige || 0} · Pop: −${Math.abs(p.populationLoss || 0).toLocaleString()}</div>
      ${blacklistYears ? `<div class="contract-modal-row consequence">No ${typeName} contracts for ${blacklistYears} years</div>` : ''}

      <div class="contract-modal-footer">
        <button class="btn-danger" id="cm-decline-offer">Decline</button>
        <button class="btn-confirm-action" id="cm-accept-offer">Accept</button>
      </div>
    </div>
  `);

  _contractModal.querySelector('#cm-decline-offer').onclick = () => {
    scenarioManager.declineOffer(scenarioId);
    closeContractModal();
    if (_pausedForContract && state.paused) { togglePause(); _pausedForContract = false; }
  };
  _contractModal.querySelector('#cm-accept-offer').onclick = () => {
    scenarioManager.acceptOffer(scenarioId);
    closeContractModal();
    // Game stays paused — player now selects tiles via placement banner
  };
}

// ── Placement banner ──────────────────────────────────────────────

let _placementBanner    = null;
let _placementLastSid   = null;   // only rebuild DOM when a new placement starts

function ensurePlacementBanner() {
  if (_placementBanner) return;
  _placementBanner = document.createElement('div');
  _placementBanner.id = 'placement-banner';
  document.body.appendChild(_placementBanner);
}

function syncPlacementBanner() {
  const pm = state.placementMode;
  ensurePlacementBanner();

  if (!pm) {
    _placementBanner.classList.remove('active');
    _placementLastSid = null;
    return;
  }

  _placementBanner.classList.add('active');

  // Only rebuild innerHTML when a new placement session starts — prevents the
  // Cancel button being replaced every frame (which swallows click events).
  if (pm.scenarioId === _placementLastSid) return;
  _placementLastSid = pm.scenarioId;

  const size     = pm.size || 3;
  const scenario = scenarioManager.getScenario(pm.scenarioId);
  const typeName = scenario ? scenario.type.replace(/_/g, ' ') : '';

  _placementBanner.innerHTML = `
    <div class="pb-title">📍 PLACE ${typeName.toUpperCase()} ZONE</div>
    <div class="pb-count">${size}×${size} zone — click anywhere on the map</div>
    <div class="pb-hint">Move your cursor over the grid · click to stamp the zone</div>
    <div class="pb-actions">
      <button class="btn-danger" id="pb-cancel">Cancel (Decline)</button>
    </div>
  `;

  _placementBanner.querySelector('#pb-cancel').onclick = () => {
    scenarioManager.cancelPlacement(pm.scenarioId);
    if (_pausedForContract && state.paused) { togglePause(); _pausedForContract = false; }
  };
}

// ── Inspector integration ─────────────────────────────────────────

function buildContractInspectorHTML(scenario) {
  const { met, details } = scenarioManager.activeScenarios.length
    ? (() => {
        // inline require check without importing requirements module in ui
        return { met: scenario.stageStatus === 'REQUIREMENTS_MET', details: {} };
      })()
    : { met: false, details: {} };

  const typeName  = scenario.type.replace(/_/g, ' ');
  const stage     = scenario.currentStage;
  const deadline  = Math.ceil(scenario.monthsRemaining);
  const pct       = Math.max(0, Math.min(100, (deadline / stage.monthsUntilDeadline) * 100));
  const barColor  = deadline <= 12 ? 'var(--warn)' : deadline <= 36 ? 'var(--gold)' : 'var(--ink-mid)';
  const status    = scenario.stageStatus === 'REQUIREMENTS_MET'
    ? '<span style="color:var(--gold)">READY ✓</span>'
    : '<span style="color:var(--ink-dim)">IN PROGRESS</span>';

  // Get live requirement details from the status cache
  const contractStatus = scenarioManager.getContractStatus().find(c => c.id === scenario.id);
  const reqRows = contractStatus
    ? Object.entries(contractStatus.requirementDetails).map(([k, v]) =>
        `<span class="${v.met ? 'pwr-ok' : 'pwr-no'}">${v.met ? '✓' : '✗'}</span>` +
        ` <span class="k">${k}</span> <span class="v">${v.current}/${v.required}</span>`
      ).join('<br>')
    : '';

  return `
    <div class="ttl">${typeName}</div>
    <div id="insp-body">
      <span class="k">Stage:</span> <span class="v">${scenario.currentStageIndex + 1}/${scenario.stages.length} — ${stage.name}</span><br>
      <span class="k">Deadline:</span> <span class="v">${deadline} months</span><br>
      <div style="height:3px;background:var(--panel2);border:var(--border);margin:4px 0;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${barColor}"></div>
      </div>
      <span class="k">Status:</span> ${status}<br>
      ${reqRows ? `<br><span class="k">Requirements:</span><br>${reqRows}<br>` : ''}
      <br>
      <span class="k">Pending:</span> <span class="v">+$${stage.rewards.revenue.toLocaleString()}/month</span><br>
      <span class="k">Tile locked</span> <span class="v">— cannot bulldoze</span>
    </div>`;
}

/* --- reset UI state that accumulates across a game session --- */
export function resetGameUI() {
  // Sync scenario manager's in-memory arrays with (now reset/loaded) state.scenarios
  // Without this, scenarioManager.activeScenarios still holds the previous game's contracts.
  scenarioManager.loadFromState();

  // Clear notification log (persistent warnings rebuild automatically each frame)
  const log = $('notif-log');
  if (log) log.innerHTML = '';

  // Clear contracts panel and reset fingerprint so it rebuilds immediately
  const panel = $('contracts-panel');
  if (panel) panel.innerHTML = '';
  _contractsPanelFP = '';

  // Reset placement banner
  if (_placementBanner) { _placementBanner.classList.remove('active'); }
  _placementLastSid = null;

  // Reset contract-offer pause tracking
  _pausedForContract = false;

  // Close any open contract modal
  closeContractModal();
}

/* --- init + the single per-frame entry point main calls --- */
export function initUI() {
  buildToolbar(); wireControls(); buildMiniStrip(); /* MINIMAP OVERLAYS */
  buildSavesModal();                                 /* SAVE SYSTEM */
  buildExportButton();                               /* SVG EXPORT */
  syncMinimapSize();                                 /* MAP SIZE: match default map */
  initAdminPanel();                                  /* ADMIN PANEL */
  initNotifCenter();                                 /* NOTIFICATION CENTRE */
  initStatsPanel();                                  /* STATISTICS */
}

export function syncUI() {
  refreshHUD();
  drawSparklines();      /* STATISTICS */
  refreshStatsPanel();   /* STATISTICS: no-op while the panel is closed */
  syncControls();
  syncTools();
  updateInspector();
  syncPersistentWarnings();
  syncContractsPanel();  /* SCENARIOS */
  syncPlacementBanner(); /* SCENARIOS: tile placement overlay */

  // SCENARIOS: auto-confirm placement triggered by single click in input.js
  if (state.placementMode?.readyToConfirm) {
    const sid = state.placementMode.scenarioId;
    state.placementMode.readyToConfirm = false;
    if (scenarioManager.confirmPlacement(sid)) {
      if (_pausedForContract && state.paused) { togglePause(); _pausedForContract = false; }
    }
  }

  // SCENARIOS: drain pending contract offers → pause + show offer modal (one at a time)
  if (state.pendingOffers.length && !(_contractModal?.style.display === 'flex')) {
    const scenarioId = state.pendingOffers.shift();
    if (!state.paused) { togglePause(); _pausedForContract = true; }
    showContractOfferModal(scenarioId);
  }

  // SCENARIOS: drain pending stage placements (tile requirement on a new stage after completion)
  // placementMode is already set by completeStage(); we just need to pause and notify
  if (state.pendingPlacements?.length && !state.placementMode?.fromPending) {
    state.pendingPlacements.shift();
    if (!state.paused) { togglePause(); _pausedForContract = true; }
    if (state.placementMode) state.placementMode.fromPending = true;
  }

  while (state.notices.length) toast(state.notices.shift());   // drain sim/input notices
  // SCENARIOS: route special flash payloads to modals; pass everything else to the status bar
  if (state.flash) {
    const msg = state.flash;
    state.flash = null;
    if (msg.startsWith('__RENEGOTIATE__:')) {
      showRenegotiationModal(msg.slice(16));
    } else if (!msg.startsWith('__DECLINE_CONSEQUENCES__:')) {
      flashStatus(msg);   // ordinary flash — show in notification centre
    }
    // __DECLINE_CONSEQUENCES__ is swallowed here; consequences were shown in the modal before decline
  }
}
