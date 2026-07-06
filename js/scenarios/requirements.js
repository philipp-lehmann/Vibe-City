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
 * power_access — the contract zone needs at least ONE tile adjacent to a
 * powered infrastructure tile (road, powerline, etc.).
 * A single cable run past the edge of the zone is enough.
 */
const DIRS4 = [[1,0],[-1,0],[0,1],[0,-1]];

function checkPowerAccess(_req, contract, state) {
  if (!contract.tiles || contract.tiles.length === 0)
    return { met: false, current: 'no zone', required: 'connected' };
  const connected = contract.tiles.some(([x, y]) =>
    DIRS4.some(([dx, dy]) => state.grid[y + dy]?.[x + dx]?.powered)
  );
  return {
    met:      connected,
    current:  connected ? 'connected' : 'not connected',
    required: 'connected'
  };
}

/**
 * power — city must have at least req.amount spare MW of capacity.
 * (1 unit ≈ 1 MW; a single power plant provides 300 MW.)
 */
function checkPower(req, _contract, _state) {
  const spare    = availablePowerCapacity();
  const required = req.amount || 0;
  return {
    met:      spare >= required,
    current:  `${spare} MW`,
    required: `${required} MW`
  };
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
 * road — live adjacency check (does NOT use the cached nearRoad flag, so it
 * works correctly even when the game is paused).
 *
 * Met when at least one zone tile directly borders a ROAD tile — one full
 * side of the block touching a road is more than enough.
 */
function checkRoad(_req, contract, state) {
  if (!contract.tiles || contract.tiles.length === 0)
    return { met: false, current: 'no zone', required: 'road adjacent' };

  const hasDirect = contract.tiles.some(([x, y]) =>
    DIRS4.some(([dx, dy]) => {
      const t = state.grid[y + dy]?.[x + dx];
      return t && t.type === T.ROAD;
    })
  );
  return {
    met:      hasDirect,
    current:  hasDirect ? 'connected' : 'no road adjacent',
    required: 'road adjacent'
  };
}

// ── Validator dispatch table ───────────────────────────────────────

const VALIDATORS = {
  tiles:        checkTiles,
  power_access: checkPowerAccess,
  power:        checkPower,
  water:        checkWater,
  happiness:    checkHappiness,
  labor:        checkLabor,
  road:         checkRoad
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
