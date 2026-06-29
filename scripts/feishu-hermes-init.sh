#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_FILE="${OUT_FILE:-$ROOT_DIR/.env.feishu.hermes}"
EXAMPLE_FILE="$ROOT_DIR/.env.feishu.hermes.example"

if [ -f "$OUT_FILE" ]; then
  echo "[ok] already exists: $OUT_FILE"
  exit 0
fi

cp "$EXAMPLE_FILE" "$OUT_FILE"
chmod 600 "$OUT_FILE" || true

echo "[ok] wrote: $OUT_FILE"
echo "[next] edit App ID / App Secret / ALLOWED_OPEN_IDS"
echo "[next] start: $ROOT_DIR/scripts/feishu-hermes-start.sh"
