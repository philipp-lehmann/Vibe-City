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

## Project structure

```
index.html          entry point & UI layout
css/
  ui.css            all styles (CRT/scanline theme)
js/
  config.js         constants, tile IDs, tool catalogue
  state.js          mutable game state
  simulation.js     monthly tick — RCI demand, budgets, power/water
  terrain.js        terrain generation & elevation tools
  renderer.js       isometric canvas renderer
  input.js          mouse & keyboard handling
  ui.js             toolbar, inspector, minimap, status bar
  main.js           bootstrap & game loop
```

## Map sizes

| Size | Grid | Notes |
|---|---|---|
| Small | 32×32 | Default |
| Medium | 64×64 | |

## Features

- Isometric rendering with 4-direction rotation and variable zoom
- RCI demand system (Residential / Commercial / Industrial)
- Power grid propagation and water pump coverage
- Terrain elevation with bridges
- Tax rate slider and monthly budget simulation
- Fire disaster tool
- Land value and water overlay views
- Minimap
- Autosave to `localStorage`
