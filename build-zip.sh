#!/usr/bin/env bash
set -euo pipefail

# Package the Chrome MV3 extension into a versioned ZIP inside dist/
# No build step is required; we simply zip the source excluding dev/test files.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [[ ! -f manifest.json ]]; then
  echo "Error: manifest.json not found in $ROOT_DIR" >&2
  exit 1
fi

# Extract version and name from manifest.json using sed (no jq dependency)
VERSION=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' manifest.json | head -n1 || true)
NAME=$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' manifest.json | head -n1 || true)

if [[ -z "${VERSION:-}" ]]; then
  VERSION="$(date +%Y%m%d%H%M%S)"
fi

SANENAME=$(echo "${NAME:-extension}" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-')
[[ -z "$SANENAME" ]] && SANENAME="extension"

OUTDIR="dist"
mkdir -p "$OUTDIR"
OUTFILE="$OUTDIR/${SANENAME}-v${VERSION}.zip"

# Remove old artifact with same name to avoid confusion
if [[ -f "$OUTFILE" ]]; then
  rm -f "$OUTFILE"
fi

echo "Creating $OUTFILE ..."

# Use -r recurse, -F fix structure, -S store sparse differences
# Exclude common dev/test files and directories
zip -r -FS "$OUTFILE" . \
  -x "*.git*" \
  -x "dist/*" \
  -x "test/*" \
  -x "*.md" \
  -x "LICENSE*" \
  -x "*.sh" \
  -x "node_modules/*" \
  -x "package.json" \
  -x "package-lock.json"

SIZE=$(stat -c%s "$OUTFILE" 2>/dev/null || stat -f%z "$OUTFILE" 2>/dev/null || echo "?")
echo "Done: $OUTFILE (${SIZE} bytes)"
