#!/usr/bin/env bash
set -euo pipefail
echo "## repo tree (first 400 files)"; git ls-files | sed 's/^/ - /' | head -n 400
echo; echo "## key configs"
for f in package.json tsconfig.json pnpm-workspace.yaml; do
  if [ -f "$f" ]; then echo "--- $f"; sed -n '1,180p' "$f"; fi
done
echo; echo "## app entrypoints"
for f in packages/electron-main/src/main.ts packages/renderer/src/main.ts; do
  if [ -f "$f" ]; then echo "--- $f"; sed -n '1,220p' "$f"; fi
done
