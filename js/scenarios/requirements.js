/* ================================================================
   requirements.js — Validators for each scenario requirement type.

   Each validator receives (req, contract, state) and returns
   { met: bool, current: any, required: any } so the UI can show
   progress like "power 3/8" instead of just ✓/✗.

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
  if (!contract.tiles || contract.tiles.length === 0)
    return { met: false, current: 0, required: req.count };
  const locked = contract.tiles.filter(([x, y]) => {
    const t = state.grid[y]?.[x];
    return t && t.contractId === contract.id;
  });
  return { met: locked.length >= req.count, current: locked.length, required: req.count };
}

/**
 * power — two-part check:
 * 1. All contract tiles must receive power.
 * 2. Global spare capacity must be >= req.amount.
 *    Displays spare capacity once all tiles powered, otherwise shows tile count.
 */
function checkPower(req, contract, state) {
  if (!contract.tiles || contract.tiles.length === 0)
    return { met: false, current: 0, required: req.amount || 0 };
  const poweredCount = contract.tiles.filter(([x, y]) => {
    const t = state.grid[y]?.[x];
    return t && t.powered;
  }).length;
  const allPowered = poweredCount === contract.tiles.length;
  const spare = availablePowerCapacity();
  const met = allPowered && spare >= (req.amount || 0);
  const current = allPowered ? spare : poweredCount;
  return { met, current, required: req.amount || 0 };
}

/**
 * water — all contract tiles must have water coverage.
 */
function checkWater(req, contract, state) {
  if (!contract.tiles || contract.tiles.length === 0)
    return { met: false, current: 0, required: '?' };
  const wateredCount = contract.tiles.filter(([x, y]) => {
    const t = state.grid[y]?.[x];
    return t && t.water;
  }).length;
  return {
    met: wateredCount === contract.tiles.length,
    current: wateredCount,
    required: contract.tiles.length
  };
}

/**
 * happiness — city-wide happiness must meet a minimum threshold.
 */
function checkHappiness(req, _contract, state) {
  return {
    met: state.happiness >= req.minValue,
    current: state.happiness,
    required: req.minValue
  };
}

/**
 * labor — rough available workforce estimate.
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
  return {
    met: available >= (req.skilled || 0),
    current: available,
    required: req.skilled || 0
  };
}

/**
 * road — tiered connectivity check.
 * "low": any road within 3 tiles (nearRoad flag).
 * "high"/"highway": nearRoad AND at least one tile directly borders a road tile.
 */
function checkRoad(req, contract, state) {
  if (!contract.tiles || contract.tiles.length === 0)
    return { met: false, current: 'none', required: req.quality || 'low' };

  const allNearRoad = contract.tiles.every(([x, y]) => {
    const t = state.grid[y]?.[x];
    return t && t.nearRoad;
  });
  if (!allNearRoad) return { met: false, current: 'none', required: req.quality || 'low' };

  const quality = req.quality || 'low';
  if (quality === 'low') return { met: true, current: 'nearby', required: quality };

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const hasDirect = contract.tiles.some(([x, y]) =>
    DIRS.some(([dx, dy]) => {
      const t = state.grid[y + dy]?.[x + dx];
      return t && t.type === T.ROAD;
    })
  );
  return {
    met: hasDirect,
    current: hasDirect ? 'direct' : 'nearby',
    required: quality
  };
}

// ── Validator dispatch table ───────────────────────────────────────

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
 * @returns {{ met: boolean, details: Object.<string, {met:boolean,current:any,required:any}> }}
 */
export function checkAllRequirements(stage, contract, state) {
  const details = {};
  let allMet = true;

  for (const [key, req] of Object.entries(stage.requirements)) {
    const validator = VALIDATORS[key];
    const result = validator
      ? validator(req, contract, state)
      : { met: false, current: '?', required: '?' };
    details[key] = result;
    if (!result.met) allMet = false;
  }

  return { met: allMet, details };
}
