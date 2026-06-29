#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

"$ROOT_DIR/scripts/feishu-hermes-stop.sh"
"$ROOT_DIR/scripts/feishu-hermes-start.sh"
"$ROOT_DIR/scripts/feishu-hermes-status.sh"
