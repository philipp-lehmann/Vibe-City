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

Defined in `config.js` as `T.GRASS`, `T.WATER`, `T.ROAD`, `T.POWERLINE`, `T.POWERPLANT`, `T.PUMP`, `T.PARK`, `T.RES`, `T.COM`, `T.IND`.

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
2. Handle placement in `input.js` `commitTile()`
3. Add tile type to `T` if needed

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
- Two zoom levels via `cycleZoom()` (renderer.js): Fit → 1× → 2×
