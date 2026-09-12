#!/bin/bash
#
# Rebuild the "Download source ZIP" the game offers on its main menu.
#
# This existed as a file nobody rebuilt, so it drifted: at one point the zip on
# the live site was six weeks behind the game, and somebody re-downloading it
# would have got a version with no fleet models, no boat, no minimap and half
# the missions missing. Run this whenever the game is deployed.
#
# Usage:  tools/build-source-zip.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/download/island-flight-sim-source.zip"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

DEST="$STAGE/island-flight-sim"
mkdir -p "$DEST"

# Everything needed to run the game, plus the docs that explain it.
# NOT the download folder itself — a zip containing last week's zip is how the
# thing ends up 4 MB of its own history.
rsync -a \
  --exclude '.git' \
  --exclude '.github' \
  --exclude 'node_modules' \
  --exclude '.DS_Store' \
  --exclude 'download' \
  "$ROOT"/ "$DEST"/

mkdir -p "$ROOT/download"
rm -f "$OUT"
( cd "$STAGE" && zip -qr "$OUT" island-flight-sim -x '*.DS_Store' )

FILES=$(unzip -l "$OUT" | tail -1 | awk '{print $2}')
SIZE=$(du -h "$OUT" | cut -f1)
echo "Wrote $OUT"
echo "  $FILES files, $SIZE"

# A zip that cannot produce a running game is worse than no zip, so check the
# handful of files without which it will not boot.
#
# The listing is captured once rather than piped per-check: `grep -q` exits on
# the first match, `unzip` takes SIGPIPE, and under `pipefail` that reads as a
# failed pipeline — so every file "went missing" the moment it was found.
LISTING="$(unzip -l "$OUT")"
for need in index.html sw.js src/main.js src/vendor/three.module.js styles/main.css; do
  case "$LISTING" in
    *"island-flight-sim/$need"*) ;;
    *) echo "MISSING: $need" >&2; exit 1 ;;
  esac
done
echo "  boot files present"
