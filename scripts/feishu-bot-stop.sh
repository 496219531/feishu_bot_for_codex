#!/usr/bin/env bash
set -euo pipefail

SESSION_NAME="${SESSION_NAME:-feishu-codex}"

if ! command -v tmux >/dev/null 2>&1; then
  echo "[fatal] tmux not found."
  exit 1
fi

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  tmux kill-session -t "$SESSION_NAME"
  echo "[ok] stopped session: $SESSION_NAME"
else
  echo "[ok] session not running: $SESSION_NAME"
fi
