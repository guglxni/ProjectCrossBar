#!/usr/bin/env bash
# Render all docs/diagrams/*.drawio sources to 2× PNG rasters for GitHub.
# Requires: draw.io desktop CLI (brew install --cask drawio)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/docs/diagrams"

if ! command -v drawio >/dev/null 2>&1; then
  echo "error: drawio CLI not found. Install: brew install --cask drawio" >&2
  exit 1
fi

echo "drawio $(drawio --version 2>/dev/null | head -1 || true)"
echo "Rendering diagrams in $DIR ..."

shopt -s nullglob
for src in "$DIR"/*.drawio; do
  base="$(basename "$src" .drawio)"
  out="$DIR/${base}.png"
  echo "  $base.drawio → $base.png"
  drawio -x -f png -s 2 --no-sandbox -o "$out" "$src"
done

echo "Done. $(ls -1 "$DIR"/*.png 2>/dev/null | wc -l | tr -d ' ') PNG(s) in docs/diagrams/"
