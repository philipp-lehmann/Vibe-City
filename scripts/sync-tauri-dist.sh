#!/usr/bin/env bash
# Copies the web app's static assets into src-tauri/dist/, the folder
# tauri.conf.json > build > frontendDist points at.
#
# Why this exists: Tauri refuses to bundle a frontendDist that itself
# contains the src-tauri/ or target/ folders — it errors with "The
# configured frontendDist includes the [...] folders. Please isolate
# your web assets on a separate folder." Vibe City's web source (index.html,
# css/, js/, assets/) lives flat in the repo root (see CLAUDE.md — no build
# step), in the same folder as src-tauri/, so frontendDist can't point at
# the repo root directly. This script copies just what the browser needs
# into an isolated, git-ignored folder instead. It's a plain copy, not a
# compile step, run automatically by Tauri's beforeDevCommand/beforeBuildCommand.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/src-tauri/dist"

rm -rf "$DIST"
mkdir -p "$DIST"

cp "$ROOT/index.html" "$DIST/"
cp -R "$ROOT/css"    "$DIST/css"
cp -R "$ROOT/js"     "$DIST/js"
cp -R "$ROOT/assets" "$DIST/assets"

echo "Synced web assets to $DIST"
