# Implementation prompt — Scenario Mode rework

Paste this whole file as the instruction to the coding session that implements the feature.

## Summary

Split the game into two modes, chosen at city creation:

- **Free Play** — sandbox, no contract system at all.
- **Scenario Mode** — RCI demand collapses past 15k population; the only way to keep growing is to activate contracts, which the player now picks themselves from a dialog in the status bar instead of receiving as random RNG offers.

This builds on the existing contract system in `scenario.js` / `scenarios/blueprints.js` / `scenarios/requirements.js` — the OFFERED → PLACEMENT → ACTIVE → COMPLETED lifecycle and its modals stay. What changes is **who triggers a contract** (player, not RNG) and **what contracts are for** (relieving a demand penalty, not just a side revenue stream), gated behind a new game mode.

## 1. New Game dialog — add mode picker

`js/ui.js`, `buildSizeModal()` (~line 552 onward).

Add a mode selector to the "New City" modal, above or below the Map Size row:

```
<div class="modal-field">
  <label>Mode</label>
  <div id="mode-row"></div>
</div>
```

Two cards, same `.size-card` styling as the size/water pickers: **Free Play** and **Scenario Mode**. Add a one-line description under each card's label (reuse `.size-dim` styling), e.g.:
- Free Play — "Sandbox. No contracts."
- Scenario Mode — "Demand caps at 15k pop. Contracts unlock growth."

Track selection in a module-level `pickedMode = 'freeplay'` (default), mirroring `pickedSize`/`pickedWater`. Add `highlightMode()` alongside `highlightSize()`/`highlightWater()`, called from the same places (`buildSizeModal`'s card `onclick`, and `doNewGame()` on modal open).

`size-confirm` handler passes the mode through:

```js
newGame(name, pickedSize, WATER_LEVELS[pickedWater].pct, pickedMode);
```

`doNewGame()` should reset `pickedMode = 'freeplay'` and re-highlight each time the modal opens (same pattern as size/water), so mode doesn't leak from a previous new-game flow.

## 2. `state.js` — persist the mode

- `newGame(name, sizeKey, waterPct, mode)` (~line 340): add `state.mode = mode === 'scenario' ? 'scenario' : 'freeplay';` near the other resets.
- Add `state.mode = 'freeplay'` to whatever baseline/initial state object exists before `newGame` is first called (so old saves without the field don't crash on load).
- **Save field** (follow the "Adding a save field" pattern in `CLAUDE.md`):
  1. Add `mode` to the `state` object (done above).
  2. Add `mode: state.mode` to `serializeSave()`'s state blob.
  3. Restore it in `applySave()`: `state.mode = saved.mode || 'freeplay';` (defaults old saves to Free Play so nothing retroactively locks demand).
  4. Already reset in `newGame()` per above.

## 3. `config.js` — tuning constants

Add near the other top-level constants:

```js
export const SCENARIO_DEMAND_CAP_POP = 15000;   // population above which the penalty kicks in
export const SCENARIO_DEMAND_PENALTY_SCALE = 30000; // "meters" the overage against — larger = gentler curve
export const SCENARIO_DEMAND_PENALTY_MAX = 0.9; // hard ceiling so demand never goes fully to zero/negative-only from this alone
```

(Names/values are a starting point — tune by playtesting. The formula that uses them is in §4.)

## 4. `simulation.js` — demand penalty + gating the old RNG offers

### 4a. Demand penalty (in `updateDemand()`, ~line 355)

Only applies when `state.mode === 'scenario'`. Chosen mechanic (per design decision): **the penalty scales with how far population is past the 15k threshold**, regardless of how many contracts are active. Contracts don't cancel the multiplier — each active contract stage adds a flat demand bonus on top, so multiple contracts stack additively to outrun the penalty.

```js
export function updateDemand(resPop, resJobPop, comCap, indCap){
  // ...existing dR/dC/dI calculation stays as-is...

  // SCENARIO MODE: demand collapses past 15k pop unless offset by active contracts
  if (state.mode === 'scenario') {
    const overage = Math.max(0, state.pop - SCENARIO_DEMAND_CAP_POP);
    const penalty = Math.min(
      SCENARIO_DEMAND_PENALTY_MAX,
      overage / SCENARIO_DEMAND_PENALTY_SCALE
    );
    const boost = scenarioManager.getActiveDemandBoost(); // sum of active stages' rewards.demandBoost, see §6
    dR = dR * (1 - penalty) + boost;
    dC = dC * (1 - penalty) + boost;
    dI = dI * (1 - penalty) + boost;
  }

  // ...existing lerp/clamp into state.demand stays as-is...
}
```

Import `scenarioManager` and the three new constants at the top of `simulation.js` (it already imports `scenarioManager, SCENARIOS` from `./scenario.js`).

### 4b. Retire the RNG auto-offer in favor of player choice

The existing block (~line 314–334) that randomly calls `scenarioManager.addScenario(bp)` at a 3% monthly chance must be:

- **Removed entirely in Scenario Mode** — contracts are now player-initiated only (§5/§6), never auto-offered.
- **Removed entirely in Free Play** — Free Play has no contract system at all per the product decision.

Net effect: delete/disable that whole `if (state.revenue.monthly >= 0 && ...)` block. `scenarioManager.tick(1)` still runs every month (it just ticks whatever the player has actively chosen to activate) but should itself no-op gracefully when `state.mode !== 'scenario'` — cheapest is to guard the call site:

```js
if (state.mode === 'scenario') scenarioManager.tick(1);
```

`state.funds += state.revenue.monthly;` stays unconditional (harmless at 0 in Free Play / when nothing is active).

## 5. `scenario.js` — player-initiated activation replaces the offer queue

The OFFERED → PLACEMENT → ACTIVE flow (accept, decline, placement, renegotiation) is all reusable as-is — keep `acceptOffer`, `declineOffer`, `cancelPlacement`, `confirmPlacement`, `declineScenario`, `acceptRenegotiation`, `rejectRenegotiation`, `completeStage`, `failStage`, `declineStage` unchanged.

What needs to change is **how a scenario enters the OFFERED state** — today only `addScenario()` (called by the RNG block we just removed) does that. Add a method the new status-bar dialog can call directly:

```js
/**
 * Player-initiated activation (Scenario Mode). Same as addScenario() but
 * called directly from the contracts dialog instead of the RNG offer loop.
 * Returns null if blacklisted, already active, or already OFFERED/PLACEMENT.
 */
activateContract(type) {
  const blueprint = SCENARIOS[type];
  if (!blueprint) return null;
  if (this.activeScenarios.some(s => s.type === type)) return null; // one per type at a time, existing rule
  return this.addScenario(blueprint); // existing method — pushes to pendingOffers, UI shows the existing offer modal
}
```

This keeps the existing "Contract offer" modal (`js/ui.js` ~line 875, "Requirements / Rewards on completion / Effects if declined") as the acceptance step — the dialog just lets the player choose *which* blueprint to bring up that modal for, instead of the RNG doing it.

### 6. New method: sum of active demand boosts

Add alongside `getContractStatus()`:

```js
/** Sum of rewards.demandBoost across all currently-ACTIVE contract stages. */
getActiveDemandBoost() {
  return this.activeScenarios
    .filter(s => s.status === 'ACTIVE')
    .reduce((sum, s) => sum + (s.currentStage.rewards.demandBoost || 0), 0);
}
```

### 7. `scenarios/blueprints.js` — add `demandBoost` to stage rewards

Add a `demandBoost` number (applied additively to R/C/I demand per §4a) to each stage's `rewards` block. Suggested starting values — tune by playtesting, but the intent is: a single active early-game contract should meaningfully dent the penalty at ~15-20k pop, and a fully-loaded stage-3 contract should nearly cancel it out on its own:

- `AI_DATA_CENTRE` stage 1: `demandBoost: 0.12`, stage 2: `0.18`, stage 3: `0.25`
- `SHIPPING_CENTRE` stage 1: `demandBoost: 0.15`
- `WILDLIFE_RESERVE` stage 1: `demandBoost: 0.08`, stage 2: `0.10`

(Wildlife Reserve is lower since it's flavored as conservation, not an economic engine — keep it a supporting contract, not a primary demand fix.)

## 8. `js/ui.js` — status bar contracts dialog

### 8a. Gate the existing contracts panel to Scenario Mode only

`syncContractsPanel()` (~line 687) and anything that shows contract-related UI (persistent warnings, panel visibility) should check `state.mode === 'scenario'` and render nothing / hide the panel entirely in Free Play. Also confirm the panel's container in `index.html`/CSS collapses cleanly to zero height when empty (it likely already does via `panel.innerHTML = ''` at line ~703 — extend that early-return to also fire when `state.mode !== 'scenario'`).

### 8b. New "Contracts" status-bar button + activation dialog

Add a status-bar button (only rendered/visible when `state.mode === 'scenario'`) that opens a new modal — call it the **contracts dialog** — listing every entry in `SCENARIOS` with:

- Name (reuse the `type.replace(/_/g, ' ')` formatting already used elsewhere)
- Current state: **Available** / **Active** (with stage progress, reuse `getContractStatus()` data) / **Blacklisted until month N** (reuse `state.scenarios.contractBlacklist`)
- An **Activate** button, enabled only when the type is not already active and not currently blacklisted. Wired to `scenarioManager.activateContract(type)`.
- For already-ACTIVE entries, no Activate button — instead a **Deactivate** button that reuses the existing decline flow: call the same `showDeclineModal(scenario.id)` used by the "CANCEL CONTRACT" button in the current contracts panel (~line 764/798), which already shows the established `ifDeclined` consequences and confirmation UI before calling `scenarioManager.declineScenario(id)`.

This dialog is purely a picker/launcher — it does not replace the existing per-contract cards in the contracts panel (§8a), which continue to show live progress for anything ACTIVE/PLACEMENT. Follow the existing modal-building pattern (build once, toggle `display`, `_contractsDialog` singleton) used by `buildSavesModal()`/`sizeModal`/`_contractModal`.

### 8c. Persistent warning (optional but recommended)

In `syncPersistentWarnings()`, when `state.mode === 'scenario'` and `state.pop > SCENARIO_DEMAND_CAP_POP` and `scenarioManager.getActiveDemandBoost() === 0`, push a warning like `"Demand stalling above 15k pop — activate a contract to keep growing."` Clears automatically once any contract goes ACTIVE, per the existing pattern in `CLAUDE.md` ("Adding a new persistent warning").

## 9. Edge cases to handle

- **Mode switch mid-game**: not supported — mode is fixed at city creation (`newGame`) and only changes via starting a new city or loading a save with a different `mode`. No UI to change it later.
- **Old saves without `state.mode`**: default to `'freeplay'` on load (§2) so existing saves keep their current behavior — no surprise demand cliff for players mid-save.
- **Declining/cancelling while in PLACEMENT**: unchanged, already handled by `cancelPlacement()`.
- **Blacklist**: unchanged — a type declined from the dialog still respects `contractBlacklist` and the dialog should show the remaining blacklist duration rather than a disabled-with-no-explanation Activate button.
- **`getActiveDemandBoost()` during RENEGOTIATING/OFFERED/PLACEMENT**: excluded — only `ACTIVE` counts, matching "activate a contract to keep growing" (renegotiating/placement isn't yet delivering).

## 10. Acceptance checklist

- New City modal shows a Mode picker; Free Play is the default; selection is passed into `newGame()` and persists via save/load.
- Free Play: no contract offers ever appear (RNG block removed/gated), contracts panel and contracts status-bar button are absent, demand behaves exactly as it does today at any population.
- Scenario Mode: demand visibly flattens/declines as population passes 15k with zero active contracts, and recovers as contracts are activated — verify by watching `state.demand` at, e.g., 20k pop with 0 vs. 1 vs. 2 active contracts.
- Scenario Mode: status-bar Contracts button opens a dialog listing all `SCENARIOS` entries with correct Available/Active/Blacklisted state; Activate opens the existing offer modal; accepting flows into the existing placement mode unchanged.
- Deactivating an Active contract from the dialog shows the existing decline-consequences modal and applies the same `ifDeclined` penalties as the old in-panel CANCEL CONTRACT button.
- Loading a pre-existing save (no `mode` field) defaults to Free Play and doesn't crash.
