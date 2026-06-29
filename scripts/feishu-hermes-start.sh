#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.feishu.hermes}"
SESSION_NAME="${SESSION_NAME:-feishu-hermes}"
LOG_FILE="${LOG_FILE:-$ROOT_DIR/feishu-hermes-bot.log}"
PORT="${PORT:-8788}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"

if ! command -v tmux >/dev/null 2>&1; then
  echo "[fatal] tmux not found. Install tmux first."
  exit 1
fi

if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "[fatal] node not found. Set NODE_BIN or ensure node is on PATH."
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "[fatal] env file not found: $ENV_FILE"
  exit 1
fi

(
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a

  app_id="${FEISHU_APP_ID:-${APP_ID:-}}"
  app_secret="${FEISHU_APP_SECRET:-${APP_SECRET:-}}"
  conn_mode="${FEISHU_CONNECTION_MODE:-long}"

  if [ -z "$app_id" ] || [ -z "$app_secret" ]; then
    echo "[fatal] missing App ID/Secret in $ENV_FILE"
    exit 1
  fi

  if [ "$conn_mode" != "long" ]; then
    echo "[fatal] Hermes bot only supports FEISHU_CONNECTION_MODE=long. Current: $conn_mode"
    echo "[hint] edit $ENV_FILE and set FEISHU_CONNECTION_MODE=long"
    exit 1
  fi
) || exit 1

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "[ok] tmux session already running: $SESSION_NAME"
  exit 0
fi

mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"

CMD="cd '$ROOT_DIR' && set -a && source '$ENV_FILE' && set +a && '$NODE_BIN' feishu_hermes_bot.mjs >> '$LOG_FILE' 2>&1"
tmux new-session -d -s "$SESSION_NAME" "$CMD"

sleep 0.2
if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "[fatal] bot exited immediately. Check log:"
  tail -n 40 "$LOG_FILE" || true
  exit 1
fi

SESSION_NAME="feishu-hermes-tunnel" "$ROOT_DIR/scripts/feishu-tunnel-stop.sh" >/dev/null 2>&1 || true
echo "[ok] transport: official Feishu long connection only"

ENV_FILE="$ENV_FILE" SESSION_NAME="$SESSION_NAME" LOG_FILE="$LOG_FILE" PORT="${PORT:-8788}" "$ROOT_DIR/scripts/feishu-hermes-status.sh"
