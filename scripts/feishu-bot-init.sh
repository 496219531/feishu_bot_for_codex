#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_FILE="${OUT_FILE:-$ROOT_DIR/.env.feishu}"
EXAMPLE_FILE="${EXAMPLE_FILE:-$ROOT_DIR/.env.feishu.example}"

if [ ! -f "$EXAMPLE_FILE" ]; then
  echo "[fatal] missing example env: $EXAMPLE_FILE"
  exit 1
fi

default_workspace="$ROOT_DIR"
default_port="8787"

echo "This will create: $OUT_FILE"
echo "Secrets are entered locally and won't be printed."
echo

read -r -p "Feishu App ID (e.g. cli_xxx): " app_id
read -r -s -p "Feishu App Secret: " app_secret
echo
read -r -p "Verification Token (optional, Enter to skip): " verification_token
read -r -p "Allowed open_id list (comma separated, optional): " allowed_open_ids
read -r -p "Workspace dir (default: $default_workspace): " workspace_dir
read -r -p "Port (default: $default_port): " port

workspace_dir="${workspace_dir:-$default_workspace}"
port="${port:-$default_port}"

if [ -z "${app_id}" ]; then
  echo "[fatal] App ID is required"
  exit 1
fi
if [ -z "${app_secret}" ]; then
  echo "[fatal] App Secret is required"
  exit 1
fi

if [ -f "$OUT_FILE" ]; then
  bak="${OUT_FILE}.bak.$(date +%Y%m%d-%H%M%S)"
  cp "$OUT_FILE" "$bak"
  echo "[ok] backup created: $bak"
fi

cat >"$OUT_FILE" <<EOF
FEISHU_APP_ID=${app_id}
FEISHU_APP_SECRET=${app_secret}

FEISHU_VERIFICATION_TOKEN=${verification_token}
ALLOWED_OPEN_IDS=${allowed_open_ids}

PORT=${port}
WORKSPACE_DIR=${workspace_dir}

CODEX_BIN=codex
CODEX_EXEC_MODE=config

# 留空表示直接使用 ~/.codex/config.toml 里的模型与推理配置
# CODEX_MODEL=
# CODEX_REASONING_EFFORT=

STATE_FILE=${ROOT_DIR}/.feishu-codex-bot-state.json
MAX_TEXT_CHARS=1800
EOF

chmod 600 "$OUT_FILE" || true
echo "[ok] wrote: $OUT_FILE"
echo "[next] start: $ROOT_DIR/scripts/feishu-bot-start.sh"
