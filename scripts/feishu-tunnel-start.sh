#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SESSION_NAME="${SESSION_NAME:-feishu-tunnel}"
LOG_FILE="${LOG_FILE:-$ROOT_DIR/feishu-tunnel.log}"
PORT="${PORT:-8787}"
CLOUDFLARED_BIN="${CLOUDFLARED_BIN:-/opt/homebrew/bin/cloudflared}"

if ! command -v tmux >/dev/null 2>&1; then
  echo "[fatal] tmux not found."
  exit 1
fi

if [ ! -x "$CLOUDFLARED_BIN" ]; then
  echo "[fatal] cloudflared not found: $CLOUDFLARED_BIN"
  exit 1
fi

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "[ok] tmux session already running: $SESSION_NAME"
else
  touch "$LOG_FILE"
  CMD="cd '$ROOT_DIR' && '$CLOUDFLARED_BIN' tunnel --url 'http://127.0.0.1:${PORT}' >> '$LOG_FILE' 2>&1"
  tmux new-session -d -s "$SESSION_NAME" "$CMD"
fi

url=""
for _ in $(seq 1 20); do
  if [ -f "$LOG_FILE" ]; then
    url="$(grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' "$LOG_FILE" | tail -n 1 || true)"
  fi
  if [ -n "$url" ]; then
    break
  fi
  sleep 1
done

if [ -z "$url" ]; then
  echo "[warn] tunnel started, but URL not found yet."
  echo "[tip] check log: $LOG_FILE"
  exit 0
fi

printf '%s\n' "$url" > "$ROOT_DIR/feishu-tunnel.url"
echo "[ok] tunnel running: $SESSION_NAME"
echo "[ok] public url: $url"
echo "[ok] callback url: ${url}/feishu/events"
