/* ================================================================
   requirements.js — Validators for each scenario requirement type.

   Each validator receives (req, contract, state) and returns bool.
   checkAllRequirements() is the single entry point used by
   ScenarioManager.tick() and getContractStatus().
   ================================================================ */
import { T } from '../config.js';

// ── Individual validators ──────────────────────────────────────────

/**
 * tiles — contract zone must be placed and have the right count.
 */
function checkTiles(req, contract, state) {
  if (!contract.tiles || contract.tiles.length === 0) return false;
  const locked = contract.tiles.filter(([x, y]) => {
    const t = state.grid[y]?.[x];
    return t && t.contractId === contract.id;
  });
  return locked.length >= req.count;
}

/**
 * power — all contract tiles must receive power from the grid.
 * req.amount (MW) is informational for now; a global capacity check
 * will be wired once a power-capacity model exists. Until then the
 * meaningful check is that every tile in the footprint is powered,
 * which means the city's grid actually reaches the zone.
 */
function checkPower(req, contract, state) {
  if (!contract.tiles || contract.tiles.length === 0) return false;
  return contract.tiles.every(([x, y]) => {
    const t = state.grid[y]?.[x];
    return t && t.powered;
  });
}

/**
 * water — all contract tiles must have water coverage.
 * Same logic as power: req.amount is informational until a capacity
 * model exists; the meaningful check is full coverage of the footprint.
 */
function checkWater(req, contract, state) {
  if (!contract.tiles || contract.tiles.length === 0) return false;
  return contract.tiles.every(([x, y]) => {
    const t = state.grid[y]?.[x];
    return t && t.water;
  });
}

/**
 * happiness — city-wide happiness must meet a minimum threshold.
 */
function checkHappiness(req, _contract, state) {
  return state.happiness >= req.minValue;
}

/**
 * labor — rough available workforce estimate.
 * Available = total pop minus workers already employed in COM/IND tiles.
 * Stub: no "skilled vs unskilled" split yet — req.skilled is the threshold.
 */
function checkLabor(req, _contract, state) {
  let employed = 0;
  for (let y = 0; y < state.gridHeight; y++) {
    for (let x = 0; x < state.gridWidth; x++) {
      const t = state.grid[y][x];
      if (t.type === T.COM || t.type === T.IND) employed += t.pop || 0;
    }
  }
  const available = Math.max(0, state.pop - employed);
  return available >= (req.skilled || 0);
}

/**
 * road — all contract tiles must have nearRoad access.
 * quality "high" and "highway" are accepted as equivalent for now
 * (further tiers can be wired once a road-quality system exists).
 */
function checkRoad(req, contract, state) {
  if (!contract.tiles || contract.tiles.length === 0) return false;
  return contract.tiles.every(([x, y]) => {
    const t = state.grid[y]?.[x];
    return t && t.nearRoad;
  });
}

// ── Validator dispatch table ───────────────────────────────────────
// Keyed by requirement object key (tiles, power, water, etc.)

const VALIDATORS = {
  tiles:     checkTiles,
  power:     checkPower,
  water:     checkWater,
  happiness: checkHappiness,
  labor:     checkLabor,
  road:      checkRoad
};

// ── Public API ─────────────────────────────────────────────────────

/**
 * Check all requirements for a stage.
 *
 * @param {object} stage    - The current stage object
 * @param {object} contract - The full scenario/contract object
 * @param {object} state    - The live game state
 * @returns {{ met: boolean, details: Object.<string, boolean> }}
 */
export function checkAllRequirements(stage, contract, state) {
  const details = {};
  let allMet = true;

  for (const [key, req] of Object.entries(stage.requirements)) {
    const validator = VALIDATORS[key];
    // Unknown requirement types default to false (fail-safe)
    const result = validator ? validator(req, contract, state) : false;
    details[key] = result;
    if (!result) allMet = false;
  }

  return { met: allMet, details };
}
