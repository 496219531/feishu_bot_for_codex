#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HERMES_HOME_DIR="${HERMES_HOME:-$HOME/.hermes}"

echo "[info] Hermes home: $HERMES_HOME_DIR"

if [ ! -d "$HERMES_HOME_DIR" ]; then
  echo "[fatal] Hermes home not found: $HERMES_HOME_DIR"
  echo "[hint] Run 'hermes setup' first."
  exit 1
fi

mkdir -p "$HERMES_HOME_DIR/platforms/pairing"
chmod 700 "$HERMES_HOME_DIR" "$HERMES_HOME_DIR/platforms" "$HERMES_HOME_DIR/platforms/pairing" || true

if [ -f "$HERMES_HOME_DIR/.env" ]; then
  chmod 600 "$HERMES_HOME_DIR/.env" || true
fi

if [ -f "$HERMES_HOME_DIR/auth.lock" ]; then
  chmod 600 "$HERMES_HOME_DIR/auth.lock" || true
fi

echo "[check] pairing store"
hermes pairing list || true

echo "[check] doctor"
hermes doctor || true

echo "[restart] feishu hermes bot"
"$ROOT_DIR/scripts/feishu-hermes-restart.sh"

