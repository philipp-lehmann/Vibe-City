/* ================================================================
   requirements.js — Validators for each scenario requirement type.

   Each validator receives (req, contract, state) and returns bool.
   checkAllRequirements() is the single entry point used by
   ScenarioManager.tick() and getContractStatus().
   ================================================================ */
import { T } from '../config.js';
import { availablePowerCapacity } from '../simulation.js';

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
 * power — two-part check:
 * 1. All contract tiles must receive power (zone is connected to the grid).
 * 2. Global spare capacity must be >= req.amount (grid isn't on the margin).
 *    1 power unit ≈ 1 MW for game purposes; each plant provides 300 units.
 *    This catches the "grid is barely holding together" scenario.
 */
function checkPower(req, contract, state) {
  if (!contract.tiles || contract.tiles.length === 0) return false;
  const allPowered = contract.tiles.every(([x, y]) => {
    const t = state.grid[y]?.[x];
    return t && t.powered;
  });
  if (!allPowered) return false;
  return availablePowerCapacity() >= (req.amount || 0);
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
 * road — tiered connectivity check based on req.quality:
 *
 *   (default / "low") — any road within 3 tiles (nearRoad flag).
 *   "high"            — nearRoad AND at least one contract tile has a
 *                       road tile as a direct orthogonal neighbour.
 *   "highway"         — stub: treated as "high" until a highway tile
 *                       type exists; flagged in details so UI can warn.
 */
function checkRoad(req, contract, state) {
  if (!contract.tiles || contract.tiles.length === 0) return false;

  // All tiles need nearRoad regardless of quality tier
  const allNearRoad = contract.tiles.every(([x, y]) => {
    const t = state.grid[y]?.[x];
    return t && t.nearRoad;
  });
  if (!allNearRoad) return false;

  const quality = req.quality || 'low';
  if (quality === 'low') return true;

  // "high" / "highway": at least one contract tile must directly border a road
  const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
  const hasDirectAccess = contract.tiles.some(([x, y]) =>
    DIRS.some(([dx, dy]) => {
      const t = state.grid[y + dy]?.[x + dx];
      return t && t.type === T.ROAD;
    })
  );
  return hasDirectAccess;
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
