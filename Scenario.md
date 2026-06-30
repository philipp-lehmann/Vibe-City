# Scenario.md — Contract Progression System

Multi-stage contract scenarios with time-based requirements, penalties, and systemic integration. Extensible for multiple contract types (datacenter, shipping, wildlife) with concurrent active scenarios.

## Overview

**Scenario = Multi-stage contract with escalating demands, hard deadlines, and cascading penalties.**

- Each scenario works in **stages**
- Each stage has **requirements** (power, water, zones, happiness, workforce) tied to existing game systems
- Each stage has a **deadline** (in in-game months)
- Failure to meet requirements triggers **stage-specific penalties**
- Declining a contract has **brutal permanent consequences** (blacklist, revenue loss, population loss)
- The scenario generation has random elements (occurance, revenues, penalties) to make each playthrough unique
- **Multiple scenarios can be active simultaneously**

---

## Architecture

### Scenario Object

```javascript
{
  id: "datacenter_alpha",                          // unique identifier
  type: "AI_DATA_CENTRE",                          // extensible: SHIPPING_CENTRE, WILDLIFE_RESERVE
  status: "ACTIVE",                                // ACTIVE, REQUIREMENTS_MET, COMPLETED, DECLINED, FAILED_CONTRACT_ENDED, RENEGOTIATING
  
  stages: [ /* array of 3 stage objects */ ],
  
  // Current progress
  currentStageIndex: 0,                            // 0, 1, 2
  currentStage: { /* stage object */ },
  completedStages: ["stage_1_setup"],
  
  // Tracking
  monthsRemaining: 45,                               // countdown to deadline
  stageStatus: "IN_PROGRESS",                      // IN_PROGRESS, REQUIREMENTS_MET, FAILED, COMPLETED
  acceptanceHistory: [
    { stage: "stage_1", action: "ACCEPTED", date: "2026-04-01" }
  ],
  
  // Optional renegotiation offer (if stage failed)
  renegotiationOffer: null,
  
  // Tiles this contract occupies (set during placement)
  tiles: [ [10, 15], [10, 16], [11, 15], [11, 16], [12, 15] ]
}
```

### Stage Object

```javascript
{
  id: "stage_1_setup",
  name: "Initial Campus Build",
  
  // Deadline
  monthsUntilDeadline: 120,                          // 10 years
  monthsRemaining: 12,                               // synced each tick
  
  // What must be fulfilled
  requirements: {
    tiles: {
      count: 5,                                    // 5×5 = 25 tiles
      type: "placement",
      position: null,                              // no constraint, or "adjacent_to_stage_1", "waterfront", etc.
      validator: (contract, state) => { /* custom logic */ }
    },
    power: {
      amount: 8,                                   // MW required
      type: "infrastructure"
    },
    water: {
      amount: 4,                                   // water coverage required
      type: "infrastructure"
    },
    happiness: {
      minValue: 55,                                // city happiness threshold
      type: "city_stat"
    }
  },
  
  // If requirements met by deadline
  rewards: {
    revenue: 120000,                               // monthly recurring, added to state.revenue
    jobs: 60,                                      // added to job pool
    prestige: 8                                    // added to city prestige/reputation
  },
  
  // If requirements NOT met by deadline
  penalties: {
    ifFailed: {
      revenue: 1320000,                            // lost (lost partial revenue)
      prestige: -15,
      populationLoss: 1600,
      renegotiate: true,                           // stage can be retried at worse terms
      message: "They're willing to continue at reduced capacity..."
    },
    
    ifDeclined: {
      revenue: 2640000,                            // lost (full remaining revenue)
      prestige: -25,
      populationLoss: 3200,
      contractBlacklist: 1825,                     // months before this contract type can reappear (5 years)
      message: "They've relocated to {Random City}"
    }
  }
}
```

---

## Requirement Types

Each requirement checks a specific game system. Built-in validators:

### `tiles` Requirement

**What it checks:** Contract zone is placed and correct size.

```javascript
validator: (contract, state) => {
  const placedTiles = state.tiles.filter(t => t.contractId === contract.id);
  return placedTiles.length === contract.currentStage.requirements.tiles.count;
}
```

**Notes:**
- Placement happens via UI (user drags 5×5 zone onto map)
- Once placed, cannot be moved
- Scenario buildings can be build everywhere and bulldoze everything underneath
- Placement locks all tiles (can't build over or bulldoze them)

---

### `power` Requirement

**What it checks:** Power infrastructure can supply the required MW to the contract zone.

```javascript
validator: (contract, state) => {
  const gridCapacity = state.powerGrid.availableCapacity();
  return gridCapacity >= contract.currentStage.requirements.power.amount;
}
```

**Notes:**
- Check happens against *available* capacity (not total)
- If power is lost elsewhere in grid, requirement fails immediately
- High-risk requirement (easy to fail if grid is marginal)

---

### `water` Requirement

**What it checks:** Water infrastructure reaches the contract zone.

```javascript
validator: (contract, state) => {
  const waterCoverage = state.water.coverageAt(contract.tiles);
  return waterCoverage >= contract.currentStage.requirements.water.amount;
}
```

**Notes:**
- Water spreads from pumps
- If a pump goes offline, coverage drops and requirement fails

---

### `happiness` Requirement

**What it checks:** City-wide happiness meets minimum.

```javascript
validator: (contract, state) => {
  return state.happiness >= contract.currentStage.requirements.happiness.minValue;
}
```

**Notes:**
- High happiness requirement = company is picky about location
- Pollution, unemployment, poor services lower happiness
- Can be a catch-22: build the infrastructure, happiness drops from strain

---

### `labor` Requirement (optional)

**What it checks:** Available skilled/unskilled workforce in the city.

```javascript
validator: (contract, state) => {
  const available = state.population.skilled - state.population.employed.skilled;
  return available >= contract.currentStage.requirements.labor.skilled;
}
```

**Notes:**
- Data centres need skilled workers
- Shipping centres need low-skill workers
- If unemployment is zero, requirement fails

---

### Custom Validators

Stages can define custom validators for position constraints:

```javascript
position: "waterfront"
validator: (contract, state) => {
  // Check all contract tiles are adjacent to water
  return contract.tiles.every(t => 
    state.getTilesAdjacent(t).some(adj => adj.type === T.WATER)
  );
}

position: "adjacent_to_stage_1"
validator: (contract, state) => {
  // Expansion must be adjacent to original campus
  const prevStage = state.scenarios.find(s => s.id === contract.id)
                        .stages[0];
  return contract.tiles.some(t => 
    state.getTilesAdjacent(t).some(adj => 
      prevStage.tiles.includes(adj)
    )
  );
}
```

---

## Progression Logic

### Each Frame Tick

Called from `main.js` requestAnimationFrame loop:

```javascript
function tickScenarios(deltaTime) {
  scenarioManager.tick(deltaTime);
}
```

Inside `ScenarioManager.tick()`:

```javascript
tick(deltaTime) {
  this.activeScenarios.forEach(scenario => {
    if (scenario.status !== "ACTIVE") return;
    
    // 1. Decrement deadline
    scenario.monthsRemaining -= (deltaTime / TICKS_PER_MONTH);
    scenario.currentStage.monthsRemaining = scenario.monthsRemaining;
    
    // 2. Check all requirements
    const requirementsMet = checkAllRequirements(
      scenario.currentStage, 
      state
    );
    
    // 3. Status transitions
    if (requirementsMet && scenario.stageStatus !== "REQUIREMENTS_MET") {
      scenario.stageStatus = "REQUIREMENTS_MET";
      pushNotice(`✓ ${scenario.currentStage.name} requirements met!`);
    } else if (!requirementsMet && scenario.stageStatus !== "IN_PROGRESS") {
      scenario.stageStatus = "IN_PROGRESS";
      pushNotice(`⚠️ ${scenario.currentStage.name} requirements unmet!`);
    }
    
    // 4. Deadline alerts
    if (scenario.monthsRemaining < 30 && scenario.monthsRemaining > 0) {
      if (Math.floor(scenario.monthsRemaining) % 5 === 0) {
        requestFlash(`${scenario.id}: ${Math.ceil(scenario.monthsRemaining)} months!`);
      }
    }
    
    // 5. Deadline passed
    if (scenario.monthsRemaining <= 0) {
      if (requirementsMet) {
        this.completeStage(scenario);
      } else {
        this.failStage(scenario);
      }
    }
  });
  
  // Move completed scenarios to archive
  this.activeScenarios = this.activeScenarios.filter(s => {
    if (s.status === "COMPLETED" || s.status === "FAILED_CONTRACT_ENDED") {
      this.completedScenarios.push(s);
      return false;
    }
    return true;
  });
}
```

---

## Stage Completion

When deadline is met *and* all requirements are fulfilled:

```javascript
completeStage(scenario) {
  const stage = scenario.currentStage;
  
  // 1. Grant rewards
  state.revenue.monthly += stage.rewards.revenue;
  state.population.jobs.available += stage.rewards.jobs;
  state.prestige += stage.rewards.prestige;
  
  // 2. Mark stage
  scenario.completedStages.push(stage.id);
  scenario.stageStatus = "COMPLETED";
  scenario.acceptanceHistory.push({
    stage: stage.id,
    action: "COMPLETED",
    date: state.currentDate
  });
  
  // 3. Advance or finish
  scenario.currentStageIndex += 1;
  
  if (scenario.currentStageIndex < scenario.stages.length) {
    // Move to next stage
    scenario.currentStage = scenario.stages[scenario.currentStageIndex];
    scenario.monthsRemaining = scenario.currentStage.monthsUntilDeadline;
    scenario.stageStatus = "IN_PROGRESS";
    scenario.status = "ACTIVE";
    
    pushNotice(`✓ ${stage.name} complete!`);
    pushNotice(`Next: ${scenario.currentStage.name} (${Math.ceil(scenario.monthsRemaining)} months)`);
  } else {
    // All stages complete
    scenario.status = "COMPLETED";
    
    const totalRevenue = scenario.stages
      .reduce((sum, s) => sum + s.rewards.revenue, 0);
    
    pushNotice(
      `🎉 ${scenario.id} fully realized!\n` +
      `Ongoing revenue: $${stage.rewards.revenue}/month`
    );
  }
}
```

---

## Stage Failure

When deadline is met *but* requirements are NOT fulfilled:

```javascript
failStage(scenario) {
  const stage = scenario.currentStage;
  const penalties = stage.penalties.ifFailed;
  
  // 1. Apply penalties
  state.revenue.lost += penalties.revenue;
  state.prestige += penalties.prestige;  // negative value
  state.population.count += penalties.populationLoss;  // negative
  
  // 2. Mark failure
  scenario.stageStatus = "FAILED";
  scenario.acceptanceHistory.push({
    stage: stage.id,
    action: "FAILED",
    date: state.currentDate
  });
  
  // 3. Handle renegotiation or contract end
  if (penalties.renegotiate) {
    scenario.status = "RENEGOTIATING";
    scenario.renegotiationOffer = {
      newRevenue: Math.floor(stage.rewards.revenue * 0.5),  // 50% penalty
      newDeadline: scenario.monthsRemaining + 90,
      message: penalties.message
    };
    
    pushNotice(
      `⚠️ ${scenario.id} Stage ${scenario.currentStageIndex + 1} FAILED.\n` +
      `They're willing to continue... at reduced terms.`
    );
    
    // Show renegotiation modal (UI) with accept/decline buttons
  } else if (penalties.contractEnds) {
    scenario.status = "FAILED_CONTRACT_ENDED";
    
    pushNotice(
      `❌ ${scenario.id} contract ended.\n` +
      `${penalties.message}`
    );
  }
}
```

---

## Stage Decline

When player explicitly rejects a stage (via UI button):

```javascript
declineStage(scenario) {
  const stage = scenario.currentStage;
  const penalties = stage.penalties.ifDeclined;
  
  // 1. Apply brutal penalties
  state.revenue.lost += penalties.revenue;
  state.prestige += penalties.prestige;  // large negative
  state.population.count += penalties.populationLoss;  // large negative
  
  // 2. Blacklist contract type
  state.contractBlacklist[scenario.type] = {
    until: state.gameMonth + penalties.contractBlacklist,
    reason: "You rejected them"
  };
  
  // 3. End scenario
  scenario.status = "DECLINED";
  scenario.acceptanceHistory.push({
    stage: stage.id,
    action: "DECLINED",
    date: state.currentDate
  });
  
  // 4. Show consequences screen
  showDeclineConsequencesModal(scenario, penalties);
  
  pushNotice(
    `❌ ${scenario.id} DECLINED.\n` +
    `${penalties.message}`
  );
}
```

---

## Renegotiation Flow

After a stage fails and enters `RENEGOTIATING` status:

```javascript
// UI shows modal with offer details:
// "They'll reduce operations to 50% capacity.
//  New deadline: 24 months.
//  New revenue: $60K/month (instead of $120K).
//  Accept?"

acceptRenegotiation(scenario) {
  const offer = scenario.renegotiationOffer;
  
  // Update scenario with new terms
  scenario.currentStage.rewards.revenue = offer.newRevenue;
  scenario.monthsRemaining = offer.newDeadline;
  scenario.status = "ACTIVE";
  scenario.stageStatus = "IN_PROGRESS";
  
  state.revenue.monthly += offer.newRevenue;
  
  pushNotice(`Accepted reduced terms. ${offer.newDeadline} months to completion.`);
}

rejectRenegotiation(scenario) {
  // Same as declineStage
  declineStage(scenario);
}
```

---

## ScenarioManager Class

Manages all active scenarios, ticking, and status queries.

```javascript
class ScenarioManager {
  constructor(state) {
    this.state = state;
    this.activeScenarios = [];
    this.completedScenarios = [];
  }
  
  // Add a new scenario to the game
  addScenario(scenarioBlueprint) {
    const scenario = {
      ...scenarioBlueprint,
      status: "ACTIVE",
      currentStageIndex: 0,
      completedStages: [],
      acceptanceHistory: [],
      renegotiationOffer: null,
      tiles: null  // set during placement
    };
    
    scenario.currentStage = scenario.stages[0];
    scenario.monthsRemaining = scenario.stages[0].monthsUntilDeadline;
    scenario.stageStatus = "IN_PROGRESS";
    
    this.activeScenarios.push(scenario);
    pushNotice(`New contract available: ${scenario.stages[0].name}`);
  }
  
  // Main tick called each frame
  tick(deltaTime) {
    this.activeScenarios.forEach(scenario => {
      if (scenario.status === "ACTIVE") {
        this.tickScenario(scenario, deltaTime);
      }
    });
    
    // Archive completed
    this.activeScenarios = this.activeScenarios.filter(s => {
      if (["COMPLETED", "FAILED_CONTRACT_ENDED", "DECLINED"].includes(s.status)) {
        this.completedScenarios.push(s);
        return false;
      }
      return true;
    });
  }
  
  // Tick a single scenario
  tickScenario(scenario, deltaTime) {
    // Implemented as shown in "Progression Logic" section above
  }
  
  // Utility: get all active contract status
  getContractStatus() {
    return this.activeScenarios.map(s => ({
      id: s.id,
      type: s.type,
      stage: s.currentStageIndex + 1,
      stageName: s.currentStage.name,
      deadlineIn: Math.ceil(s.monthsRemaining),
      requirementsMet: checkAllRequirements(s.currentStage, this.state),
      totalRevenue: s.stages
        .slice(0, s.currentStageIndex + 1)
        .reduce((sum, stage) => sum + stage.rewards.revenue, 0),
      stageStatus: s.stageStatus
    }));
  }
  
  // Utility: get specific scenario
  getScenario(id) {
    return this.activeScenarios.find(s => s.id === id) ||
           this.completedScenarios.find(s => s.id === id);
  }
  
  // Player action: place the contract zone
  placeScenario(scenarioId, tiles) {
    const scenario = this.getScenario(scenarioId);
    if (!scenario) return false;
    
    scenario.tiles = tiles;
    // Lock tiles in state
    tiles.forEach(t => {
      const tile = state.tileAt(t[0], t[1]);
      tile.contractId = scenarioId;
      tile.contractType = scenario.type;
    });
    
    return true;
  }
  
  // Player action: decline a stage
  declineScenario(scenarioId) {
    const scenario = this.getScenario(scenarioId);
    if (!scenario) return false;
    
    declineStage(scenario);  // defined above
    return true;
  }
  
  // Player action: accept renegotiation
  acceptRenegotiation(scenarioId) {
    const scenario = this.getScenario(scenarioId);
    if (!scenario || scenario.status !== "RENEGOTIATING") return false;
    
    acceptRenegotiation(scenario);  // defined above
    return true;
  }
}
```

---

## Scenario Blueprints (Config-Driven)

Define new contract types by creating scenario blueprints. Each blueprint becomes a template for new scenarios.

### AI Data Centre

```javascript
const SCENARIOS = {
  AI_DATA_CENTRE: {
    type: "AI_DATA_CENTRE",
    stages: [
      {
        id: "stage_1_setup",
        name: "Initial Campus Build",
        monthsUntilDeadline: 180,
        requirements: {
          tiles: { count: 5, type: "placement", position: null },
          power: { amount: 8, type: "infrastructure" },
          water: { amount: 4, type: "infrastructure" },
          happiness: { minValue: 55, type: "city_stat" }
        },
        rewards: { revenue: 120000, jobs: 60, prestige: 8 },
        penalties: {
          ifFailed: {
            revenue: 1320000,
            prestige: -15,
            populationLoss: 1600,
            renegotiate: true,
            message: "We can stay at reduced capacity..."
          },
          ifDeclined: {
            revenue: 2640000,
            prestige: -25,
            populationLoss: 3200,
            contractBlacklist: 1825,
            message: "They've relocated to New Harbor City."
          }
        }
      },
      {
        id: "stage_2_expansion",
        name: "Capacity Expansion",
        monthsUntilDeadline: 540,
        requirements: {
          tiles: { count: 5, type: "placement", position: "adjacent_to_stage_1" },
          power: { amount: 8, type: "infrastructure" },
          road: { quality: "high", type: "connectivity" },
          labor: { skilled: 150, type: "workforce_available" }
        },
        rewards: { revenue: 100000, jobs: 200, prestige: 12 },
        penalties: {
          ifFailed: {
            revenue: 550000,
            prestige: -10,
            populationLoss: 800,
            renegotiate: false,
            contractEnds: true
          },
          ifDeclined: {
            revenue: 1100000,
            prestige: -20,
            populationLoss: 1600,
            contractBlacklist: 1825,
            message: "Expansion cancelled. They downgrade and eventually leave."
          }
        }
      },
      {
        id: "stage_3_consolidation",
        name: "Mega-Campus Consolidation",
        monthsUntilDeadline: 900,
        requirements: {
          tiles: { count: 10, type: "placement", position: "merge_both_campuses" },
          power: { amount: 16, type: "infrastructure" },
          water: { amount: 8, type: "infrastructure" },
          road: { quality: "highway", type: "connectivity" },
          happiness: { minValue: 65, type: "city_stat" }
        },
        rewards: { revenue: 180000, jobs: 100, prestige: 20 },
        penalties: {
          ifFailed: {
            revenue: 810000,
            prestige: -20,
            populationLoss: 1600,
            renegotiate: false,
            contractEnds: true,
            message: "Contract ends. They relocate entirely."
          },
          ifDeclined: {
            revenue: 1620000,
            prestige: -30,
            populationLoss: 3200,
            contractBlacklist: 1825,
            message: "Mega-campus dream abandoned. Contract ended."
          }
        }
      }
    ]
  }
};
```

### Shipping Centre (Future)

```javascript
SCENARIOS.SHIPPING_CENTRE = {
  type: "SHIPPING_CENTRE",
  stages: [
    {
      id: "stage_1_port",
      name: "Regional Hub Establishment",
      monthsUntilDeadline: 180,
      requirements: {
        tiles: { count: 5, type: "placement", position: "waterfront" },
        power: { amount: 2, type: "infrastructure" },
        water: { amount: 6, type: "water_access_deep" },
        road: { quality: "high", type: "connectivity" }
      },
      rewards: { revenue: 45000, jobs: 180, prestige: 5 },
      penalties: {
        ifFailed: { /* ... */ },
        ifDeclined: { /* ... */ }
      }
    }
    // stage 2, 3...
  ]
};
```

### Wildlife Reserve (Future)

```javascript
SCENARIOS.WILDLIFE_RESERVE = {
  type: "WILDLIFE_RESERVE",
  stages: [
    {
      id: "stage_1_protected",
      name: "Protected Area Designation",
      monthsUntilDeadline: 120,
      requirements: {
        tiles: { count: 5, type: "placement", position: null },
        pollution: { maxValue: 20, type: "city_stat" },
        happiness: { minValue: 50, type: "city_stat" }
      },
      rewards: { revenue: 25000, jobs: 40, prestige: 5 },
      penalties: {
        ifFailed: { /* ... */ },
        ifDeclined: { /* ... */ }
      }
    }
    // stage 2, 3...
  ]
};
```

---

## UI Integration

### Inspector Panel (Hovering Contract Tile)

```
╔════════════════════════════════════════╗
║ AI DATA CENTRE – Alpha                 ║
║                                        ║
║ STAGE 2/3: Capacity Expansion          ║
║ ████████░░░░░░ 45 months left          ║
║                                        ║
║ REQUIREMENTS:                          ║
║ ✓ Placement: 5×5 tiles (adjacent)      ║
║ ✓ Power: 8MW available                 ║
║ ✗ Roads: High quality (cur: Medium)    ║
║ ✗ Labor: 150 skilled (avail: 80)       ║
║                                        ║
║ Status: IN PROGRESS                    ║
║ Stage Revenue: +$100K/month (pending)  ║
║ Total Revenue: $220K/month             ║
║                                        ║
║ [DECLINE CONTRACT] [DETAILS]           ║
╚════════════════════════════════════════╝
```

### Contract Status Panel (New UI Component)

Lists all active scenarios:

```
╔════════════════════════════════════════╗
║ ACTIVE CONTRACTS                       ║
║────────────────────────────────────────║
║                                        ║
║ 1. AI DATA CENTRE (Stage 2/3)          ║
║    ✓✓✗ 45 months left                    ║
║    Revenue: $220K/month                ║
║                                        ║
║ 2. SHIPPING CENTRE (Stage 1/3)         ║
║    ✓✓✓ ✓✓ 120 months left                ║
║    Revenue: $45K/month                 ║
║                                        ║
║ 3. WILDLIFE RESERVE (Stage 1/3)        ║
║    ✗✓✓ 85 months left                    ║
║    Revenue: $25K/month                 ║
║                                        ║
║ [OPEN FULL DETAIL] [DECLINE]           ║
╚════════════════════════════════════════╝
```

### Decline Confirmation Modal

```
╔═══════════════════════════════════════════════════════╗
║ ⚠️  DECLINE CONTRACT?                                 ║
║                                                       ║
║ AI DATA CENTRE – Stage 2: Capacity Expansion          ║
║                                                       ║
║ CONSEQUENCES:                                         ║
║ • Lost Revenue: $1,100,000                            ║
║ • Lost Prestige: -20                                  ║
║ • Population Loss: 1,600 (skilled workers)            ║
║ • Blacklist: No tech contracts for 5 years            ║
║                                                       ║
║ This is permanent. Are you sure?                      ║
║                                                       ║
║ [CANCEL]  [DECLINE - I'M SURE]                        ║
╚═══════════════════════════════════════════════════════╝
```

### Renegotiation Offer Modal

```
╔═══════════════════════════════════════════════════════╗
║ 📋 RENEGOTIATION OFFER                                ║
║                                                       ║
║ AI DATA CENTRE – Stage 2 Failed                       ║
║                                                       ║
║ "We can stay... but at reduced capacity."            ║
║                                                       ║
║ OLD TERMS:                                            ║
║ • Revenue: $100K/month                                ║
║ • Timeline: 540 months                                  ║
║                                                       ║
║ NEW TERMS:                                            ║
║ • Revenue: $70K/month (30% reduction)                 ║
║ • Timeline: 630 months (90 extra months)                  ║
║                                                       ║
║ [ACCEPT OFFER]  [DECLINE & END CONTRACT]              ║
╚═══════════════════════════════════════════════════════╝
```

---

## Integration with Existing Systems

### State Object (in `state.js`)

Add to the main `state` object:

```javascript
const state = {
  // ... existing fields ...
  
  scenarios: {
    active: [],        // active scenarios
    completed: [],     // finished/failed scenarios
    contractBlacklist: {
      "AI_DATA_CENTRE": { until: null, reason: "" },
      "SHIPPING_CENTRE": { until: null, reason: "" },
      "WILDLIFE_RESERVE": { until: null, reason: "" }
    }
  },
  
  // Derived from scenarios
  revenue: {
    monthly: 0,        // sum of all active scenario rewards.revenue
    lost: 0            // sum of all penalties.revenue
  }
};
```

### Save/Load (in `state.js`)

When serializing and deserializing saves, include scenarios:

```javascript
function serializeSave() {
  return {
    // ... existing fields ...
    scenarios: {
      active: state.scenarios.active.map(s => ({
        id: s.id,
        type: s.type,
        status: s.status,
        currentStageIndex: s.currentStageIndex,
        monthsRemaining: s.monthsRemaining,
        tiles: s.tiles,
        acceptanceHistory: s.acceptanceHistory,
        completedStages: s.completedStages
      })),
      contractBlacklist: state.scenarios.contractBlacklist
    }
  };
}

function applySave(save) {
  // Restore scenarios
  state.scenarios.active = save.scenarios.active.map(s => {
    const blueprint = SCENARIOS[s.type];
    return {
      ...blueprint,
      ...s,
      currentStage: blueprint.stages[s.currentStageIndex]
    };
  });
  state.scenarios.contractBlacklist = save.scenarios.contractBlacklist;
}
```

### Simulation (in `simulation.js`)

Monthly tick: check if any scenarios are due to be offered (random or triggered):

```javascript
function monthlyTick() {
  // ... existing monthly logic ...
  
  // Check if any contracts should be offered
  if (Math.random() < 0.3 && scenarioManager.activeScenarios.length < 3) {
    const availableTypes = Object.keys(SCENARIOS)
      .filter(type => {
        const blacklist = state.scenarios.contractBlacklist[type];
        return !blacklist || blacklist.until < state.gameMonth;
      });
    
    if (availableTypes.length > 0) {
      const type = availableTypes[Math.floor(Math.random() * availableTypes.length)];
      scenarioManager.addScenario(SCENARIOS[type]);
    }
  }
  
  // Tick all scenarios
  scenarioManager.tick(TICKS_PER_MONTH);
}
```

### Notification System (in `state.js`)

Scenarios emit via `pushNotice()` and `requestFlash()` as usual.

---

## File Organization

Add to project structure:

```
src/
  scenario.js         (ScenarioManager class, helper functions)
  scenarios/
    blueprints.js     (SCENARIOS config with all contracts)
    requirements.js   (validator functions for each requirement type)
  
CLAUDE.md             (updated with scenario module description)
Scenario.md           (this file)
```

---

## Implementation Checklist

### 1. Create `ScenarioManager` class

- [ ] Create `js/scenario.js` — new module, no existing file to touch
- [ ] Define `ScenarioManager` class with `constructor(state)`, `activeScenarios = []`, `completedScenarios = []`
- [ ] Implement `addScenario(blueprint)` — deep-clone blueprint, set `status: "ACTIVE"`, `currentStageIndex: 0`, attach `currentStage`, `monthsRemaining`, emit `pushNotice`
- [ ] Implement `getScenario(id)` — search both `activeScenarios` and `completedScenarios`
- [ ] Implement `getContractStatus()` — map active scenarios to summary objects with `deadlineIn`, `requirementsMet`, `totalRevenue`
- [ ] Implement `placeScenario(scenarioId, tiles)` — set `scenario.tiles`, write `contractId` + `contractType` onto each `state.tileAt(x, y)`, mark tiles as locked (add `contractLocked: true` to `makeTile` shape in `state.js`)
- [ ] Implement `declineScenario(scenarioId)` and `acceptRenegotiation(scenarioId)` as thin wrappers over the stage functions
- [ ] Export a singleton `export const scenarioManager = new ScenarioManager(state)` at the bottom of the file

---

### 2. Implement `checkAllRequirements()`

- [ ] Create `js/scenarios/requirements.js` — one validator function per requirement type, all exported
- [ ] **`tiles` validator** — filter `state.grid` tiles where `tile.contractId === contract.id`, compare count to `requirements.tiles.count`
- [ ] **`power` validator** — sum `powered: true` tiles on the contract footprint; also check global available capacity (expose `availablePowerCapacity()` helper from `simulation.js` that returns `totalGenerated - totalConsumed`)
- [ ] **`water` validator** — check that all contract tiles have `tile.water === true` (already computed by `propagateWater` in `simulation.js`)
- [ ] **`happiness` validator** — compare `state.happiness` to `requirements.happiness.minValue`
- [ ] **`labor` validator** — `state.pop` minus sum of `tile.pop` on all `T.COM`/`T.IND` tiles gives rough available workforce; wire to `requirements.labor.skilled`
- [ ] **`road` validator** — check that contract tiles have `tile.nearRoad === true` (quality tiers: `"high"` requires `nearRoad` + at least one adjacent road tile, `"highway"` is a stub for now)
- [ ] Implement `checkAllRequirements(stage, contract, state)` — iterate `Object.entries(stage.requirements)`, call the matching validator, return `{ met: bool, details: { [key]: bool } }`

---

### 3. Wire `tick()` into main loop

- [ ] In `js/main.js`, import `scenarioManager` from `./scenario.js`
- [ ] In the `requestAnimationFrame` loop, call `scenarioManager.tick(deltaMs)` after the existing simulation tick (but before `syncUI`)
- [ ] Pass `TICKS_PER_MONTH` (define in `config.js` if not already present — currently implied by `state.speeds`) so the deadline decrement is speed-aware

---

### 4. Implement `completeStage()`, `failStage()`, `declineStage()`

All in `js/scenario.js`:

- [ ] **`completeStage(scenario)`**
  - Add `stage.rewards.revenue` to `state.scenarios.revenue.monthly`
  - Add `stage.rewards.jobs` to a new `state.scenarios.jobs` counter (display in inspector later)
  - Push stage to `scenario.completedStages`, advance `currentStageIndex`
  - If more stages remain: reset `monthsRemaining`, set `status: "ACTIVE"`, emit notices
  - If all stages done: set `status: "COMPLETED"`, emit celebration notice

- [ ] **`failStage(scenario)`**
  - Deduct `penalties.ifFailed.revenue` from `state.funds`
  - Apply `penalties.ifFailed.prestige` (add `state.prestige` field to `state.js` — currently missing)
  - Apply `penalties.ifFailed.populationLoss` to `state.pop`
  - If `renegotiate: true`: set `status: "RENEGOTIATING"`, build `renegotiationOffer` object, trigger renegotiation modal via `requestFlash`
  - If `contractEnds: true`: set `status: "FAILED_CONTRACT_ENDED"`, emit notice

- [ ] **`declineStage(scenario)`**
  - Apply `penalties.ifDeclined` (revenue, prestige, population)
  - Write blacklist entry: `state.scenarios.contractBlacklist[scenario.type] = { until: state.month + penalties.contractBlacklist, reason: "Declined" }`
  - Set `status: "DECLINED"`, push to `acceptanceHistory`
  - Call `showDeclineConsequencesModal(scenario, penalties)` (stubbed in `ui.js` for now)

---

### 5. Add state fields (`state.js`)

- [ ] Add `scenarios: { active: [], completed: [], contractBlacklist: {} }` to the `state` object
- [ ] Add `revenue: { monthly: 0, lost: 0 }` to the `state` object (currently `state.funds` is a one-time balance; `revenue.monthly` gets added to `funds` each `monthlyTick`)
- [ ] Add `prestige: 0` to the `state` object
- [ ] Add `contractLocked: false` to `makeTile()` shape so locked contract tiles can be detected anywhere
- [ ] Update `newGame()` / `resetState()` to zero out `scenarios`, `revenue`, `prestige`

---

### 6. Create scenario blueprints

- [ ] Create `js/scenarios/blueprints.js`
- [ ] Define `export const SCENARIOS = { AI_DATA_CENTRE: { ... } }` with all 3 stages as shown in the config section above
- [ ] Stub out `SHIPPING_CENTRE` and `WILDLIFE_RESERVE` with one placeholder stage each (so the blacklist keys exist)
- [ ] Import `SCENARIOS` in `scenario.js` and `simulation.js`

---

### 7. Build contract UI panel

In `js/ui.js` and `css/ui.css`:

- [ ] Add `<div id="contracts-panel">` to `index.html`, positioned top-left or as a collapsible section of the admin panel
- [ ] Write `syncContractsPanel()` — called from `syncUI()` each frame — that renders one row per active scenario: name, `Stage X/Y`, countdown bar, revenue, `✓/✗` per requirement
- [ ] Add a "CONTRACTS" toggle button to the toolbar / HUD (reuse the existing collapsible section pattern from `initAdminPanel()`)
- [ ] Wire a "Decline" button per row that calls `scenarioManager.declineScenario(id)` after showing confirmation modal
- [ ] Apply existing CSS tokens (`--warn`, `--gold`, `--panel`, spacing scale) — no new token definitions needed

---

### 8. Build inspector integration

In `js/ui.js` `syncInspector()`:

- [ ] When hovered tile has `tile.contractId`, look up the scenario via `scenarioManager.getScenario(tile.contractId)`
- [ ] Replace or extend the inspector's body with: scenario name, stage name, deadline countdown, per-requirement `✓/✗` rows, status badge, pending revenue line
- [ ] Show "DECLINE CONTRACT" and "DETAILS" buttons in the inspector footer (same pattern as existing inspector buttons)

---

### 9. Build modal dialogs

In `js/ui.js`:

- [ ] **Decline confirmation modal** — `showDeclineConsequencesModal(scenario, penalties)`: create and append a `<div class="modal">` with consequence list (revenue lost, prestige, population, blacklist duration); wire "CANCEL" and "DECLINE – I'M SURE" buttons; "I'M SURE" calls `scenarioManager.declineScenario(id)` and removes the modal
- [ ] **Renegotiation offer modal** — `showRenegotiationModal(scenario)`: show old vs. new terms side-by-side; wire "ACCEPT OFFER" (`scenarioManager.acceptRenegotiation(id)`) and "DECLINE & END CONTRACT" buttons
- [ ] Add modal backdrop and CSS (`.modal-backdrop`, `.modal`) to `css/ui.css` using existing design tokens
- [ ] Ensure only one modal can be open at a time (close any existing modal before opening a new one)

---

### 10. Integrate with save/load (`state.js`)

- [ ] In `serializeSave()`: add `scenarios` blob (active array with `id, type, status, currentStageIndex, monthsRemaining, tiles, acceptanceHistory, completedStages`) + `contractBlacklist` + `revenue` + `prestige`
- [ ] In `applySave(save)`: restore `state.scenarios.active` by merging saved data onto the matching blueprint from `SCENARIOS`; restore `contractBlacklist`, `revenue`, `prestige`
- [ ] Guard against missing `save.scenarios` (old save format) — default to empty

---

### 11. Integrate with simulation monthly tick (`simulation.js`)

- [ ] Import `scenarioManager` and `SCENARIOS` from their respective files
- [ ] At the end of `monthlyTick()`, add `state.revenue.monthly` to `state.funds` (recurring income)
- [ ] After the income step, run the random contract-offer logic: if `Math.random() < 0.3` and fewer than 3 active scenarios, pick a non-blacklisted type and call `scenarioManager.addScenario(SCENARIOS[type])`
- [ ] Call `scenarioManager.tick(1)` from `monthlyTick()` (monthly granularity is sufficient; remove the per-frame tick from step 3 unless real-time countdown display is needed — decide which feels better during testing)

---

### 12. Testing

- [ ] **Happy path** — place tiles, meet all requirements before deadline, confirm stage completes, revenue increases, next stage unlocks
- [ ] **Fail → renegotiation** — let deadline expire with unmet requirements, confirm renegotiation modal appears, accept, confirm new deadline and reduced revenue
- [ ] **Decline** — click decline, confirm modal shows correct penalty numbers, confirm blacklist entry is written and persists across save/load
- [ ] **Multiple concurrent scenarios** — trigger two different contract types simultaneously, verify both tick independently and UI shows both
- [ ] **Save/load round-trip** — mid-scenario save, reload, verify `monthsRemaining`, `currentStageIndex`, tile locks, and revenue are all restored correctly
- [ ] **Edge cases** — tile bulldoze attempt on locked tile should be blocked; power plant demolished mid-contract should immediately fail power requirement

---

- [ ] Future: Add full `SHIPPING_CENTRE` blueprint (waterfront placement, road quality, low-skill labor)
- [ ] Future: Add full `WILDLIFE_RESERVE` blueprint (pollution cap, happiness threshold, no-build buffer zone)
- [ ] Future: Dynamic contract generation with randomized deadlines and revenue from templates

---

## Future Extensions

### Dynamic Contract Generation

Instead of pre-written blueprints, generate contracts from templates with random parameters:

```javascript
function generateRandomContract(type) {
  const template = SCENARIO_TEMPLATES[type];
  return {
    ...template,
    stages: template.stages.map(stage => ({
      ...stage,
      monthsUntilDeadline: stage.monthsUntilDeadline + Math.random() * 60 - 30,
      rewards: {
        ...stage.rewards,
        revenue: stage.rewards.revenue * (0.8 + Math.random() * 0.4)
      }
    }))
  };
}
```

### Contract Negotiation

Before accepting, allow counter-offers:

```javascript
function counterOffer(scenario, newRevenue, newDeadline) {
  // Show modal: "They demand 180 months. You offer 240 months at same price?"
  // Company accepts/rejects
  // Updates scenario terms if accepted
}
```

### Competing Contracts

Same company offers same contract simultaneously to multiple cities:

```javascript
scenario.rivalry = {
  rival: "New Harbor City",
  they: "...",
  ourOffer: "...",
  theirOffer: "..."
  // First to complete stage 1 gets all future benefits
}
```

---

## Notes

- **Brutality is the point.** Declining should feel like a loss. Make sure penalties are visible and quantified.
- **Multiple streams.** Design makes it easy to add SHIPPING_CENTRE, WILDLIFE_RESERVE later.
- **Concurrent scenarios.** UI should show all active contracts clearly, especially deadlines.
- **Requirements coupling.** A failed power plant means data centre fails. Systemic dependencies are good drama.
- **Replayability.** Random contract generation + variable deadlines = different playthroughs.

