#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.feishu}"
SESSION_NAME="${SESSION_NAME:-feishu-codex}"
STATUS_SCRIPT="$ROOT_DIR/scripts/feishu-bot-status.sh"
START_SCRIPT="$ROOT_DIR/scripts/feishu-bot-start.sh"
RESTART_SCRIPT="$ROOT_DIR/scripts/feishu-bot-restart.sh"
CHECK_INTERVAL="${CHECK_INTERVAL:-15}"
START_GRACE_SECONDS="${START_GRACE_SECONDS:-25}"
LAST_START_AT=0
HEALTH_URL=""

log() {
  printf '%s [codex-watchdog] %s
' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

longconn_ok_from_health() {
  local payload="$1"
  python3 - "$payload" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
longconn = payload.get("longconn") or {}
print("1" if longconn.get("healthy", False) else "0")
PY
}

port="8787"
conn_mode="long"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  port="${PORT:-8787}"
  conn_mode="${FEISHU_CONNECTION_MODE:-long}"
fi
HEALTH_URL="http://127.0.0.1:${port}/healthz"

if ! command -v tmux >/dev/null 2>&1; then
  log 'fatal: tmux not found'
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  log 'fatal: curl not found'
  exit 1
fi

if [ ! -x "$START_SCRIPT" ] || [ ! -x "$RESTART_SCRIPT" ] || [ ! -x "$STATUS_SCRIPT" ]; then
  log 'fatal: required scripts are not executable'
  exit 1
fi

log "started; session=$SESSION_NAME port=$port env=$ENV_FILE"

while true; do
  now="$(date +%s)"
  session_ok=0
  health_ok=0
  longconn_ok=1
  health_payload=""

  if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    session_ok=1
  fi

  if health_payload="$(curl -fsS "$HEALTH_URL" 2>/dev/null)"; then
    health_ok=1
    if [ "$conn_mode" = "long" ]; then
      if [ "$(longconn_ok_from_health "$health_payload")" != "1" ]; then
        longconn_ok=0
      fi
    fi
  fi

  if [ "$session_ok" -eq 1 ] && [ "$health_ok" -eq 1 ] && [ "$longconn_ok" -eq 1 ]; then
    sleep "$CHECK_INTERVAL"
    continue
  fi

  if [ $((now - LAST_START_AT)) -lt "$START_GRACE_SECONDS" ]; then
    log "waiting for grace period; session_ok=$session_ok health_ok=$health_ok longconn_ok=$longconn_ok"
    sleep "$CHECK_INTERVAL"
    continue
  fi

  if [ "$session_ok" -eq 0 ]; then
    log 'detected missing tmux session; starting bot'
    "$START_SCRIPT" || log 'start script returned non-zero'
  elif [ "$health_ok" -eq 0 ]; then
    log 'detected unhealthy healthz with existing tmux session; restarting bot'
    "$RESTART_SCRIPT" || log 'restart script returned non-zero'
  elif [ "$longconn_ok" -eq 0 ]; then
    log 'detected degraded long connection with healthy local server; restarting bot'
    "$RESTART_SCRIPT" || log 'restart script returned non-zero'
  else
    log 'detected unexpected watchdog state; restarting bot'
    "$RESTART_SCRIPT" || log 'restart script returned non-zero'
  fi

  LAST_START_AT="$(date +%s)"
  sleep "$CHECK_INTERVAL"
done
