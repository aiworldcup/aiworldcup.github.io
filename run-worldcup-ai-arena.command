#!/bin/zsh
cd /Users/tom/worldcup-ai-arena || exit 1

echo "Starting World Cup AI Arena..."
echo "Open http://localhost:8080 in your browser."
echo "Press Ctrl+C in this window to stop the server."
echo

(sleep 1; open http://localhost:8080) &

npm run serve
