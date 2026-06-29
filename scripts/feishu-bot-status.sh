#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SESSION_NAME="${SESSION_NAME:-feishu-codex}"
LOG_FILE="${LOG_FILE:-$ROOT_DIR/feishu-bot.log}"
PORT="${PORT:-8787}"
HEALTH_URL="http://127.0.0.1:${PORT}/healthz"

render_health() {
  local payload="$1"
  python3 - "$payload" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
longconn = payload.get("longconn") or {}

parts = [
    f"ok={payload.get('ok')}",
    f"running={payload.get('running')}",
    f"queue={payload.get('queue')}",
    f"mode={payload.get('mode')}",
]

if longconn:
    parts.extend([
        f"longconn={longconn.get('status', 'unknown')}",
        f"healthy={longconn.get('healthy')}",
    ])
    if longconn.get("last_event_at"):
        parts.append(f"last_event_at={longconn['last_event_at']}")
    if longconn.get("last_error"):
        parts.append(f"last_error={longconn['last_error']}")

print(" ".join(parts))
PY
}

if command -v tmux >/dev/null 2>&1 && tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "[tmux] running ($SESSION_NAME)"
else
  echo "[tmux] not running ($SESSION_NAME)"
fi

if command -v curl >/dev/null 2>&1; then
  health_payload="$(curl -s "$HEALTH_URL" 2>/dev/null || true)"
  if [ -n "$health_payload" ]; then
    echo "[healthz] $(render_health "$health_payload")"
  else
    echo "[healthz] unavailable"
  fi
else
  echo "[healthz] curl not installed"
fi

if [ -f "$LOG_FILE" ]; then
  echo "[log] $LOG_FILE"
  tail -n 5 "$LOG_FILE" || true
else
  echo "[log] no log file yet: $LOG_FILE"
fi
