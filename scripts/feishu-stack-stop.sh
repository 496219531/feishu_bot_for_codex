#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

"$ROOT_DIR/scripts/feishu-tunnel-stop.sh"
"$ROOT_DIR/scripts/feishu-bot-stop.sh"
