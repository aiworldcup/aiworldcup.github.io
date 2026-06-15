#!/bin/zsh
set -euo pipefail

cd /Users/tom/worldcup-ai-arena
mkdir -p logs
mkdir -p "$HOME/Library/LaunchAgents"

cp ops/launchd/com.tom.worldcup-ai-arena-results.plist "$HOME/Library/LaunchAgents/"
cp ops/launchd/com.tom.worldcup-ai-arena-roundtable.plist "$HOME/Library/LaunchAgents/"

launchctl unload "$HOME/Library/LaunchAgents/com.tom.worldcup-ai-arena-results.plist" 2>/dev/null || true
launchctl unload "$HOME/Library/LaunchAgents/com.tom.worldcup-ai-arena-roundtable.plist" 2>/dev/null || true

launchctl load "$HOME/Library/LaunchAgents/com.tom.worldcup-ai-arena-results.plist"
launchctl load "$HOME/Library/LaunchAgents/com.tom.worldcup-ai-arena-roundtable.plist"

launchctl kickstart -k "gui/$(id -u)/com.tom.worldcup-ai-arena-results" 2>/dev/null || true

echo "Installed:"
echo "  com.tom.worldcup-ai-arena-results    every 10 minutes"
echo "  com.tom.worldcup-ai-arena-roundtable daily 10:00 Asia/Shanghai"
