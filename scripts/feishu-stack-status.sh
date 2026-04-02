#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== bot ==="
"$ROOT_DIR/scripts/feishu-bot-status.sh"
echo
echo "=== tunnel ==="
"$ROOT_DIR/scripts/feishu-tunnel-status.sh"
