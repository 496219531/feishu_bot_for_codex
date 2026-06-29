#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.feishu}"

if [ ! -f "$ENV_FILE" ]; then
  echo "[fatal] env file not found: $ENV_FILE"
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [ "${FEISHU_CONNECTION_MODE:-long}" != "long" ]; then
  echo "[fatal] Codex stack only supports FEISHU_CONNECTION_MODE=long"
  exit 1
fi

"$ROOT_DIR/scripts/feishu-bot-start.sh"

ENV_FILE="$ENV_FILE" "$ROOT_DIR/scripts/feishu-stack-status.sh"
