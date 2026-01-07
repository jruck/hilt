#!/bin/bash
# Dev launcher script - can be wrapped in an Automator app for dock access

cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"

# Check if dev server is running
if ! curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "Starting dev server..."
    osascript -e "tell application \"Terminal\" to do script \"cd '$PROJECT_DIR' && npm run dev\""
    # Wait for server to be ready
    while ! curl -s http://localhost:3000 > /dev/null 2>&1; do
        sleep 1
    done
fi

# Launch Electron
cd "$PROJECT_DIR"
./node_modules/.bin/electron electron/launcher.cjs
