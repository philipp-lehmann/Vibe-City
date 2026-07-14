# Vibe City — itch.io page copy

Paste these into the itch page editor. Sections map to itch's own fields (title / short description / description body / etc).

---

## Title

Vibe City

## Short description (itch tagline, ~120 chars)

A retro-terminal isometric city builder. Zone it, wire it, water it, watch the phosphor glow.

## Genre / Classification

- Genre: Simulation
- Tags: city-builder, isometric, simulation, sandbox, management, retro, singleplayer, desktop
- Kind of project: Downloadable
- Release status: In development
- Pricing: Free, donations welcome ("$0 or set a price" / pay-what-you-want on itch)
- Platforms: Windows, macOS, Linux

---

## Description (main body)

**Boot up a city on a green‑phosphor grid.**

Vibe City is an isometric city builder with a CRT terminal soul — scanlines, amber warnings, a monospace HUD, and a simulation underneath that actually pushes back. Zone residential, commercial, and industrial land, thread power lines out from your plant, keep the water pumps fed, and watch the RCI demand meters tell you what your city actually wants next.

It's not just paint-by-numbers zoning. Power has to physically propagate down the grid. Water coverage depends on road access. Fires happen. Land value responds to what you build near it. Contracts roll in for AI data centres, shipping hubs, and wildlife reserves — each with its own multi-stage buildout and its own consequences if you tear one down early. Terrain is procedurally generated per city, with hills, wetlands, and coastline that actually shapes where you can build and how.

**This is early access.** Vibe City is under active development — expect rough edges, missing polish, and features still being tuned. Save format may change between versions (see Known Issues below for how to protect your saves).

### Features

- Isometric rendering with 4-direction rotation and smooth zoom
- RCI demand simulation (Residential / Commercial / Industrial) with a tax rate you control
- Power grid propagation from plant to power line to zone — no power line, no power
- Water pump coverage gated on road access
- Procedural terrain per city — elevation, moisture, wetlands, coasts, hills
- Bridges with proper ramp/span geometry over water
- Scenario contracts: AI Data Centre, Shipping Centre, Wildlife Reserve — each with staged buildouts and real consequences for bulldozing early
- Fire disaster tool, population milestones, land value & pollution modeling
- Minimap with power / water / land value / fire overlay modes
- Autosave plus 6 manual save slots, with Export/Import City to back up a save as a portable file

### Controls

| Input | Action |
|---|---|
| Left-click / drag | Place selected tile |
| Right-click / drag | Bulldoze |
| Scroll wheel | Zoom in/out |
| Q / E | Rotate view |
| P | Pause / resume |
| Space (hold) + drag | Pan camera |

---

## System requirements

- **Windows** — Windows 10 or 11, 64-bit
- **macOS** — macOS 12 (Monterey) or later. Universal binary, runs natively on Apple Silicon and Intel.
- **Linux** — `.deb` or `.AppImage`; requires `webkit2gtk` (already present on most desktop distros)

No account, no internet connection required to play. (First launch briefly reaches out for a web font — see Known Issues.)

---

## Known issues / disclaimers

**Unsigned builds — your OS will warn you on first launch.** Code signing isn't set up yet for Windows or macOS, so:

- **Windows:** SmartScreen will say "Windows protected your PC." Click **More info → Run anyway**.
- **macOS:** Gatekeeper will refuse to open the app the normal way. Right-click (or Control-click) the app → **Open** → confirm. If that doesn't work, go to **System Settings → Privacy & Security** and click **Open Anyway** next to the Vibe City block.

This is expected for an unsigned indie build, not a sign anything's wrong.

**Saves are local and may not survive version updates.** Vibe City stores saves on your machine. Because this is an early-access build with the save format still evolving, use the in-game **Export City** button periodically to back up a save as a portable file, and **Import City** to restore it if a future update isn't backward-compatible.

**Requires an internet connection on first launch** to load a web font (JetBrains Mono via Google Fonts). If you're fully offline, the UI will fall back to a system monospace font — everything still works.

---

## Credits

Built by Philipp / Redefine Studio. Claude Code assisted with implementation — simulation logic, the procedural building/asset generators, and the desktop packaging.

---

## Suggested cover image / screenshots

- Cover (630×500): a zoomed isometric shot with a few zoned districts, power lines visible, HUD showing — `docs/image-2.png` is a starting point but is not itch's exact cover ratio, so crop/re-export before using.
- Screenshots: pull 3–5 more from `docs/thumb-*.png` (commercial/residential/industrial/shipping/datacentre/wildlife) to show building variety, plus one of the minimap overlays and one of the notification/inspector panels in action.
