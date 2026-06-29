#!/usr/bin/env bash
set -euo pipefail

# generate_icons.sh — generate all Tauri app icons from one 1024x1024 source PNG.
#
# Usage:   bash scripts/generate_icons.sh
# Input:   icons/source.png   (1024x1024, square; transparent background recommended)
# Output:  icons/32x32.png, icons/128x128.png, icons/256x256.png, icons/512x512.png,
#          icons/128x128@2x.png, icons/icon.ico, icons/icon.icns
#
# Install per OS:
#   macOS:   brew install imagemagick          (iconutil ships with macOS, used for .icns)
#   Linux:   sudo apt install imagemagick icnsutils   (icnsutils provides png2icns)
#   Windows: choco install imagemagick — run this script under Git Bash or WSL.
#            .icns can only be built on macOS (iconutil) or Linux (png2icns);
#            on Windows that step is skipped — generate icon.icns on macOS/Linux
#            once and commit it, since it's only needed for the macOS bundle.

SOURCE="icons/source.png"
OUT_DIR="icons"

if [[ ! -f "$SOURCE" ]]; then
  echo "error: $SOURCE not found." >&2
  echo "       Add a 1024x1024 PNG at $SOURCE and re-run this script." >&2
  exit 1
fi

if ! command -v convert >/dev/null 2>&1; then
  echo "error: ImageMagick 'convert' not found. See install notes at the top of this script." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Resize and force 32-bit RGBA output. ImageMagick writes opaque sources as
# TrueColor (no alpha channel) by default, but Tauri's icon loader rejects
# that ("icon ... is not RGBA") — png:color-type=6 forces RGBA regardless of
# whether the source has transparency.
png_resize() {
  local size="$1" dest="$2"
  convert "$SOURCE" -resize "${size}x${size}" -background none -alpha on \
    -define png:color-type=6 "$dest"
}

echo "==> Generating PNG sizes (32, 128, 256, 512)"
for size in 32 128 256 512; do
  png_resize "$size" "$OUT_DIR/${size}x${size}.png"
done

# Tauri/macOS retina convention: 128x128@2x.png is the 256px image under that name.
cp "$OUT_DIR/256x256.png" "$OUT_DIR/128x128@2x.png"

echo "==> Generating icons/icon.ico (multi-resolution Windows icon)"
png_resize 16 "$TMP_DIR/16.png"
png_resize 48 "$TMP_DIR/48.png"
convert "$TMP_DIR/16.png" "$OUT_DIR/32x32.png" "$TMP_DIR/48.png" "$OUT_DIR/256x256.png" \
  "$OUT_DIR/icon.ico"

echo "==> Generating icons/icon.icns (macOS)"
if command -v iconutil >/dev/null 2>&1; then
  ICONSET="$TMP_DIR/icon.iconset"
  mkdir -p "$ICONSET"
  png_resize 16   "$ICONSET/icon_16x16.png"
  png_resize 32   "$ICONSET/icon_16x16@2x.png"
  png_resize 32   "$ICONSET/icon_32x32.png"
  png_resize 64   "$ICONSET/icon_32x32@2x.png"
  png_resize 128  "$ICONSET/icon_128x128.png"
  png_resize 256  "$ICONSET/icon_128x128@2x.png"
  png_resize 256  "$ICONSET/icon_256x256.png"
  png_resize 512  "$ICONSET/icon_256x256@2x.png"
  png_resize 512  "$ICONSET/icon_512x512.png"
  png_resize 1024 "$ICONSET/icon_512x512@2x.png"
  iconutil -c icns "$ICONSET" -o "$OUT_DIR/icon.icns"
elif command -v png2icns >/dev/null 2>&1; then
  png_resize 16  "$TMP_DIR/icns16.png"
  png_resize 32  "$TMP_DIR/icns32.png"
  png_resize 128 "$TMP_DIR/icns128.png"
  png_resize 256 "$TMP_DIR/icns256.png"
  png_resize 512 "$TMP_DIR/icns512.png"
  png2icns "$OUT_DIR/icon.icns" "$TMP_DIR/icns16.png" "$TMP_DIR/icns32.png" \
    "$TMP_DIR/icns128.png" "$TMP_DIR/icns256.png" "$TMP_DIR/icns512.png"
else
  echo "warning: neither 'iconutil' (macOS) nor 'png2icns' (Linux icnsutils) found." >&2
  echo "         icons/icon.icns was NOT generated. Run this script on macOS, or" >&2
  echo "         install icnsutils on Linux (sudo apt install icnsutils)." >&2
fi

echo "==> Done. Icons written to $OUT_DIR/"
