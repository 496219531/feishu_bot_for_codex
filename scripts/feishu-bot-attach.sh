#!/usr/bin/env bash
set -euo pipefail

SESSION_NAME="${SESSION_NAME:-feishu-codex}"

if ! command -v tmux >/dev/null 2>&1; then
  echo "[fatal] tmux not found."
  exit 1
fi

tmux attach -t "$SESSION_NAME"
