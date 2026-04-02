#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.feishu}"
SESSION_NAME="${SESSION_NAME:-feishu-codex}"
LOG_FILE="${LOG_FILE:-$ROOT_DIR/feishu-bot.log}"

if ! command -v tmux >/dev/null 2>&1; then
  echo "[fatal] tmux not found. Install tmux first."
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "[fatal] env file not found: $ENV_FILE"
  echo "Create it with: $ROOT_DIR/scripts/feishu-bot-init.sh"
  exit 1
fi

(
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a

  app_id="${FEISHU_APP_ID:-${APP_ID:-}}"
  app_secret="${FEISHU_APP_SECRET:-${APP_SECRET:-}}"

  if [ -z "$app_id" ] || [ -z "$app_secret" ]; then
    echo "[fatal] missing App ID/Secret in $ENV_FILE"
    echo "Set FEISHU_APP_ID/FEISHU_APP_SECRET (or APP_ID/APP_SECRET)."
    exit 1
  fi
) || exit 1

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "[ok] tmux session already running: $SESSION_NAME"
  exit 0
fi

mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"

CMD="cd '$ROOT_DIR' && set -a && source '$ENV_FILE' && set +a && node feishu_codex_bot.mjs >> '$LOG_FILE' 2>&1"
tmux new-session -d -s "$SESSION_NAME" "$CMD"

sleep 0.2
if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "[fatal] bot exited immediately. Check log:"
  tail -n 40 "$LOG_FILE" || true
  exit 1
fi

echo "[ok] started session: $SESSION_NAME"
echo "[ok] log file: $LOG_FILE"
echo "[tip] tail logs: tail -f '$LOG_FILE'"
echo "[tip] if not working, check env: $ENV_FILE"
