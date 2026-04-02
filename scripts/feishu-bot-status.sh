#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SESSION_NAME="${SESSION_NAME:-feishu-codex}"
LOG_FILE="${LOG_FILE:-$ROOT_DIR/feishu-bot.log}"
PORT="${PORT:-8787}"

if command -v tmux >/dev/null 2>&1 && tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "[tmux] running ($SESSION_NAME)"
else
  echo "[tmux] not running ($SESSION_NAME)"
fi

if command -v curl >/dev/null 2>&1; then
  echo "[healthz] $(curl -s "http://127.0.0.1:${PORT}/healthz" || echo unavailable)"
else
  echo "[healthz] curl not installed"
fi

if [ -f "$LOG_FILE" ]; then
  echo "[log] $LOG_FILE"
  tail -n 5 "$LOG_FILE" || true
else
  echo "[log] no log file yet: $LOG_FILE"
fi
