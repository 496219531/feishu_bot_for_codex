#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RESTART_SESSION="${RESTART_SESSION:-feishu-hermes-restart}"
BOT_SESSION_NAME="${BOT_SESSION_NAME:-feishu-hermes}"
LOG_FILE="${LOG_FILE:-$ROOT_DIR/feishu-hermes-restart.log}"
WORKER_SCRIPT="$ROOT_DIR/scripts/feishu-hermes-restart.sh"

if ! command -v tmux >/dev/null 2>&1; then
  echo "[fatal] tmux not found."
  exit 1
fi

if [ ! -x "$WORKER_SCRIPT" ]; then
  echo "[fatal] worker script not executable: $WORKER_SCRIPT"
  exit 1
fi

if tmux has-session -t "$RESTART_SESSION" 2>/dev/null; then
  echo "[ok] restart session already running: $RESTART_SESSION"
  exit 0
fi

mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"

CMD="sleep 1; SESSION_NAME='$BOT_SESSION_NAME' '$WORKER_SCRIPT' >> '$LOG_FILE' 2>&1; tmux kill-session -t '$RESTART_SESSION' >/dev/null 2>&1 || true"
tmux new-session -d -s "$RESTART_SESSION" "$CMD"

sleep 0.2
if ! tmux has-session -t "$RESTART_SESSION" 2>/dev/null; then
  echo "[fatal] failed to schedule restart session: $RESTART_SESSION"
  exit 1
fi

echo "[ok] scheduled bot restart via tmux session: $RESTART_SESSION"
echo "[ok] target bot session: $BOT_SESSION_NAME"
echo "[ok] log file: $LOG_FILE"
