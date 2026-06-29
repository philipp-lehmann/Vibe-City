# App icons

Tauri's bundlers (NSIS, DMG, deb, AppImage) all read their icons from this
folder. Nothing here is generated yet — before the first `cargo tauri build`
or CI run, do this once:

1. Drop a square **1024×1024** PNG at `icons/source.png` (transparent
   background recommended).
2. Run `bash scripts/generate_icons.sh`.

That produces:

- `32x32.png`, `128x128.png`, `256x256.png`, `512x512.png`
- `128x128@2x.png` (retina alias of the 256px PNG)
- `icon.ico` (Windows, multi-resolution)
- `icon.icns` (macOS — only generated on macOS via `iconutil`, or on Linux
  via `icnsutils`' `png2icns`)

Commit the generated files. `source.png` itself doesn't need to be committed,
but there's no harm in keeping it around for regenerating icons later.

Without these files, `cargo tauri build` fails immediately — Tauri validates
`bundle.icon` paths in `src-tauri/tauri.conf.json` at build time.
