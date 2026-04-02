#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

"$ROOT_DIR/scripts/feishu-bot-start.sh"
"$ROOT_DIR/scripts/feishu-tunnel-start.sh"
"$ROOT_DIR/scripts/feishu-stack-status.sh"
