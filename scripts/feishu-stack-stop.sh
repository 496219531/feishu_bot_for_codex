#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.feishu}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

SESSION_NAME="feishu-tunnel" "$ROOT_DIR/scripts/feishu-tunnel-stop.sh" >/dev/null 2>&1 || true
"$ROOT_DIR/scripts/feishu-bot-stop.sh"
