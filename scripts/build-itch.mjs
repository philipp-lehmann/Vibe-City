#!/usr/bin/env node
// scripts/build-itch.mjs
//
// Packages the web app (index.html, css/, js/, assets/) into a zip ready to
// upload to itch.io as an HTML5 embed. Standalone script, no dependencies —
// same convention as scripts/gen-assets/, run directly with `node`.
//
// Why not just zip the repo root: assets/drafts/ (gitignored review drafts
// from scripts/gen-assets/, can be 1MB+ of throwaway SVGs) and everything
// Tauri/Node-only (src-tauri/, scripts/, docs/, CLAUDE.md, README.md, .git)
// have no business shipping to players, and itch's HTML5 embed requires
// index.html to sit at the *root* of the zip, not nested under a folder —
// so this stages a clean copy first rather than trying to zip selectively
// in place. Mirrors what scripts/sync-tauri-dist.sh does for the Tauri
// build, just for a different target (a zip, not a live dev folder), and
// with assets/drafts/ actually excluded (sync-tauri-dist.sh copies assets/
// wholesale since it's git-ignored either way and never leaves the dev's
// machine, but a public itch upload shouldn't carry draft art).
//
// Usage: node scripts/build-itch.mjs
// Output: build/vibe-city-web-vX.Y.Z.zip (build/ is git-ignored)

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'build');
const DRAFTS_DIR = path.join(ROOT, 'assets', 'drafts');

// Stage and zip in a real tmp directory rather than under the repo — `zip`
// writes its output via a temp-file-then-rename, which some synced/mounted
// project folders (e.g. cloud-synced drives, some sandboxed dev
// environments) don't allow. Building in os.tmpdir() sidesteps that
// entirely; only the single finished zip gets copied into the repo's
// build/ at the end.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-city-itch-'));
const STAGE = path.join(TMP, 'itch-web');

function readVersion() {
  // tauri.conf.json deliberately omits "version" and reads it from
  // src-tauri/Cargo.toml (see that file's own comment) — reuse the same
  // source of truth here so the web build and desktop builds stay in step.
  try {
    const cargoToml = fs.readFileSync(path.join(ROOT, 'src-tauri', 'Cargo.toml'), 'utf8');
    const m = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);
    if (m) return m[1];
  } catch { /* fall through to default below */ }
  return '0.0.0';
}

function skipJunk(src) {
  if (src === DRAFTS_DIR || src.startsWith(DRAFTS_DIR + path.sep)) return false;
  if (path.basename(src) === '.DS_Store') return false;
  return true;
}

const version = readVersion();
const zipName = `vibe-city-web-v${version}.zip`;
const tmpZipPath = path.join(TMP, zipName);
const finalZipPath = path.join(OUT_DIR, zipName);

fs.mkdirSync(STAGE, { recursive: true });

fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(STAGE, 'index.html'));
fs.cpSync(path.join(ROOT, 'css'), path.join(STAGE, 'css'), { recursive: true, filter: skipJunk });
fs.cpSync(path.join(ROOT, 'js'), path.join(STAGE, 'js'), { recursive: true, filter: skipJunk });
fs.cpSync(path.join(ROOT, 'assets'), path.join(STAGE, 'assets'), { recursive: true, filter: skipJunk });

try {
  // Run from inside STAGE and name entries explicitly so the archive has
  // index.html etc. at its root, not staged/index.html — itch's HTML5
  // embed refuses to launch otherwise.
  execFileSync('zip', ['-r', '-q', tmpZipPath, 'index.html', 'css', 'js', 'assets'], { cwd: STAGE, stdio: 'inherit' });
} catch (err) {
  console.error('\nFailed to run `zip` — install it (e.g. `apt install zip` / `brew install zip`) and re-run.');
  throw err;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.copyFileSync(tmpZipPath, finalZipPath);   // copy, not rename — see TMP comment above
fs.rmSync(TMP, { recursive: true, force: true });

const { size } = fs.statSync(finalZipPath);
console.log(`\nBuilt ${zipName} (${(size / 1024 / 1024).toFixed(2)} MB) → ${path.relative(ROOT, finalZipPath)}`);
console.log('Upload this zip to itch as-is: index.html sits at the archive root, which itch\'s HTML5 embed requires.');
