/* ================================================================
   scenario.js — ScenarioManager: multi-stage contract system.

   Contract lifecycle:
     OFFERED      → player must accept or decline (game paused)
     PLACEMENT    → player selects tiles on the map (game paused)
     ACTIVE       → ticking toward deadline
     RENEGOTIATING → stage failed, player must accept/reject offer
     COMPLETED    → all stages done
     FAILED_CONTRACT_ENDED / DECLINED → terminal

   Completely decoupled from the DOM — communicates only via
   pushNotice() and requestFlash(). UI listens for one special
   flash payload:
     "__RENEGOTIATE__:<id>"  → open renegotiation modal

   Dependencies: state.js, scenarios/blueprints.js,
                 scenarios/requirements.js
   ================================================================ */
import { state, tileAt, pushNotice, requestFlash } from './state.js';
import { SCENARIOS } from './scenarios/blueprints.js';
import { checkAllRequirements } from './scenarios/requirements.js';

// ── Stage lifecycle ────────────────────────────────────────────────

function completeStage(scenario) {
  const stage = scenario.currentStage;

  // Grant rewards
  state.revenue.monthly       += stage.rewards.revenue;
  state.scenarios.jobs        += stage.rewards.jobs;
  state.prestige              += stage.rewards.prestige;

  // Record
  scenario.completedStages.push(stage.id);
  scenario.stageStatus = 'COMPLETED';
  scenario.acceptanceHistory.push({
    stage: stage.id, action: 'COMPLETED', month: state.month
  });

  // Advance to next stage or finish contract
  scenario.currentStageIndex += 1;

  if (scenario.currentStageIndex < scenario.stages.length) {
    scenario.currentStage    = scenario.stages[scenario.currentStageIndex];
    scenario.monthsRemaining = scenario.currentStage.monthsUntilDeadline;
    scenario.stageStatus     = 'IN_PROGRESS';

    pushNotice(`✓ ${stage.name} complete!`);
    pushNotice(`Next: ${scenario.currentStage.name} (${Math.ceil(scenario.monthsRemaining)} months)`);

    // New stage requires tile placement — pause and enter placement mode
    if (scenario.currentStage.requirements.tiles) {
      const tileReq = scenario.currentStage.requirements.tiles;
      const required = tileReq.count || 9;
      const size     = tileReq.size  || 3;
      scenario.status = 'PLACEMENT';
      state.placementMode = { scenarioId: scenario.id, required, size, selectedTiles: [] };
      state.pendingPlacements.push(scenario.id);
      pushNotice(`📍 Place a ${size}×${size} zone to begin the next stage.`);
    } else {
      scenario.status = 'ACTIVE';
    }
  } else {
    scenario.status = 'COMPLETED';
    pushNotice(
      `🎉 ${scenario.type} fully realized! ` +
      `Ongoing revenue: $${stage.rewards.revenue.toLocaleString()}/month`
    );
  }
}

function failStage(scenario) {
  const stage    = scenario.currentStage;
  const penalties = stage.penalties.ifFailed;

  state.funds    -= (penalties.revenue        || 0);
  state.prestige += (penalties.prestige       || 0);
  state.pop      += (penalties.populationLoss || 0);
  state.revenue.lost += (penalties.revenue    || 0);

  scenario.stageStatus = 'FAILED';
  scenario.acceptanceHistory.push({
    stage: stage.id, action: 'FAILED', month: state.month
  });

  if (penalties.renegotiate) {
    scenario.status = 'RENEGOTIATING';
    scenario.renegotiationOffer = {
      newRevenue:  Math.floor(stage.rewards.revenue * 0.7),
      newDeadline: 90,
      message:     penalties.message || "They're willing to continue at reduced capacity."
    };
    requestFlash(`__RENEGOTIATE__:${scenario.id}`);
    pushNotice(`⚠️ ${scenario.type}: stage failed — renegotiation offered.`);
  } else if (penalties.contractEnds) {
    scenario.status = 'FAILED_CONTRACT_ENDED';
    pushNotice(`❌ ${scenario.type} contract ended. ${penalties.message || ''}`);
  }
}

function declineStage(scenario) {
  const stage    = scenario.currentStage;
  const penalties = stage.penalties.ifDeclined;

  state.funds    -= (penalties.revenue        || 0);
  state.prestige += (penalties.prestige       || 0);
  state.pop      += (penalties.populationLoss || 0);
  state.revenue.lost += (penalties.revenue    || 0);

  if (penalties.contractBlacklist) {
    state.scenarios.contractBlacklist[scenario.type] = {
      until:  state.month + penalties.contractBlacklist,
      reason: 'Declined'
    };
  }

  scenario.status = 'DECLINED';
  scenario.acceptanceHistory.push({
    stage: stage.id, action: 'DECLINED', month: state.month
  });

  pushNotice(`❌ ${scenario.type} DECLINED. ${penalties.message || ''}`);
}

// ── ScenarioManager ────────────────────────────────────────────────

export class ScenarioManager {
  constructor(gameState) {
    this._state             = gameState;
    this.activeScenarios    = [];
    this.completedScenarios = [];
  }

  // ── Spawn ────────────────────────────────────────────────────────

  /**
   * Add a new scenario from a blueprint.
   * Sets status OFFERED and queues it in state.pendingOffers for the UI
   * to show an acceptance modal (and pause the game).
   */
  addScenario(blueprint) {
    const bl = this._state.scenarios.contractBlacklist[blueprint.type];
    if (bl && bl.until > this._state.month) {
      const remaining = bl.until - this._state.month;
      pushNotice(`⛔ ${blueprint.type} is blacklisted for ${remaining} more months.`);
      return null;
    }

    const stages = blueprint.stages.map(s => ({
      ...s,
      requirements: JSON.parse(JSON.stringify(s.requirements)),
      rewards:      { ...s.rewards },
      penalties:    JSON.parse(JSON.stringify(s.penalties)),
      monthsRemaining: s.monthsUntilDeadline
    }));

    const scenario = {
      id:                 `${blueprint.type}_${this._state.month}_${Math.floor(Math.random() * 9000) + 1000}`,
      type:               blueprint.type,
      status:             'OFFERED',   // waits for player acceptance
      stages,
      currentStageIndex:  0,
      currentStage:       stages[0],
      completedStages:    [],
      acceptanceHistory:  [],
      renegotiationOffer: null,
      tiles:              null,
      monthsRemaining:    stages[0].monthsUntilDeadline,
      stageStatus:        'IN_PROGRESS'
    };

    this.activeScenarios.push(scenario);
    this._state.scenarios.active = this.activeScenarios;

    // Queue for UI to show offer modal + pause
    this._state.pendingOffers.push(scenario.id);
    return scenario;
  }

  // ── Tick (called once per game month from simulation.js) ─────────

  tick(monthsElapsed = 1) {
    this.activeScenarios.forEach(scenario => {
      // Only tick ACTIVE contracts — OFFERED/PLACEMENT/RENEGOTIATING wait for player
      if (scenario.status !== 'ACTIVE') return;

      scenario.monthsRemaining             -= monthsElapsed;
      scenario.currentStage.monthsRemaining = scenario.monthsRemaining;

      const { met } = checkAllRequirements(
        scenario.currentStage, scenario, this._state
      );

      if (met && scenario.stageStatus === 'IN_PROGRESS') {
        scenario.stageStatus = 'REQUIREMENTS_MET';
        pushNotice(`✓ ${scenario.currentStage.name} requirements met — hold until deadline!`);
      } else if (!met && scenario.stageStatus === 'REQUIREMENTS_MET') {
        scenario.stageStatus = 'IN_PROGRESS';
        pushNotice(`⚠️ ${scenario.currentStage.name} requirements no longer met!`);
      }

      if (scenario.monthsRemaining > 0 && scenario.monthsRemaining <= 30) {
        if (Math.ceil(scenario.monthsRemaining) % 6 === 0) {
          requestFlash(`${scenario.type}: ${Math.ceil(scenario.monthsRemaining)} months left!`);
        }
      }

      if (scenario.monthsRemaining <= 0) {
        if (met) completeStage(scenario);
        else     failStage(scenario);
      }
    });

    // Archive finished scenarios
    this.activeScenarios = this.activeScenarios.filter(s => {
      if (['COMPLETED', 'FAILED_CONTRACT_ENDED', 'DECLINED'].includes(s.status)) {
        this.completedScenarios.push(s);
        return false;
      }
      return true;
    });
    this._state.scenarios.active    = this.activeScenarios;
    this._state.scenarios.completed = this.completedScenarios;
  }

  // ── Queries ──────────────────────────────────────────────────────

  getScenario(id) {
    return this.activeScenarios.find(s => s.id === id) ||
           this.completedScenarios.find(s => s.id === id) ||
           null;
  }

  /**
   * Summary for the contracts panel — excludes OFFERED (those use a modal).
   * PLACEMENT scenarios are included so the player sees what they committed to.
   */
  getContractStatus() {
    return this.activeScenarios
      .filter(s => s.status !== 'OFFERED')
      .map(s => {
        const { met, details } = checkAllRequirements(
          s.currentStage, s, this._state
        );
        return {
          id:                 s.id,
          type:               s.type,
          stage:              s.currentStageIndex + 1,
          totalStages:        s.stages.length,
          stageName:          s.currentStage.name,
          deadlineIn:         Math.ceil(s.monthsRemaining),
          maxDeadline:        s.currentStage.monthsUntilDeadline,
          requirementsMet:    met,
          requirementDetails: details,
          stageStatus:        s.stageStatus,
          status:             s.status,
          pendingRevenue:     s.currentStage.rewards.revenue,
          earnedRevenue:      s.stages
            .slice(0, s.currentStageIndex)
            .reduce((sum, stage) => sum + stage.rewards.revenue, 0),
          renegotiationOffer: s.renegotiationOffer || null,
          tilesRequired:      s.currentStage.requirements.tiles?.count || 0,
          tilesSelected:      s.tiles?.length || 0
        };
      });
  }

  // ── Player actions ───────────────────────────────────────────────

  /**
   * Player accepts a contract offer.
   * Transitions to PLACEMENT and sets state.placementMode.
   * Game stays paused; UI shows placement banner.
   */
  acceptOffer(scenarioId) {
    const scenario = this.getScenario(scenarioId);
    if (!scenario || scenario.status !== 'OFFERED') return false;

    scenario.status = 'PLACEMENT';
    const tileReq = scenario.currentStage.requirements.tiles;
    const required = tileReq?.count || 9;
    const size     = tileReq?.size  || 3;
    this._state.placementMode = { scenarioId, required, size, selectedTiles: [] };
    pushNotice(`📍 Place a ${size}×${size} zone for ${scenario.type}.`);
    return true;
  }

  /**
   * Player declines a contract offer (before accepting).
   * Applies ifDeclined penalties and archives the scenario.
   */
  declineOffer(scenarioId) {
    const scenario = this.getScenario(scenarioId);
    if (!scenario || scenario.status !== 'OFFERED') return false;
    declineStage(scenario);
    return true;
  }

  /**
   * Player cancels during tile placement (after accepting).
   * Resets placement mode and applies decline penalties.
   */
  cancelPlacement(scenarioId) {
    const scenario = this.getScenario(scenarioId);
    if (!scenario || scenario.status !== 'PLACEMENT') return false;
    this._state.placementMode = null;
    // Temporarily set OFFERED so declineStage can fire
    scenario.status = 'OFFERED';
    declineStage(scenario);
    return true;
  }

  /**
   * Player confirms tile selection and activates the contract.
   * Unlocks the game (caller should unpause).
   */
  confirmPlacement(scenarioId) {
    const scenario = this.getScenario(scenarioId);
    if (!scenario || scenario.status !== 'PLACEMENT') return false;
    const pm = this._state.placementMode;
    if (!pm || pm.scenarioId !== scenarioId) return false;
    if (pm.selectedTiles.length === 0) return false;

    const tiles = pm.selectedTiles;
    this.placeScenario(scenarioId, tiles);

    scenario.status      = 'ACTIVE';
    scenario.stageStatus = 'IN_PROGRESS';
    this._state.placementMode = null;
    return true;
  }

  /**
   * Lock a set of tiles to this contract.
   * tiles: Array of [x, y] pairs.
   */
  placeScenario(scenarioId, tiles) {
    const scenario = this.getScenario(scenarioId);
    if (!scenario) return false;

    // Append — each stage adds tiles rather than replacing them
    scenario.tiles = [...(scenario.tiles || []), ...tiles];
    tiles.forEach(([x, y]) => {
      const tile = tileAt(x, y);
      if (tile) {
        tile.contractId     = scenarioId;
        tile.contractType   = scenario.type;
        tile.contractLocked = true;
      }
    });

    pushNotice(`📍 ${scenario.type} zone placed (${tiles.length} tiles).`);
    return true;
  }

  /** Player explicitly declines an active contract via the panel. */
  declineScenario(scenarioId) {
    const scenario = this.getScenario(scenarioId);
    if (!scenario || scenario.status === 'DECLINED') return false;
    declineStage(scenario);
    return true;
  }

  acceptRenegotiation(scenarioId) {
    const scenario = this.getScenario(scenarioId);
    if (!scenario || scenario.status !== 'RENEGOTIATING') return false;

    const offer = scenario.renegotiationOffer;
    scenario.currentStage.rewards.revenue = offer.newRevenue;
    scenario.monthsRemaining              = offer.newDeadline;
    scenario.status                       = 'ACTIVE';
    scenario.stageStatus                  = 'IN_PROGRESS';
    scenario.renegotiationOffer           = null;

    state.revenue.monthly += offer.newRevenue;
    pushNotice(`Accepted reduced terms. ${offer.newDeadline} months to complete.`);
    return true;
  }

  rejectRenegotiation(scenarioId) {
    const scenario = this.getScenario(scenarioId);
    if (!scenario) return false;
    scenario.status = 'ACTIVE';
    declineStage(scenario);
    return true;
  }

  // ── Save/load sync ───────────────────────────────────────────────

  loadFromState() {
    this.activeScenarios = (this._state.scenarios.active || []).map(saved => {
      const blueprint = SCENARIOS[saved.type];
      if (!blueprint) return null;

      const stages = blueprint.stages.map(s => ({
        ...s,
        requirements: JSON.parse(JSON.stringify(s.requirements)),
        rewards:      { ...s.rewards },
        penalties:    JSON.parse(JSON.stringify(s.penalties))
      }));

      return {
        ...saved,
        stages,
        currentStage: stages[saved.currentStageIndex] || stages[0]
      };
    }).filter(Boolean);

    this.completedScenarios = this._state.scenarios.completed || [];
  }
}

// ── Singleton ──────────────────────────────────────────────────────
export const scenarioManager = new ScenarioManager(state);
export { SCENARIOS };
