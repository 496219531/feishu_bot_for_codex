#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

"$ROOT_DIR/scripts/feishu-bot-stop.sh"
"$ROOT_DIR/scripts/feishu-bot-start.sh"
"$ROOT_DIR/scripts/feishu-bot-status.sh"
