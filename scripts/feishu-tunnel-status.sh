#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SESSION_NAME="${SESSION_NAME:-feishu-tunnel}"
LOG_FILE="${LOG_FILE:-$ROOT_DIR/feishu-tunnel.log}"

if command -v tmux >/dev/null 2>&1 && tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "[tmux] running ($SESSION_NAME)"
else
  echo "[tmux] not running ($SESSION_NAME)"
fi

if [ -f "$ROOT_DIR/feishu-tunnel.url" ]; then
  url="$(cat "$ROOT_DIR/feishu-tunnel.url")"
  echo "[url] $url"
  echo "[callback] ${url}/feishu/events"
else
  echo "[url] not captured yet"
fi

if [ -f "$LOG_FILE" ]; then
  echo "[log] $LOG_FILE"
  tail -n 5 "$LOG_FILE" || true
else
  echo "[log] no log file yet: $LOG_FILE"
fi
