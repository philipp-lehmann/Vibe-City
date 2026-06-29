# MICROPOLIS // CRT City Builder

![Micropolis](docs/image-2.png)

A browser-based isometric city builder with a retro CRT aesthetic. Built with vanilla JavaScript ES modules — no build step required.

## Running

Serve the project root over HTTP (required for ES modules):

```bash
npx serve .
# or
python3 -m http.server
```

Then open `http://localhost:3000` (or whichever port your server uses).

Opening `index.html` directly as a `file://` URL will not work due to module CORS restrictions.

## Controls

| Input | Action |
|---|---|
| Left-click / drag | Place selected tile |
| Right-click / drag | Bulldoze |
| Scroll wheel | Zoom in/out |
| Q / E | Rotate view |
| Space | Pause / resume |

## UI Layout

```
┌─────────────────────────────────────────────────────────┐
│ statusbar: saves · new · city name · date · pop · funds │
├──────────┬──────────────────────────────┬───────────────┤
│ toolbar  │   notification centre        │  admin panel  │
│ (tools + │   (collapsible, top-center)  │  Admin        │
│  terrain)│                              │  Events       │
│          │                              │  Help         │
│ demand   │                              │               │
│ bars     │         canvas               │               │
│          │                              │               │
│ inspector│                              │               │
│ (on hover│                              │               │
│  bottom- │                              │               │
│  left)   │          ┌──────────┐ ┌────┐│               │
│          │          │ playback │ │map ││               │
└──────────┴──────────┴──────────┴─┴────┘┴───────────────┘
```

**Playback panel** (bottom-right, left of minimap): pause/running toggle, speed (▶▶▶ with inactive dims), zoom, rotate with compass direction.

**Admin panel** (top-right, collapsible sections):
- *Admin* — tax rate slider
- *Events* — ignite fire disaster
- *Help* — keyboard/mouse reference

**Notification centre** (top-center, collapsible): persistent warnings (no outside connection, no power plant) + transient city events (fires, milestones, budget alerts). Auto-opens on new messages; badge shows unread count.

## Project structure

```
index.html          entry point & static UI layout
css/
  ui.css            all styles (CRT/scanline theme, design tokens)
js/
  config.js         constants, tile IDs, tool catalogue, map sizes
  state.js          mutable game state, save/load, road mask logic
  simulation.js     monthly tick — RCI demand, budgets, power/water propagation
  terrain.js        procedural terrain generation & elevation tools
  renderer.js       isometric canvas renderer, minimap, bridge geometry
  input.js          mouse & keyboard handling, drag placement, terrain tools
  ui.js             toolbar, inspector, minimap strip, HUD sync, panels
  main.js           bootstrap & game loop
  assets.js         sprite asset registry
  export_assets.js  SVG asset export utility
```

## Map sizes

| Size | Grid |
|---|---|
| Small | 32×32 |
| Medium | 64×64 |
| Large | 128×128 |

## Features

- Isometric rendering with 4-direction rotation (N/E/S/W) and variable zoom
- RCI demand system (Residential / Commercial / Industrial) with tax rate control
- Power grid propagation from coal plants via power lines
- Water pump coverage with road-access requirement
- Procedural terrain — elevation, moisture, wetlands, coasts, hills
- Bridges over water with ramp/span geometry
- Population milestone notifications (10k / 50k / 100k), persisted per city
- Collapsible notification centre with persistent warnings and transient events
- Tile inspector — shows type, power, water, road access, pollution on hover
- Minimap with overlay modes (normal, power, water, land value, fire)
- Autosave + 6 manual save slots to `localStorage`
- Fire disaster tool
- SVG asset export
