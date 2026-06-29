#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.feishu}"
BOT_PORT="${PORT:-8787}"
BOT_SESSION_NAME="${SESSION_NAME:-feishu-codex}"
BOT_LOG_FILE="${LOG_FILE:-$ROOT_DIR/feishu-bot.log}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  BOT_PORT="${PORT:-$BOT_PORT}"
fi

echo "=== bot ==="
SESSION_NAME="$BOT_SESSION_NAME" LOG_FILE="$BOT_LOG_FILE" PORT="$BOT_PORT" "$ROOT_DIR/scripts/feishu-bot-status.sh"
echo
echo "=== transport ==="
echo "[mode] long connection via official Feishu SDK"
echo "[tunnel] removed / not required"
