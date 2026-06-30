/* ================================================================
   scenario.js — ScenarioManager: multi-stage contract system.

   Manages active/completed scenarios, monthly ticking, stage
   transitions, rewards, penalties, and renegotiation logic.

   Completely decoupled from the DOM — communicates only via
   pushNotice() and requestFlash(). UI listens for two special
   flash payloads:
     "__RENEGOTIATE__:<id>"           → open renegotiation modal
     "__DECLINE_CONSEQUENCES__:<id>"  → show decline consequences

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
    scenario.status          = 'ACTIVE';

    pushNotice(`✓ ${stage.name} complete!`);
    pushNotice(`Next: ${scenario.currentStage.name} (${Math.ceil(scenario.monthsRemaining)} months)`);
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

  // Apply penalties (populationLoss stored as negative in blueprints)
  state.funds    -= (penalties.revenue        || 0);
  state.prestige += (penalties.prestige       || 0);  // negative value
  state.pop      += (penalties.populationLoss || 0);  // negative value
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
    // Signal UI to open renegotiation modal
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

  // Apply brutal penalties
  state.funds    -= (penalties.revenue        || 0);
  state.prestige += (penalties.prestige       || 0);  // large negative
  state.pop      += (penalties.populationLoss || 0);  // large negative
  state.revenue.lost += (penalties.revenue    || 0);

  // Blacklist this contract type
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

  // Signal UI to show consequences screen
  requestFlash(`__DECLINE_CONSEQUENCES__:${scenario.id}`);
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

  /** Add a new scenario from a blueprint. Returns the scenario or null if blacklisted. */
  addScenario(blueprint) {
    // Blacklist check
    const bl = this._state.scenarios.contractBlacklist[blueprint.type];
    if (bl && bl.until > this._state.month) {
      const remaining = bl.until - this._state.month;
      pushNotice(`⛔ ${blueprint.type} is blacklisted for ${remaining} more months.`);
      return null;
    }

    // Deep-clone stages so mutations never corrupt the source blueprint
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
      status:             'ACTIVE',
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
    // Keep state.scenarios.active in sync for save/load
    this._state.scenarios.active = this.activeScenarios;

    pushNotice(`📋 New contract available: ${stages[0].name}`);
    return scenario;
  }

  // ── Tick (called once per game month from simulation.js) ─────────

  tick(monthsElapsed = 1) {
    this.activeScenarios.forEach(scenario => {
      if (scenario.status !== 'ACTIVE') return;

      // Decrement deadline
      scenario.monthsRemaining             -= monthsElapsed;
      scenario.currentStage.monthsRemaining = scenario.monthsRemaining;

      // Evaluate requirements
      const { met, details } = checkAllRequirements(
        scenario.currentStage, scenario, this._state
      );

      // Notify on status change
      if (met && scenario.stageStatus === 'IN_PROGRESS') {
        scenario.stageStatus = 'REQUIREMENTS_MET';
        pushNotice(`✓ ${scenario.currentStage.name} requirements met — hold until deadline!`);
      } else if (!met && scenario.stageStatus === 'REQUIREMENTS_MET') {
        scenario.stageStatus = 'IN_PROGRESS';
        pushNotice(`⚠️ ${scenario.currentStage.name} requirements no longer met!`);
      }

      // Deadline warnings (every 6 months when < 30 months remain)
      if (scenario.monthsRemaining > 0 && scenario.monthsRemaining <= 30) {
        if (Math.ceil(scenario.monthsRemaining) % 6 === 0) {
          requestFlash(`${scenario.type}: ${Math.ceil(scenario.monthsRemaining)} months left!`);
        }
      }

      // Deadline passed → resolve
      if (scenario.monthsRemaining <= 0) {
        if (met) {
          completeStage(scenario);
        } else {
          failStage(scenario);
        }
      }
    });

    // Archive finished scenarios; keep state.scenarios in sync
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

  /** Look up a scenario by id (active first, then completed). */
  getScenario(id) {
    return this.activeScenarios.find(s => s.id === id) ||
           this.completedScenarios.find(s => s.id === id) ||
           null;
  }

  /** Summary of all active contracts — used by the UI contracts panel. */
  getContractStatus() {
    return this.activeScenarios.map(s => {
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
        renegotiationOffer: s.renegotiationOffer || null
      };
    });
  }

  // ── Player actions ───────────────────────────────────────────────

  /**
   * Lock a set of tiles to this contract.
   * tiles: Array of [x, y] pairs.
   */
  placeScenario(scenarioId, tiles) {
    const scenario = this.getScenario(scenarioId);
    if (!scenario) return false;

    scenario.tiles = tiles;
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

  /** Player explicitly declines an active contract. */
  declineScenario(scenarioId) {
    const scenario = this.getScenario(scenarioId);
    if (!scenario || scenario.status === 'DECLINED') return false;
    declineStage(scenario);
    return true;
  }

  /** Player accepts a renegotiation offer after a stage failure. */
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

  /** Player rejects a renegotiation offer — triggers full decline penalties. */
  rejectRenegotiation(scenarioId) {
    const scenario = this.getScenario(scenarioId);
    if (!scenario) return false;
    // Reset status so declineStage can run its normal flow
    scenario.status = 'ACTIVE';
    declineStage(scenario);
    return true;
  }

  // ── Save/load sync ───────────────────────────────────────────────

  /**
   * Rebuild in-memory scenario objects from a deserialized save blob.
   * Called by applySave() after restoring state.scenarios.active.
   * Merges saved runtime data onto the matching blueprint stages.
   */
  loadFromState() {
    this.activeScenarios = (this._state.scenarios.active || []).map(saved => {
      const blueprint = SCENARIOS[saved.type];
      if (!blueprint) return null;   // unknown type — skip

      const stages = blueprint.stages.map((s, i) => ({
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

// Re-export SCENARIOS so other modules (simulation.js) can import it
// from a single place without reaching into the blueprints file directly.
export { SCENARIOS };
