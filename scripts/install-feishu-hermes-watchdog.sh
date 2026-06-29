#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$AGENT_DIR/com.hankangkang.feishu-hermes-watchdog.plist"
WATCHDOG_SCRIPT="$ROOT_DIR/scripts/feishu-hermes-watchdog.sh"
LOG_DIR="$ROOT_DIR/logs/launchd"
STDOUT_LOG="$LOG_DIR/feishu-hermes-watchdog.out.log"
STDERR_LOG="$LOG_DIR/feishu-hermes-watchdog.err.log"

mkdir -p "$AGENT_DIR" "$LOG_DIR"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.hankangkang.feishu-hermes-watchdog</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$WATCHDOG_SCRIPT</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$STDOUT_LOG</string>
  <key>StandardErrorPath</key>
  <string>$STDERR_LOG</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key>
    <string>$HOME</string>
  </dict>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl enable "gui/$(id -u)/com.hankangkang.feishu-hermes-watchdog"
launchctl kickstart -k "gui/$(id -u)/com.hankangkang.feishu-hermes-watchdog"

echo "[ok] installed launchd agent: $PLIST_PATH"
echo "[ok] stdout log: $STDOUT_LOG"
echo "[ok] stderr log: $STDERR_LOG"
launchctl print "gui/$(id -u)/com.hankangkang.feishu-hermes-watchdog" | sed -n '1,80p'
