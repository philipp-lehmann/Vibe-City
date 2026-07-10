# CLAUDE.md — Vibe City

Vanilla JS/HTML/CSS isometric city builder. No build step. ES modules only.

## Running

```bash
npx serve .   # then open localhost:3000
```

### Desktop build (Tauri)

```bash
cd src-tauri
cargo tauri dev     # or: cargo tauri build
```

`tauri.conf.json`'s `frontendDist` points at `src-tauri/dist/` (git-ignored), not the repo root — Tauri
refuses to bundle a frontendDist that itself contains `src-tauri/`/`target/`. `beforeDevCommand`/
`beforeBuildCommand` run `scripts/sync-tauri-dist.sh`, which copies `index.html`, `css/`, `js/`,
`assets/` into `src-tauri/dist/` automatically — no manual step needed, and no compile step, just a copy.

## Architecture

### Module responsibilities

| File | Owns |
|---|---|
| `config.js` | All constants: tile type IDs (`T`), `TOOLS`, `MAP_SIZES`, `FACES`, `MONTHS`, `isZone()` |
| `state.js` | Single mutable `state` object, `tileAt`, `makeTile`, save/load, road mask, `pushNotice`/`requestFlash` |
| `simulation.js` | Monthly tick: RCI demand, power propagation, water coverage, fire, budget, milestones |
| `renderer.js` | Canvas draw loop, isometric projection, bridge/road tile selection, minimap, zoom |
| `input.js` | Mouse + keyboard events, drag placement, terrain paint tools (`TERRAIN_TOOLS`) |
| `ui.js` | **Only module that touches DOM.** Toolbar, HUD sync, inspector, panels, notifications, saves modal |
| `terrain.js` | Procedural terrain generation (simplex noise), coast pass |
| `assets.js` | Sprite asset registry |
| `main.js` | Bootstrap, `requestAnimationFrame` loop |

### State decoupling pattern

Simulation/input never touch DOM. They emit via:
- `pushNotice(msg)` → gray transient notification
- `requestFlash(msg)` → gold transient notification

`syncUI()` in `ui.js` drains both each frame.

### Tile types

Defined in `config.js` as `T.GRASS`, `T.WATER`, `T.ROAD`, `T.POWERLINE`, `T.POWERPLANT`, `T.PUMP`, `T.PARK`, `T.RES`, `T.COM`, `T.IND`, `T.FOREST`, `T.WILDLIFE`.

`T.WILDLIFE` (the "Wildlife" tool) is a freely-placeable natural-land tile,
like `T.PARK`/`T.FOREST` — no upkeep, doesn't conduct power, and unlike every
other tool it's placeable on `TERRAIN.HILL` (the renderer already lifts tile
content correctly for hill/highland via `terrainElev()`, so this needed no
rendering changes — just bypassing the hill block in `placeTool()`). Placing
or bulldozing one never flattens terrain to lowland the way every other tool
does (`preserveTerrain()` in `input.js` copies `terrain`/`elevation`/
`moisture`/`coast` across the tile swap both ways) — this matches
`placeScenario()`'s own long-standing exception for `WILDLIFE_RESERVE`
(natural land is the point of a reserve, not incidental to placing or
clearing one). Placing one also
checks `state.scenarios.active` for an `ACTIVE` `WILDLIFE_RESERVE` contract
(`tagWildlifeTile()` in `input.js`); if found, the tile is tagged with
`contractId`/`contractType`/`contractLocked` exactly like
`ScenarioManager.placeScenario()` does, and its `[x,y]` is pushed onto that
scenario's own `.tiles` array — `js/scenarios/requirements.js`'s validators
(`checkTiles`, `checkPowerAccess`, etc.) read `contract.tiles`, not a live
grid scan, so both are required for the tile to actually count. A tile with
no matching active scenario stays a plain, bulldozable wildlife tile.
Rendering reuses the wildlife scenario sprites (always `stage1`, since a
standalone tile has no contract stage) via `drawWildlife()` in
`renderer.js`, which defers to the existing contract-overlay block whenever
`t.contractId` is set so a contract-tied tile still reflects the real stage.

**Gameplay effects** (`simulation.js`) — a tile counts as "a wildlife area"
for all of these if `t.type===T.WILDLIFE` OR `t.contractType==='WILDLIFE_RESERVE'`
(the latter covers an original contract-acceptance placement batch, which
keeps its underlying tile type and never becomes `T.WILDLIFE`):
- `computeLandValue()` — residential-only land value bonus for nearby
  reserve tiles (`WILDLIFE_LANDVALUE_BONUS`), unlike Park's blanket R/C/I bonus.
- `computeHappiness()` — a small city-wide, diminishing-returns happiness
  bonus per standing reserve tile (`WILDLIFE_HAPPINESS_PER_TILE`/`_CAP`).
- Unlike every other contract type, `contractBlocks()` in `input.js` lets a
  `WILDLIFE_RESERVE`-locked tile be bulldozed (dozer or right-click) same as
  terrain tools/road — but doing so calls `applyWildlifeRemovalPenalty()`:
  an immediate prestige hit plus a fading happiness penalty
  (`state.wildlifeGuilt = {untilMonth, prestigeRefund}`), both automatically
  reversed once `state.month` reaches `untilMonth` (`WILDLIFE_GUILT_MONTHS`)
  — the consequence is real but temporary, not a permanent scar.

### Road / bridge geometry

- `roadAssetKey(t)` — selects sprite from `t.roadMask` (4-bit NESW neighbor mask)
- `bridgeAssetKey(t, gx, gy)` — 1-tile bridges use plain road sprite; ramp/span determined by land-side neighbor count
- `updateRoadsAround(x, y)` — recomputes masks for a tile and its 4 neighbors after placement

## UI panels

All panels use the same design token set from `:root` in `ui.css`.

### Notification centre (`#notif-center`, top-center)

- **Persistent warnings** rebuilt each frame by `syncPersistentWarnings()`: no outside connection, no power plant
- **Transient events** via `addTransientNotif(msg, kind)` — auto-remove after 10s
- `toast(msg)` (exported) → gray city event; `flashStatus(msg)` (internal) → gold action event
- Badge shows total unread count; panel auto-opens on new message

### Admin panel (`#admin-panel`, top-right)

Three independently collapsible sections wired in `initAdminPanel()`:
- **Admin** — tax rate slider (`#taxbox`), Export SVGs button (injected by `buildExportButton()`)
- **Events** — Ignite Fire
- **Help** — keyboard/mouse hints

### Playback panel (`#playback`, bottom-right left of minimap)

- Row 1: `btn-pause` (⏸ Running / ▶ Paused, colored gold/warn) + `btn-speed` (▶▶▶ with inactive spans at 0.25 opacity)
- Row 2: `btn-zoom` (Fit / 1× / 2×)
- Row 3: `btn-rot-l` ⟲ · `#s-face` (N/E/S/W) · `btn-rot-r` ⟳

### Inspector (`#inspector`, bottom-left)

Hidden when `state.hover` is off-grid. Title updates to tile type name. Shows coords, density, power, water, road access, pollution.

### Minimap (`#minimap-wrap`, bottom-right)

Always 120×120px. Overlay strip below in 2-column grid. Overlay modes in `MINI_OVERLAYS` (renderer.js).

## Key patterns

### Adding a new persistent warning

In `syncPersistentWarnings()` (ui.js), push a string to `active[]`. It appears automatically and clears when the condition is gone.

### Adding a new tool

1. Add entry to `TOOLS` in `config.js` with `{ id, label, cost, color }`
2. Handle placement in `input.js` `placeTool()` (single-tile commit branch near the bottom)
3. Add tile type to `T` if needed
4. Add an icon case to `drawToolIcon()` in `renderer.js` (unmatched ids render blank)

### Adding a save field

1. Add to `state` object in `state.js`
2. Add to `serializeSave()` state blob
3. Restore in `applySave()`
4. Reset in `newGame()`

## CSS design tokens

```
--bg, --panel, --panel2          backgrounds
--ink, --ink-dim, --ink-mid      text
--warn (#ff5b3b)                 errors/alerts
--gold (#ffd23f)                 highlights/success
--sp-0 … --sp-9                  spacing scale (2px … 36px)
--font-xs … --font-lg            type scale (10px … 16px)
--radius-sm, --radius-md         border radius
--border-panel, --border, --border-dim  border styles
```

## Isometric rendering

- Tile sprites: 128×104px, bottom-aligned blit
- Screen origin at canvas center + cam offset
- Grid → screen: `sx = (gx - gy) * 64`, `sy = (gx + gy) * 52`
- Rotation applied by remapping grid delta: `rdx = rot===0?dx : rot===1?-dy : rot===2?-dx : dy`
- `state.zoom` is a continuous float (clamped to `[fitScale(), ZOOM_MAX]` via `clampZoom()`
  in renderer.js), used as a plain multiplier everywhere (`isoToScreen`, `blitAsset`, `box()`,
  ...). The mouse wheel drives it continuously and cursor-anchored via `zoomAt(mx, my, factor)`
  (input.js's wheel handler — normalizes trackpad vs wheel-notch deltas and ctrlKey pinch
  gestures into a factor, see the handler's own comment). The playback panel's zoom button
  still cycles three named presets (Fit → 1× → 2×) via `cycleZoom()`; `zoomLevel` (renderer.js)
  is bookkeeping for that button only and is re-synced to the nearest preset after every wheel
  zoom (`syncZoomLevel()`) so the button continues sensibly from wherever the user scrolled to.
- `applyZoomLevel()` (renderer.js) always resets `state.cam` to `{0,0}` when landing on the Fit
  preset (`zoomLevel===0`) — Fit is the one preset that means "see the whole map," so it recenters
  regardless of how panned/off-corner the camera was beforehand. 1×/2× don't touch `state.cam`.

## Input / camera controls

- **Space-to-pan**: holding Space turns any mouse drag into a camera pan instead of whatever the
  selected tool would normally do (`input.js`'s `mousedown`/`mousemove`/`mouseup` short-circuit on
  a module-level `spaceDown`/`panning` flag pair before touching `dragging`/`state.drag`). Cursor
  swaps via CSS classes toggled on `#view` (`ui.css`): `.pan-ready` (grab) while Space is held,
  `.panning` (grabbing) while a pan drag is in flight. Pause was moved off Space (now **P**) to
  free the key up as a pure modifier.
- **Right-click delete indicator**: the single-tile hover frame and the erase-drag preview (right-
  click-drag over road/res/com/ind, `state.drag.erase`) both render red (`isRightClickDelete()` /
  the `state.drag.erase` branch in `drawDragPreview()`, renderer.js) whenever a right-click there
  would actually bulldoze something. `isRightClickDelete()` deliberately duplicates
  `bulldoze()`/`contractBlocks()`'s logic from `input.js` rather than importing it — `input.js`
  already imports from `renderer.js` (`view`/`screenToIso`/`zoomAt`), so the reverse import would
  be circular. Excludes terrain tools (right-click reverts those to lowland, not a delete) and
  placement mode.

## Procedural building asset generation

`scripts/gen-assets/` — standalone Node scripts (no deps) that batch-generate
draft building SVGs, independent of the live canvas renderer / `export_assets.js`
pipeline. Shared engine lives in `scripts/gen-assets/lib/theme-engine.mjs`;
each zone/scenario is a thin *theme* on top of it:

| Script | Covers | Tiers |
|---|---|---|
| `gen-commercial.mjs` | Commercial (`T.COM`) | low / mid / high |
| `gen-residential.mjs` | Residential (`T.RES`) | low / mid / high |
| `gen-industrial.mjs` | Industrial (`T.IND`) | low / mid / high |
| `gen-scenario.mjs` | Contract areas (`js/scenarios/blueprints.js`: AI_DATA_CENTRE, SHIPPING_CENTRE, WILDLIFE_RESERVE) | stage1 / stage2 / stage3 |

```bash
node scripts/gen-assets/gen-commercial.mjs --count=6 --seed=1
node scripts/gen-assets/gen-residential.mjs --count=6 --seed=1
node scripts/gen-assets/gen-industrial.mjs --count=6 --seed=1
node scripts/gen-assets/gen-scenario.mjs --count=6 --seed=1 [--type=datacentre|shippingcentre|wildlife]
```

Output goes to `assets/drafts/<zone>/` (gitignored — these are review
drafts, not shipped assets) as `<zone>_<tier>_{01..N}.svg` plus an
`index.html` contact sheet per folder for quick visual review in a browser.
`gen-scenario.mjs` writes one subfolder per contract type.

Shared algorithm (`theme-engine.mjs`): pick a ground layout first
(recursively splits the tile footprint into 1-4 lots — single tower /
twin / group-of-three / cluster), then build a tower per lot by stacking
2-4 blocks (occasional random setback). Each block's right/left/roof faces
are a plain local `<rect>` wrapped in `<g transform="translate(...)
skewY(±26.565)">` — a native-SVG version of the `commercial_low_c.svg`
sketch's trick (skewY is exactly `atan(HH/HW)` for the 2:1 iso cube, so a
local vertical stays vertical and a local horizontal becomes the correct
roofline-parallel slant; no CSS `transform-origin` needed since translate
+ skew compose directly). The roof/shadow caps use the equivalent
`matrix(1, HH/HW, -1, HH/HW, e, f)` — `bp(u,v,h)` written as an affine
matrix — on a rect placed directly in (u,v) footprint space. Window lines
(6-8 per wall, equally spaced, then 0-3 trimmed off each side
independently, inset from the wall's own edges) share one color/weight/
dash style per wall. Canvas height is computed from the actual generated
silhouette (no fixed crop, no clipping).

Each theme supplies its own palette + decorations rather than just a
recolor: commercial is a purple family with antenna/rooftop-utility-box;
residential is a muted olive-green with amber window glow and a chimney
(low density) or rooftop water tank (high density); industrial is a
dirtier yellow-brown/rust family with 1-3 rooftop smokestacks and squatter,
rarely-stepped proportions; the three scenario themes are the most
distinct — data centre is cool pale-gray with blinking orange status
lights and orange window glow (both matching `contract_datacentre.svg`'s
accent color), shipping centre is a brick-orange "container" family
matching `contract_shippingcentre.svg` (with an occasional off-hue block
mixed in), bold pale stripe windows and a crane decoration, wildlife
reserve is a humble green lodge (mostly single-footprint, no windows) with
a tree, scattered grey stones, and sometimes a small pond.

**Live in the game.** All three zones and all three scenario themes are
wired in (not just drafts):

- `assets/buildings/{zone}_{density}_{variant}.svg` — `variant` is a full
  `a`-`f` (6, up from the old 3). `assets.js`'s `VARIANTS` list and
  `renderer.js`'s `buildingAssetKey()` (`tileSeed(gx,gy)%6`) both know
  about all 6; a zoned tile picks one the same way it always did.
- `assets/scenario/{type}_{stage}_{variant}.svg` (`type` = `datacentre` /
  `shippingcentre` / `wildlife`, `stage` = `stage1`/`2`/`3` matching the
  contract's `currentStageIndex`) — new folder + manifest group in
  `assets.js`. `renderer.js`'s `scenarioAssetKey()` picks a variant per
  *tile* the same way `buildingAssetKey()` does, so a multi-tile contract
  area reads as several distinct buildings rather than one repeated
  sprite or a flat color. The flat `contract_*.svg` diamond is now only a
  fallback for a tile whose sprite fails to load.

To regenerate and re-promote: re-run the relevant `gen-*.mjs` script
(writes to `assets/drafts/...`), review the contact sheet, then copy the
chosen files into `assets/buildings/` or `assets/scenario/` with the
`_a.svg`.. `_f.svg` naming (see `scripts/gen-assets/` — the drafts are
numbered `_01`.. `_06`, so they need renaming on promotion).
