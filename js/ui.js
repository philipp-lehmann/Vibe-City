/* ================================================================
   ui.js — the ONLY module that reads/writes HUD & panel DOM.
   Dependencies: config.js, state.js, simulation.js, renderer.js
   Holds: toolbar build, status bar / budget / population / demand /
   facing updates, tile inspector, control-button wiring, toast +
   status flash, and per-frame syncUI() that applies state -> DOM.
   ================================================================ */
import { MAP_SIZES, WATER_LEVELS, DEFAULT_WATER, GAME_MODES, DEFAULT_MODE, SCENARIO_DEMAND_CAP_POP,
         T, TOOLS, FACES, SHORT_MONTHS, isZone, LOANS, CITY_EMOJIS, DEFAULT_CITY_EMOJI,
         POWERPLANT_CAPACITY, PUMP_CAPACITY } from './config.js';   // MAP SIZE / WATER AMOUNT / GAME MODE / CREDITS / UTILITIES / CITY IDENTITY
import {
  state, tileAt, setTool, togglePause, rotateView,
  listSaves, saveGame, loadGame, deleteSave, importSave, serializeSave, newGame, takeLoan
} from './state.js'; // SAVE SYSTEM / CREDITS
import { igniteFire } from './simulation.js';
import { scenarioManager, SCENARIOS } from './scenario.js';              // SCENARIOS
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
// CITY IDENTITY: keep the browser tab title in sync with the current city,
// but only touch the DOM when it actually changes
let _lastTitleKey = null;
function syncPageTitle() {
  const key = state.cityEmoji + state.cityName;
  if (key === _lastTitleKey) return;
  _lastTitleKey = key;
  document.title = `${state.cityEmoji} ${state.cityName} — Vibe City`;
}

// CLICK-THROUGH FIX (Tauri/WKWebView): textContent assignment always tears
// down and recreates the child text node, even when the string is unchanged.
// refreshHUD() runs every animation frame, so unconditional assignment here
// was recreating the text node under the user's mouse ~60x/sec — WKWebView
// (the Tauri desktop build's webview) drops the pending click gesture when
// its target node is replaced mid-click, so clicks landing on the rendered
// glyphs (rather than the surrounding element background) silently did
// nothing. Chromium-based browsers tolerate this, which is why it only
// showed up in the packaged app. Guard with a last-value cache (same
// pattern as _lastTitleKey/_lastMode/lastTool below) so the DOM is only
// touched when the displayed value actually changes.
let _lastStatusName = null;
let _lastStatusDate = null;
// s-pop/s-funds/s-happy sit inside a .grp whose *ancestor* owns the click
// listener (opens the Statistics panel — see initStatsPanel()), not the <b>
// itself. Recreating their text node every frame broke that click the same
// way — WKWebView still drops the gesture if the node under the mousedown
// is gone by mouseup, even though the listener lives higher up the tree.
let _lastStatusPop = null;
let _lastStatusFunds = null;
let _lastStatusHappy = null;
export function refreshHUD() {
  const nameStr = `${state.cityEmoji} ${state.cityName}`;
  if (nameStr !== _lastStatusName) { _lastStatusName = nameStr; $('s-name').textContent = nameStr; }
  syncPageTitle();   // CITY IDENTITY
  // DATE FORMAT: fixed-width "Mmm YYYY" (3-char month, 4-digit year, single space)
  const yr = 1900 + Math.floor(state.month / 12);
  const dateStr = `${SHORT_MONTHS[state.month % 12]} ${yr}`;
  if (dateStr !== _lastStatusDate) { _lastStatusDate = dateStr; $('s-date').textContent = dateStr; }
  $('s-face').textContent = FACES[state.rot];

  const popStr = state.pop.toLocaleString();
  if (popStr !== _lastStatusPop) { _lastStatusPop = popStr; $('s-pop').textContent = popStr; }

  const f = $('s-funds');
  const fundsStr = (state.funds < 0 ? '-$' : '$') + Math.abs(state.funds).toLocaleString();
  if (fundsStr !== _lastStatusFunds) { _lastStatusFunds = fundsStr; f.textContent = fundsStr; }
  f.style.color = state.funds < 0 ? 'var(--warn)' : 'var(--ink)';

  // DEMAND SYSTEM: happiness readout, coloured by band
  const hp = $('s-happy');
  if (state.happiness !== _lastStatusHappy) { _lastStatusHappy = state.happiness; hp.textContent = state.happiness; }
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

// CONTRACT FOCUS: terminal contracts (completed/declined/failed) keep their
// tiles locked forever, but there's nothing left to negotiate — show a plain
// summary instead of the live progress view, and no Decline button.
const TERMINAL_STATUS_LABEL = {
  COMPLETED:             '<span style="color:var(--gold)">Completed ✓</span>',
  DECLINED:              '<span style="color:var(--warn)">Declined</span>',
  FAILED_CONTRACT_ENDED: '<span style="color:var(--warn)">Contract Ended</span>',
};
function buildTerminalContractHTML(scenario) {
  const typeName = formatContractName(scenario.type);
  const label = TERMINAL_STATUS_LABEL[scenario.status] || scenario.status;
  const revenueRow = scenario.status === 'COMPLETED'
    ? `<span class="k">Revenue:</span> <span class="v">+$${scenario.currentStage.rewards.revenue.toLocaleString()}/month</span><br>`
    : '';
  return `
    <div class="insp-header">
      <div class="ttl">${typeName}</div>
      <span id="insp-close" class="panel-icon" title="Close">✕</span>
    </div>
    <div id="insp-body">
      <span class="k">Status:</span> ${label}<br>
      ${revenueRow}
      <span class="k">Tile locked</span> <span class="v">— cannot bulldoze</span>
    </div>`;
}

// TILE FOCUS: the panel's close (x) button clears the pin — same behavior
// wherever it appears (static shell, contract view, or terminal summary).
function wireInspClose(panel) {
  const btn = panel.querySelector('#insp-close');
  if (btn) btn.onclick = () => { state.pinnedTile = null; };
}

// CONTRACT FOCUS: renders the contract inspector view. ACTIVE contracts get
// the live progress view + a Decline button; terminal contracts (completed/
// declined/ended) get a short summary instead. Shared by the pinned-selection
// path and the plain-hover path below.
//
// updateInspector() runs every animation frame (~60/sec). Rebuilding
// panel.innerHTML unconditionally every frame destroys and recreates the
// Decline button that often too — so a mousedown/mouseup pair almost always
// straddles a DOM swap, and the click event never fires on either the old
// (now-detached) button or the new one. Only touch the DOM when the rendered
// content actually changed, so the button (and its listener) survives frames
// where nothing new happened.
let _inspContractHTML = null;
function renderContractInspector(panel, scenario) {
  panel.style.display = '';
  const html = scenario.status === 'ACTIVE'
    ? buildContractInspectorHTML(scenario)
    : buildTerminalContractHTML(scenario);
  if (html === _inspContractHTML) return;   // unchanged — leave the existing DOM (and its listeners) alone
  _inspContractHTML = html;
  panel.innerHTML = html;
  wireInspClose(panel);
  const declineBtn = panel.querySelector('.contract-decline');
  if (declineBtn) declineBtn.onclick = () => showDeclineModal(scenario.id);
}

/* --- tile inspector for the hovered (or pinned) tile ---
   TILE FOCUS: state.pinnedTile (set by a click, cleared by clicking the same
   tile again / clicking elsewhere / ESC) overrides state.hover as the source
   of which tile to show, so the panel stays open on a pinned tile of ANY
   type — power plant, zone, contract, etc. — even after the mouse moves away. */
export function updateInspector() {
  const panel = $('inspector');
  panel.classList.toggle('pinned', !!state.pinnedTile);   // TILE FOCUS: brighter border while pinned
  wireInspClose(panel);   // keeps whatever close (x) button is currently in the DOM working
  const { x, y } = state.pinnedTile || state.hover;
  const t = tileAt(x, y);
  if (!t) { panel.style.display = 'none'; return; }
  panel.style.display = '';

  // SCENARIOS: contract tile — show contract info instead of standard tile info.
  // Any status counts (not just ACTIVE) — completed/declined tiles stay locked
  // forever and should still be inspectable, just without the live progress view.
  if (t.contractId) {
    const scenario = scenarioManager.getScenario(t.contractId);
    if (scenario) {
      renderContractInspector(panel, scenario);
      return;
    }
  }

  const body = $('insp-body');
  const names = {
    [T.GRASS]: 'Grassland', [T.WATER]: 'Water', [T.ROAD]: 'Road',
    [T.POWERLINE]: 'Power Line', [T.POWERPLANT]: 'Coal Plant', [T.PUMP]: 'Water Pump',
    [T.PARK]: 'Park', [T.RES]: 'Residential', [T.COM]: 'Commercial', [T.IND]: 'Industrial',
    [T.FOREST]: 'Forest', [T.WILDLIFE]: 'Wildlife Area'
  };
  panel.querySelector('.ttl').textContent = names[t.type] || 'Tile';
  const dens = ['Low', 'Medium', 'High'][t.level] || 'Low';
  let rows = `<span class="k">Coords:</span> <span class="v">${x},${y}</span><br>`;
  rows += `<span class="k">Type:</span> <span class="v">${names[t.type]}</span><br>`;
  if (t.type === T.FOREST) {
    // FOREST: own branch — no power/water/road fields, just tree density
    rows += `<span class="k">Density:</span> <span class="v">${t.forestDensity}/10</span>`;
  } else if (t.type === T.WILDLIFE) {
    // WILDLIFE: own branch, same reasoning as forest — doesn't conduct power
    // or need water/road, so those rows would just be noise. Shows instead
    // whether it's currently counting toward an active Wildlife Reserve
    // contract (see input.js tagWildlifeTile).
    rows += `<span class="k">Reserve:</span> <span class="${t.contractLocked ? 'pwr-ok' : 'v'}">` +
      `${t.contractLocked ? 'counts toward active contract' : 'unassigned'}</span>`;
  } else if (isZone(t.type)) {
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
    // UTILITIES: nominal service capacity — same constants the propagation
    // flood fills use, so this can't drift out of sync with the simulation.
    if (t.type === T.POWERPLANT) rows += `<span class="k">Capacity:</span> <span class="v">${POWERPLANT_CAPACITY} MW</span><br>`;
    if (t.type === T.PUMP) rows += `<span class="k">Delivery:</span> <span class="v">${PUMP_CAPACITY} units</span><br>`;
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
  // SCENARIO MODE: demand penalty above the population cap with no active
  // contract offsetting it — clears automatically once any contract goes ACTIVE.
  if (state.mode === 'scenario' && state.pop > SCENARIO_DEMAND_CAP_POP
      && scenarioManager.getActiveDemandBoost() === 0)
    active.push('📉 Demand stalling above 15k pop — activate a contract to keep growing.');
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
  $('s-date').onclick = () => togglePause();   // statusbar date doubles as a play/pause toggle
  $('s-name').onclick = showRenameCityModal;   // CITY IDENTITY: statusbar name opens the rename dialog
  $('btn-speed').onclick = () => { state.speedIdx = (state.speedIdx + 1) % state.speeds.length; };
  $('btn-zoom').onclick = () => cycleZoom();   // ZOOM LEVELS: fit -> 1x -> 2x
  $('btn-rot-l').onclick = () => rotateView(-1);
  $('btn-rot-r').onclick = () => rotateView(1);
  $('btn-fire').onclick = () => igniteFire();
  $('tax-slider').addEventListener('input', e => { state.taxPct = parseInt(e.target.value); });
  $('btn-saves').onclick = openSaves;
  $('btn-newgame').onclick = doNewGame;
  $('btn-contracts').onclick = openContractsDialog;   // SCENARIOS: Admin accordion button, Scenario Mode only
  $('btn-loans').onclick = openCreditsDialog;         // CREDITS: Admin accordion button, any mode
}

// GAME MODE: force the Admin accordion section open (used once when a Scenario
// Mode session starts — doesn't fight the player if they collapse it after).
function expandAdminSection() {
  const sec = $('ap-admin');
  const body = sec?.querySelector('.ap-body');
  const arrow = sec?.querySelector('.ap-arrow');
  if (body && !body.classList.contains('open')) {
    body.classList.add('open');
    if (arrow) arrow.textContent = '▴';
  }
}

/* --- per-frame DOM sync: control labels, tool highlight, indicators --- */
let _lastMode = null;
// CLICK-THROUGH FIX (Tauri/WKWebView) — see refreshHUD()'s _lastStatusName
// comment. btn-pause/btn-zoom labels are plain textContent driven straight
// by a click handler on the same element, so recreating their text node
// every frame ate clicks that landed on the glyphs in the packaged app.
// btn-speed is unaffected: its spans are pointer-events:none, so hit-testing
// always resolves to the button itself, not a child being replaced.
let _lastPaused = null;
let _lastZoomLabel = null;
function syncControls() {
  const pb = $('btn-pause');
  if (state.paused !== _lastPaused) {
    _lastPaused = state.paused;
    pb.textContent = state.paused ? '▶ Paused' : '⏸ Running';
    pb.style.color = state.paused ? 'var(--warn)' : 'var(--gold)';
  }
  $('btn-speed').innerHTML = [0,1,2].map(i =>
    `<span style="opacity:${i <= state.speedIdx ? 1 : 0.25};pointer-events:none">▶</span>`).join('');
  const zl = zoomLabel();
  if (zl !== _lastZoomLabel) { _lastZoomLabel = zl; $('btn-zoom').textContent = zl; }
  // GAME MODE: Contracts button (in the Admin accordion) only exists in Scenario Mode
  if (state.mode !== _lastMode) {
    _lastMode = state.mode;
    $('btn-contracts').style.display = state.mode === 'scenario' ? '' : 'none';
    if (state.mode === 'scenario') expandAdminSection();  // expanded by default in Scenario Mode
    else closeContractsDialog();
  }
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
// PAUSE ON DIALOG: New Game only ever opens on top of an already-open Saves
// dialog (see doNewGame), so pausing/resuming here covers both.
let _pausedForSavesModal = false;
function buildSavesModal() {
  modal = document.createElement('div');
  modal.id = 'saves-modal';
  modal.addEventListener('click', e => { if (e.target === modal) closeSaves(); });
  const panel = document.createElement('div');
  panel.className = 'modal-panel saves-modal-panel';
  panel.innerHTML = `<div class="saves-modal-head">
      <h2 class="modal-title">Vibe City</h2>
      <button id="saves-new" class="border" style="margin-left:auto;">New City</button>
      <button id="saves-close">✕ Close</button>
    </div>
    <div id="saves-import-banner" class="import-banner" style="display:none;"></div>
    <div id="saves-grid"></div>
    <div id="saves-auto"></div>
    <div class="saves-io-row">
      <button id="saves-export" class="border">Export City</button>
      <button id="saves-import" class="border">Import City</button>
    </div>
    <input type="file" id="saves-import-file" accept="application/json,.json" style="display:none;">`;
  modal.appendChild(panel);
  document.body.appendChild(modal);
  $('saves-close').onclick = closeSaves;
  $('saves-new').onclick = doNewGame;
  $('saves-export').onclick = downloadLiveSave;
  $('saves-import').onclick = () => $('saves-import-file').click();
  $('saves-import-file').onchange = handleImportFile;
}
function openSaves() {
  if (!modal) buildSavesModal();
  renderSlots();
  modal.style.display = 'flex';
  // PAUSE ON DIALOG: don't clobber a pause the player already set themselves
  if (!state.paused) { togglePause(); _pausedForSavesModal = true; }
}
// STARTUP: during the launch screen the modal stays open until a city is chosen
function closeSaves() {
  if (startupMode && !gameStarted) return;
  if (modal) modal.style.display = 'none';
  if (_pausedForSavesModal && state.paused) { togglePause(); _pausedForSavesModal = false; }
}

// name/stats/thumbnail is one clickable target that loads the slot (bordered on
// hover — see .slot-load in ui.css); Save/Delete remain explicit buttons below.
function doLoadSlot(slot, entry) {
  if (loadGame(slot)) {
    syncMinimapSize(); resetStatsHistoryGuards(); resetGameUI(); startGame(); closeSaves();   // MAP SIZE + STARTUP
    flashStatus('Loaded ' + (entry.cityName || ''));
  }
}

// EXPORT/IMPORT: trigger a browser download of a save blob as a .json file
function triggerSaveDownload(blob, cityName, month) {
  const namePart = (cityName || 'city').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'city';
  const datePart = fmtDate(month || 0).replace(/\s+/g, '');
  const url = URL.createObjectURL(new window.Blob([JSON.stringify(blob)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${namePart}_${datePart}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// EXPORT/IMPORT: export the live/current city (not a stored slot) — this is
// the single Export action in the row below the autosave section.
function downloadLiveSave() {
  if (!gameStarted) return;
  triggerSaveDownload(serializeSave(liveThumb()), state.cityName, state.month);
}

// EXPORT/IMPORT: a parsed blob awaiting a destination slot, or null when idle
let pendingImport = null;

function handleImportFile(e) {
  const file = e.target.files[0];
  e.target.value = '';   // allow re-selecting the same file later
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let blob;
    try { blob = JSON.parse(reader.result); } catch { flashStatus('Import failed — not valid JSON'); return; }
    if (!blob || !Array.isArray(blob.grid)) { flashStatus('Import failed — not a Vibe City save file'); return; }
    pendingImport = blob;
    renderSlots();
  };
  reader.onerror = () => flashStatus('Import failed — could not read file');
  reader.readAsText(file);
}

function cancelImport() { pendingImport = null; renderSlots(); }

function finishImport(slot) {
  const blob = pendingImport;
  pendingImport = null;
  if (importSave(slot, blob)) {
    renderSlots();
    flashStatus('Imported ' + (blob.meta?.cityName || blob.state?.cityName || 'city'));
  } else {
    flashStatus('Import failed — malformed save file');
  }
}

function confirmOverwriteImport(slot, entry) {
  openContractModal(`
    <div class="contract-modal-panel">
      <div class="contract-modal-title">⚠ Overwrite Save?</div>
      <div class="contract-modal-subtitle">${escapeHtml(entry.cityName || slot)}</div>
      <div class="contract-modal-warning">Importing here replaces this save and cannot be undone.</div>
      <div class="contract-modal-footer">
        <button class="btn-confirm-action" id="cm-cancel">Keep Save</button>
        <button class="btn-danger" id="cm-confirm">Overwrite</button>
      </div>
    </div>
  `);
  _contractModal.querySelector('#cm-cancel').onclick  = closeContractModal;
  _contractModal.querySelector('#cm-confirm').onclick = () => { closeContractModal(); finishImport(slot); };
}

// CITY IDENTITY: statusbar city name -> rename + emoji picker
function showRenameCityModal() {
  let pickedRenameEmoji = state.cityEmoji;
  openContractModal(`
    <div class="contract-modal-panel">
      <div class="contract-modal-title">Rename City</div>

      <div class="modal-field">
        <label>City Name</label>
        <input id="rename-input" class="modal-input row" type="text" maxlength="48" value="${escapeHtml(state.cityName)}">
      </div>
      <div class="modal-field">
        <div id="rename-emoji-row"></div>
      </div>
      <div class="contract-modal-footer">
        <button class="btn-confirm-action" id="cm-cancel">Cancel</button>
        <button class="btn-confirm-action" id="cm-confirm">Save</button>
      </div>
    </div>
  `);
  const emojiRow = _contractModal.querySelector('#rename-emoji-row');
  const highlightRenameEmoji = () => {
    emojiRow.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.emoji === pickedRenameEmoji);
    });
  };
  CITY_EMOJIS.forEach(e => {
    const b = document.createElement('button');
    b.dataset.emoji = e; b.className = 'size-card emoji-card';
    b.textContent = e;
    b.onclick = () => { pickedRenameEmoji = e; highlightRenameEmoji(); };
    emojiRow.appendChild(b);
  });
  highlightRenameEmoji();

  const input = _contractModal.querySelector('#rename-input');
  _contractModal.querySelector('#cm-cancel').onclick  = closeContractModal;
  _contractModal.querySelector('#cm-confirm').onclick = () => {
    const name = (input.value || '').trim();
    if (name) state.cityName = name;
    state.cityEmoji = pickedRenameEmoji;
    closeContractModal();
  };
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

function slotThumbHtml(thumb) {
  return thumb ? `<img class="slot-thumb" src="${thumb}">` : `<div class="slot-thumb"></div>`;
}

function slotCard(slot, entry) {
  const card = document.createElement('div');
  card.className = 'save-slot';
  const picking = !!pendingImport;   // EXPORT/IMPORT: a file is loaded, waiting for a destination slot
  if (!entry) {
    const d = document.createElement('div');
    d.className = 'empty-slot';
    const b = document.createElement('button');
    b.className = 'btn-confirm-action';
    if (picking) {
      b.textContent = 'Import Here';
      b.onclick = () => finishImport(slot);
    } else {
      b.textContent = 'Save Here';
      b.disabled = !gameStarted;   // SAVE SYSTEM: nothing live to save until a city is started/loaded
      if (b.disabled) b.title = 'Start or load a city first';
      b.onclick = () => { saveGame(slot, liveThumb()); renderSlots(); };
    }
    card.appendChild(d);
    d.appendChild(b);
    return card;
  }

  const info = document.createElement('div');
  info.className = 'slot-load';
  info.title = picking
    ? `Overwrite ${escapeHtml(entry.cityName || 'City')} with the imported save`
    : `Load this ${escapeHtml(entry.cityName || 'City')}`;
  info.innerHTML = `<span class="slot-name">${entry.cityEmoji || DEFAULT_CITY_EMOJI}<br>${escapeHtml(entry.cityName || 'City')}</span>
    <span class="slot-meta">${fmtDate(entry.month || 0)}<br>Pop. ${(entry.pop || 0).toLocaleString()}</span>
    ${slotThumbHtml(entry.thumb)}`;
  info.onclick = picking ? () => confirmOverwriteImport(slot, entry) : () => doLoadSlot(slot, entry);
  card.appendChild(info);

  const row = document.createElement('div'); row.className = 'slot-actions';
  const bSave = document.createElement('button'); bSave.className = 'btn-confirm-action'; bSave.textContent = 'Save';
  bSave.disabled = !gameStarted || picking;   // SAVE SYSTEM: nothing live to save until a city is started/loaded
  if (!gameStarted && !picking) bSave.title = 'Start or load a city first';
  bSave.onclick = () => { saveGame(slot, liveThumb()); renderSlots(); };
  const bDel = document.createElement('button'); bDel.className = 'btn-danger'; bDel.textContent = 'Delete';
  bDel.disabled = picking;
  // NOTE: native window.confirm() is unreliable inside the Tauri webview (silently
  // returns false with no dialog on some platforms), so use our own modal instead.
  bDel.onclick = () => showDeleteSaveModal(slot, entry.cityName);
  row.appendChild(bSave); row.appendChild(bDel);
  card.appendChild(row);
  return card;
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function renderSlots() {
  const idx = listSaves();
  const bySlot = {}; idx.forEach(e => bySlot[e.slot] = e);
  // EXPORT/IMPORT: banner + Cancel while a loaded file is waiting for a slot
  const banner = $('saves-import-banner');
  if (pendingImport) {
    const name = pendingImport.meta?.cityName || pendingImport.state?.cityName || 'city';
    banner.style.display = 'flex';
    banner.innerHTML = `<span>Importing <b>${escapeHtml(name)}</b> — click a slot below to place it</span>
      <button id="import-cancel" class="btn-danger">Cancel</button>`;
    $('import-cancel').onclick = cancelImport;
  } else {
    banner.style.display = 'none';
    banner.innerHTML = '';
  }
  const grid = $('saves-grid'); grid.innerHTML = '';
  SAVE_SLOTS.forEach(s => grid.appendChild(slotCard(s, bySlot[s])));
  // reserved autosave row (click name/stats/thumbnail to load — no manual save/delete)
  const a = bySlot['autosave']; const box = $('saves-auto'); box.innerHTML = '';
  if (a) {
    const row = document.createElement('div');
    row.className = 'autosave-row';
    const info = document.createElement('div');
    info.className = 'slot-load';
    info.title = 'Load autosave';
    info.innerHTML = `${slotThumbHtml(a.thumb)}
      <span class="slot-meta"><span class="slot-name">Autosave ${a.cityEmoji || DEFAULT_CITY_EMOJI} ${escapeHtml(a.cityName || '')} </span><br> ${fmtDate(a.month || 0)} · Pop. ${(a.pop || 0).toLocaleString()}</span>`;
    info.onclick = () => doLoadSlot('autosave', a);
    row.appendChild(info);
    box.appendChild(row);
  }
  // EXPORT/IMPORT: Export reflects the live/current game, not a stored slot
  const exportBtn = $('saves-export');
  if (exportBtn) {
    exportBtn.disabled = !gameStarted;
    exportBtn.title = gameStarted ? '' : 'Start or load a city first';
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
let sizeModal = null, pickedSize = 'medium', pickedWater = DEFAULT_WATER, pickedMode = DEFAULT_MODE,
    pickedEmoji = DEFAULT_CITY_EMOJI;   // WATER AMOUNT / GAME MODE / CITY IDENTITY
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
      <label>Emoji</label>
      <div id="emoji-row"></div>
    </div>
    <div class="modal-field">
      <label>Mode</label>
      <div id="mode-row"></div>
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
      <button id="size-cancel">Cancel</button>
    </div>`;
  sizeModal.appendChild(panel);
  document.body.appendChild(sizeModal);
  // CITY IDENTITY: emoji cards, same styling as size/water/mode pickers
  const emojiRow = $('emoji-row');
  CITY_EMOJIS.forEach(e => {
    const card = document.createElement('button');
    card.dataset.emoji = e;
    card.className = 'size-card emoji-card';
    card.textContent = e;
    card.onclick = () => { pickedEmoji = e; highlightEmoji(); };
    emojiRow.appendChild(card);
  });
  // GAME MODE: two cards, same styling as size/water pickers
  const modeRow = $('mode-row');
  Object.entries(GAME_MODES).forEach(([key, m]) => {
    const card = document.createElement('button');
    card.dataset.mode = key;
    card.className = 'size-card';
    card.innerHTML = `<b>${m.label}</b>`;
    card.onclick = () => { pickedMode = key; highlightMode(); };
    modeRow.appendChild(card);
  });
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
    newGame(name, pickedSize, WATER_LEVELS[pickedWater].pct, pickedMode, pickedEmoji);  // MAP SIZE / WATER AMOUNT / GAME MODE / CITY IDENTITY
    syncMinimapSize();
    resetStatsHistoryGuards();
    resetGameUI();
    startGame();                                       // STARTUP
    closeSaves();
    flashStatus(`New ${MAP_SIZES[pickedSize].label} City: ${state.cityEmoji} ${state.cityName}`);
  };
}
function highlightSize() {
  sizeModal.querySelectorAll('[data-size]').forEach(c => {
    const on = c.dataset.size === pickedSize;
    c.classList = on ? 'size-card active' : 'size-card';
  });
}
function highlightWater() {
  sizeModal.querySelectorAll('[data-water]').forEach(c => {
    const on = c.dataset.water === pickedWater;
    c.classList = on ? 'size-card active' : 'size-card';

  });
}
function highlightMode() {
  sizeModal.querySelectorAll('[data-mode]').forEach(c => {
    const on = c.dataset.mode === pickedMode;
    c.classList = on ? 'size-card active' : 'size-card';
  });
}
function highlightEmoji() {
  sizeModal.querySelectorAll('[data-emoji]').forEach(c => {
    const on = c.dataset.emoji === pickedEmoji;
    c.classList = on ? 'size-card emoji-card active' : 'size-card emoji-card';
  });
}
function doNewGame() {
  if (!sizeModal) buildSizeModal();
  pickedSize = Object.values(MAP_SIZES).find(p => p.w === state.gridWidth) ?
    Object.keys(MAP_SIZES).find(k => MAP_SIZES[k].w === state.gridWidth) : 'medium';
  pickedMode = DEFAULT_MODE;   // GAME MODE: never leak a previous new-game flow's selection
  pickedEmoji = CITY_EMOJIS[Math.random() * CITY_EMOJIS.length | 0];   // CITY IDENTITY: a little variety by default
  highlightSize();
  highlightWater();
  highlightMode();
  highlightEmoji();
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

// Blueprint types are SCREAMING_SNAKE_CASE (e.g. AI_DATA_CENTRE) — Title Case
// them for display instead of the raw uppercase-with-underscores form. Short
// (<=2 char) words are treated as acronyms and left as-is (e.g. "AI").
function formatContractName(type) {
  return type.split('_')
    .map(w => w.length <= 2 ? w : w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

// ── Contracts dialog (status-bar "Contracts" button, Scenario Mode only) ──
// Purely a picker/launcher: lists every SCENARIOS entry with its current
// state and an Activate/Deactivate action. Doesn't replace the contracts
// panel above, which keeps showing live progress for anything ACTIVE/PLACEMENT.

let _contractsDialog = null;

function ensureContractsDialog() {
  if (_contractsDialog) return;
  _contractsDialog = document.createElement('div');
  _contractsDialog.id = 'contracts-dialog';
  _contractsDialog.addEventListener('click', e => {
    if (e.target === _contractsDialog) closeContractsDialog();
  });
  document.body.appendChild(_contractsDialog);
}

function isContractsDialogOpen() {
  return _contractsDialog?.style.display === 'flex';
}

function closeContractsDialog() {
  if (_contractsDialog) _contractsDialog.style.display = 'none';
}

// fingerprint so the open dialog only rebuilds (and re-wires buttons) when
// something it's showing actually changes, same rationale as the contracts panel
function contractsDialogFingerprint() {
  const status = scenarioManager.getContractStatus();
  return Object.keys(SCENARIOS).map(type => {
    const live = status.find(c => c.type === type);
    const bl = state.scenarios.contractBlacklist[type];
    return `${type}:${live ? live.status + ':' + live.stage : 'none'}:${bl ? bl.until : ''}`;
  }).join('|');
}

function renderContractsDialogRows() {
  const status = scenarioManager.getContractStatus();
  return Object.values(SCENARIOS).map(bp => {
    const type = bp.type;
    const name = formatContractName(type);
    const live = status.find(c => c.type === type);
    const bl = state.scenarios.contractBlacklist[type];
    const blacklisted = bl && bl.until > state.month;

    let stateLabel, actionHtml;
    if (live) {
      stateLabel = live.status === 'PLACEMENT'
        ? `<span style="color:var(--gold)">Placing zone</span>`
        : `<span style="color:var(--gold)">Active — Stage ${live.stage}/${live.totalStages}</span>`;
      actionHtml = `<button class="btn-danger contracts-dialog-deactivate" data-id="${live.id}">Deactivate</button>`;
    } else if (blacklisted) {
      const remaining = Math.max(1, Math.round((bl.until - state.month) / 12));
      stateLabel = `<span style="color:var(--ink-dim)">Blacklisted — ${remaining} year${remaining === 1 ? '' : 's'} left</span>`;
      actionHtml = `<button disabled>Activate</button>`;
    } else {
      stateLabel = `<span style="color:var(--ink-mid)">Available</span>`;
      actionHtml = `<button class="btn-confirm-action contracts-dialog-activate" data-type="${type}">Activate</button>`;
    }

    return `<div class="contracts-dialog-row">
      <div class="contracts-dialog-row-head">
        <span class="contract-name">${name}</span>
        ${stateLabel}
      </div>
      ${actionHtml}
    </div>`;
  }).join('');
}

function wireContractsDialog() {
  _contractsDialog.querySelectorAll('.contracts-dialog-activate').forEach(btn => {
    btn.onclick = () => {
      const scenario = scenarioManager.activateContract(btn.dataset.type);
      if (!scenario) return;
      closeContractsDialog();
      // The player already chose to activate this contract from the dialog —
      // skip the offer/accept confirmation step and go straight into tile
      // placement instead of showing the offer modal again.
      const idx = state.pendingOffers.indexOf(scenario.id);
      if (idx !== -1) state.pendingOffers.splice(idx, 1);
      scenarioManager.acceptOffer(scenario.id);
      if (!state.paused) { togglePause(); _pausedForContract = true; }
    };
  });
  _contractsDialog.querySelectorAll('.contracts-dialog-deactivate').forEach(btn => {
    btn.onclick = () => { closeContractsDialog(); showDeclineModal(btn.dataset.id); };
  });
  const close = _contractsDialog.querySelector('#contracts-dialog-close');
  if (close) close.onclick = closeContractsDialog;
}

let _contractsDialogFP = '';
function rebuildContractsDialog() {
  ensureContractsDialog();
  _contractsDialog.innerHTML = `
    <div class="contract-modal-panel contracts-dialog-panel">
      <div class="contract-modal-title">Contracts</div>
      <div class="contracts-dialog-list">${renderContractsDialogRows()}</div>
      <div class="contract-modal-footer">
        <button id="contracts-dialog-close">Close</button>
      </div>
    </div>`;
  wireContractsDialog();
  _contractsDialogFP = contractsDialogFingerprint();
}

function openContractsDialog() {
  rebuildContractsDialog();
  _contractsDialog.style.display = 'flex';
  if (!state.paused) togglePause();   // pause while browsing; stays paused after Close
}

// called each frame — only rebuilds while the dialog is actually open, and
// only when something it displays has changed (new Active status, blacklist
// countdown ticking down another month, etc.)
function syncContractsDialog() {
  if (!isContractsDialogOpen()) return;
  const fp = contractsDialogFingerprint();
  if (fp === _contractsDialogFP) return;
  rebuildContractsDialog();
}

/* ===== CREDITS: loan-offers dialog (Admin panel "Credits" button) ====
   Same picker/launcher pattern as the Contracts dialog above: lists every
   LOANS entry with its current state (available / active w/ remaining
   balance) and a Take Loan / Active action. Each entry allows only one
   outstanding loan at a time (state.takeLoan enforces this). ========== */

let _creditsDialog = null;

function ensureCreditsDialog() {
  if (_creditsDialog) return;
  _creditsDialog = document.createElement('div');
  _creditsDialog.id = 'credits-dialog';
  _creditsDialog.addEventListener('click', e => {
    if (e.target === _creditsDialog) closeCreditsDialog();
  });
  document.body.appendChild(_creditsDialog);
}

function isCreditsDialogOpen() { return _creditsDialog?.style.display === 'flex'; }
function closeCreditsDialog() { if (_creditsDialog) _creditsDialog.style.display = 'none'; }

function creditsDialogFingerprint() {
  return state.loans.active.map(l => `${l.type}:${l.monthsRemaining}`).join('|') + '|' + state.funds;
}

function renderCreditsDialogRows() {
  return Object.values(LOANS).map(cfg => {
    const active = state.loans.active.find(l => l.type === cfg.id);
    const totalOwed = Math.round(cfg.principal * (1 + cfg.rate));
    const monthlyPayment = Math.round(totalOwed / cfg.termMonths);

    let stateLabel, actionHtml;
    if (active) {
      stateLabel = `<span style="color:var(--gold)">Active — ${active.monthsRemaining} mo left, $${active.monthlyPayment.toLocaleString()}/mo</span>`;
      actionHtml = `<button disabled>Active</button>`;
    } else {
      stateLabel = `<span style="color:var(--ink-mid)">Available</span>`;
      actionHtml = `<button class="btn-confirm-action credits-dialog-take" data-type="${cfg.id}">Take Loan</button>`;
    }

    return `<div class="contracts-dialog-row">
      <div class="contracts-dialog-row-head">
        <span class="contract-name">${cfg.label}</span>
        ${stateLabel}
      </div>
      <div class="contract-modal-row">$${cfg.principal.toLocaleString()} · ${cfg.termMonths} months · ${Math.round(cfg.rate*100)}% interest · $${monthlyPayment.toLocaleString()}/mo</div>
      ${actionHtml}
    </div>`;
  }).join('');
}

function wireCreditsDialog() {
  _creditsDialog.querySelectorAll('.credits-dialog-take').forEach(btn => {
    btn.onclick = () => {
      if (takeLoan(btn.dataset.type)) {
        flashStatus(`Took out a ${LOANS[btn.dataset.type].label}.`);
        rebuildCreditsDialog();
      }
    };
  });
  const close = _creditsDialog.querySelector('#credits-dialog-close');
  if (close) close.onclick = closeCreditsDialog;
}

let _creditsDialogFP = '';
function rebuildCreditsDialog() {
  ensureCreditsDialog();
  _creditsDialog.innerHTML = `
    <div class="contract-modal-panel contracts-dialog-panel">
      <div class="contract-modal-title">Loans</div>
      <div class="contracts-dialog-list">${renderCreditsDialogRows()}</div>
      <div class="contract-modal-footer">
        <button id="credits-dialog-close">Close</button>
      </div>
    </div>`;
  wireCreditsDialog();
  _creditsDialogFP = creditsDialogFingerprint();
}

function openCreditsDialog() {
  rebuildCreditsDialog();
  _creditsDialog.style.display = 'flex';
  if (!state.paused) togglePause();   // pause while browsing; stays paused after Close
}

function syncCreditsDialog() {
  if (!isCreditsDialogOpen()) return;
  const fp = creditsDialogFingerprint();
  if (fp === _creditsDialogFP) return;
  rebuildCreditsDialog();
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

function showDeleteSaveModal(slot, cityName) {
  openContractModal(`
    <div class="contract-modal-panel">
      <div class="contract-modal-title">⚠ Delete Save?</div>
      <div class="contract-modal-subtitle">${escapeHtml(cityName || slot)}</div>

      <div class="contract-modal-warning">This is permanent and cannot be undone.</div>

      <div class="contract-modal-footer">
        <button class="btn-confirm-action" id="cm-cancel">Keep Save</button>
        <button class="btn-danger" id="cm-confirm">Delete Save</button>
      </div>
    </div>
  `);

  _contractModal.querySelector('#cm-cancel').onclick  = closeContractModal;
  _contractModal.querySelector('#cm-confirm').onclick = () => {
    deleteSave(slot); renderSlots(); closeContractModal();
  };
}

export function showDeclineModal(scenarioId) {
  const scenario = scenarioManager.getScenario(scenarioId);
  if (!scenario) return;
  const p = scenario.currentStage.penalties.ifDeclined;
  const typeName = formatContractName(scenario.type);
  const blacklistYears = p.contractBlacklist
    ? Math.round(p.contractBlacklist / 12) : 0;

  openContractModal(`
    <div class="contract-modal-panel">
      <div class="contract-modal-title">⚠ Cancel Contract?</div>
      <div class="contract-modal-subtitle">${typeName} — ${scenario.currentStage.name}</div>

      <div class="contract-modal-section">Consequences</div>
      <div class="contract-modal-row consequence">Lost Revenue: $${(p.revenue || 0).toLocaleString()}</div>
      <div class="contract-modal-row consequence">Prestige: ${p.prestige || 0}</div>
      <div class="contract-modal-row consequence">Population Loss: −${Math.abs(p.populationLoss || 0).toLocaleString()}</div>
      ${blacklistYears ? `<div class="contract-modal-row consequence">No ${typeName} contracts for ${blacklistYears} years</div>` : ''}

      <div class="contract-modal-warning">This is permanent and cannot be undone.</div>

      <div class="contract-modal-footer">
        <button class="btn-confirm-action" id="cm-cancel">Keep Contract</button>
        <button class="btn-danger" id="cm-confirm">Cancel Contract — I'm Sure</button>
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
  const typeName = formatContractName(scenario.type);

  openContractModal(`
    <div class="contract-modal-panel">
      <div class="contract-modal-title">📋 Renegotiation Offer</div>
      <div class="contract-modal-subtitle">${typeName} — Stage ${scenario.currentStageIndex + 1} Failed</div>

      ${offer.message ? `<div class="contract-modal-quote">"${offer.message}"</div>` : ''}

      <div class="contract-modal-section">Old Terms</div>
      <div class="contract-modal-row term-old">Revenue: $${stage.rewards.revenue.toLocaleString()}/month</div>

      <div class="contract-modal-section">New Terms</div>
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
  const typeName = formatContractName(scenario.type);
  const years    = Math.round(stage.monthsUntilDeadline / 12);
  const p        = stage.penalties.ifDeclined;
  const blacklistYears = p.contractBlacklist ? Math.round(p.contractBlacklist / 12) : 0;

  const reqRows = Object.entries(stage.requirements)
    .map(([k, req]) => `<div class="contract-modal-row offer-req">• ${formatReqForOffer(k, req)}</div>`)
    .join('');

  openContractModal(`
    <div class="contract-modal-panel">
      <div class="contract-modal-title">Contract Offer</div>
      <div class="contract-modal-subtitle">${typeName}</div>
      <div class="contract-modal-meta">Stage ${scenario.currentStageIndex + 1} of ${scenario.stages.length} — ${stage.name}</div>
      <div class="contract-modal-meta">Deadline: ${stage.monthsUntilDeadline} months (${years} years)</div>

      <div class="contract-modal-section">Requirements</div>
      ${reqRows}

      <div class="contract-modal-section">Rewards on Completion</div>
      <div class="contract-modal-row offer-reward">+$${stage.rewards.revenue.toLocaleString()}/month revenue</div>
      <div class="contract-modal-row offer-reward">+${stage.rewards.jobs} jobs · +${stage.rewards.prestige} prestige</div>

      <div class="contract-modal-section">Effects if Declined</div>
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
  const typeName = scenario ? formatContractName(scenario.type) : '';

  _placementBanner.innerHTML = `
    <div class="pb-title">📍 Place ${typeName} Zone</div>
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

  const typeName  = formatContractName(scenario.type);
  const stage     = scenario.currentStage;
  const deadline  = Math.ceil(scenario.monthsRemaining);
  const pct       = Math.max(0, Math.min(100, (deadline / stage.monthsUntilDeadline) * 100));
  const barColor  = deadline <= 12 ? 'var(--warn)' : deadline <= 36 ? 'var(--gold)' : 'var(--ink-mid)';
  const status    = scenario.stageStatus === 'REQUIREMENTS_MET'
    ? '<span style="color:var(--gold)">Ready ✓</span>'
    : '<span style="color:var(--ink-dim)">In Progress</span>';

  // Get live requirement details from the status cache
  const contractStatus = scenarioManager.getContractStatus().find(c => c.id === scenario.id);
  const reqRows = contractStatus
    ? Object.entries(contractStatus.requirementDetails).map(([k, v]) =>
        `<span class="${v.met ? 'pwr-ok' : 'pwr-no'}">${v.met ? '✓' : '✗'}</span>` +
        ` <span class="k">${k}</span> <span class="v">${v.current}/${v.required}</span>`
      ).join('<br>')
    : '';

  return `
    <div class="insp-header">
      <div class="ttl">${typeName}</div>
      <span id="insp-close" class="panel-icon" title="Close">✕</span>
    </div>
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
      <button class="btn-danger contract-decline" style="margin-top:var(--sp-2)">Decline contract</button>
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

  // Reset placement banner
  if (_placementBanner) { _placementBanner.classList.remove('active'); }
  _placementLastSid = null;

  // Reset contract-offer pause tracking
  _pausedForContract = false;
  _pausedForSavesModal = false;

  // Close any open contract modal / contracts dialog
  closeContractModal();
  closeContractsDialog();
  _contractsDialogFP = '';

  // CREDITS: close any open Credits dialog (loans themselves reset via newGame/applySave)
  closeCreditsDialog();
  _creditsDialogFP = '';

  // GAME MODE: force the next syncControls() tick to re-evaluate the Admin
  // accordion's default-open state for this (possibly new) city/mode.
  _lastMode = null;

  // TILE FOCUS: drop any pin from the previous game + force the inspector's
  // contract view to rebuild fresh instead of comparing against stale HTML.
  state.pinnedTile = null;
  _inspContractHTML = null;
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
  syncContractsDialog(); /* SCENARIOS: status-bar Contracts picker, no-op while closed */
  syncCreditsDialog();   /* CREDITS: Admin panel Credits picker, no-op while closed */
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
