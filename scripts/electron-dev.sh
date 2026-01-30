#!/bin/bash
# Electron dev launcher with dynamic port detection

# Find an available port starting from 3000
find_port() {
  local port=$1
  while lsof -i ":$port" >/dev/null 2>&1; do
    port=$((port + 1))
    if [ $port -gt 3100 ]; then
      echo "No available port found between 3000-3100" >&2
      exit 1
    fi
  done
  echo $port
}

PORT=$(find_port 3000)
echo "Using port: $PORT"

# Export for both Next.js and Electron
export PORT
export CLAUDE_KANBAN_DEV_PORT=$PORT

# Start Next.js and Electron concurrently
npx concurrently \
  "npm run dev -- --port $PORT" \
  "wait-on http://localhost:$PORT && electron electron/launcher.cjs"
