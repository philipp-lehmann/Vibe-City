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

- [ ] Create `ScenarioManager` class
- [ ] Implement `checkAllRequirements()`
- [ ] Wire `tick()` into main loop
- [ ] Implement `completeStage()`, `failStage()`, `declineStage()`
- [ ] Add requirement validators (power, water, road, labor, happiness)
- [ ] Create scenario blueprints for AI_DATA_CENTRE
- [ ] Build contract UI panel
- [ ] Build inspector integration
- [ ] Build modal dialogs (decline, renegotiation)
- [ ] Integrate with save/load
- [ ] Integrate with simulation monthly tick
- [ ] Test: accept → complete → next stage
- [ ] Test: fail deadline → renegotiation flow
- [ ] Test: decline → blacklist + penalties
- [ ] Test: multiple concurrent scenarios
- [ ] Future: Add SHIPPING_CENTRE blueprint
- [ ] Future: Add WILDLIFE_RESERVE blueprint

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

