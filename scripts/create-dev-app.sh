#!/bin/bash
# Creates a macOS app bundle for development that connects to the dev server

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Claude Kanban Dev"
APP_PATH="$PROJECT_DIR/dist/$APP_NAME.app"

echo "Creating $APP_NAME.app..."

# Create app bundle structure
mkdir -p "$APP_PATH/Contents/MacOS"
mkdir -p "$APP_PATH/Contents/Resources"

# Create Info.plist
cat > "$APP_PATH/Contents/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>launcher</string>
    <key>CFBundleIconFile</key>
    <string>icon</string>
    <key>CFBundleIdentifier</key>
    <string>com.claude-kanban.dev</string>
    <key>CFBundleName</key>
    <string>Claude Kanban Dev</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleVersion</key>
    <string>1.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.15</string>
</dict>
</plist>
EOF

# Create launcher script
cat > "$APP_PATH/Contents/MacOS/launcher" << 'LAUNCHER_EOF'
#!/bin/bash
# Claude Kanban Dev Launcher
# Handles port detection and starts dev server if needed

PROJECT_DIR="PLACEHOLDER_PROJECT_DIR"
PORT_FILE="$PROJECT_DIR/.dev-port"
cd "$PROJECT_DIR"

# Use nvm if available
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Function to check if a port has our dev server
check_our_server() {
    local port=$1
    # Check if responding and is Next.js (returns HTML with _next)
    if curl -s "http://localhost:$port" 2>/dev/null | grep -q "_next"; then
        return 0
    fi
    return 1
}

# Function to find available port
find_available_port() {
    local port=3000
    while [ $port -lt 3100 ]; do
        if ! lsof -i :$port > /dev/null 2>&1; then
            echo $port
            return
        fi
        port=$((port + 1))
    done
    echo 3000  # fallback
}

# Check if we have a saved port from a previous run
DEV_PORT=""
if [ -f "$PORT_FILE" ]; then
    SAVED_PORT=$(cat "$PORT_FILE")
    if check_our_server "$SAVED_PORT"; then
        DEV_PORT="$SAVED_PORT"
    fi
fi

# If no saved port or it's stale, look for running server or start new one
if [ -z "$DEV_PORT" ]; then
    # Check common ports for existing Next.js server
    for port in 3000 3001 3002 3003; do
        if check_our_server "$port"; then
            DEV_PORT="$port"
            echo "$DEV_PORT" > "$PORT_FILE"
            break
        fi
    done
fi

# No server found, start a new one
if [ -z "$DEV_PORT" ]; then
    DEV_PORT=$(find_available_port)
    echo "Starting dev server on port $DEV_PORT..."
    echo "$DEV_PORT" > "$PORT_FILE"

    # Start dev server in Terminal with the specific port
    osascript -e "tell application \"Terminal\" to do script \"cd '$PROJECT_DIR' && source ~/.nvm/nvm.sh 2>/dev/null; nvm use 2>/dev/null; PORT=$DEV_PORT npm run dev\""

    # Wait for server to be ready (up to 60 seconds)
    echo "Waiting for dev server..."
    for i in {1..60}; do
        if check_our_server "$DEV_PORT"; then
            echo "Dev server ready on port $DEV_PORT"
            break
        fi
        sleep 1
    done
fi

# Launch Electron with the port
export CLAUDE_KANBAN_DEV_PORT="$DEV_PORT"
exec "$PROJECT_DIR/node_modules/.bin/electron" "$PROJECT_DIR/electron/launcher.cjs"
LAUNCHER_EOF

# Replace placeholder with actual project dir
sed -i '' "s|PLACEHOLDER_PROJECT_DIR|$PROJECT_DIR|g" "$APP_PATH/Contents/MacOS/launcher"

chmod +x "$APP_PATH/Contents/MacOS/launcher"

# Copy icon
if [ -f "$PROJECT_DIR/build/icon.icns" ]; then
    cp "$PROJECT_DIR/build/icon.icns" "$APP_PATH/Contents/Resources/icon.icns"
fi

echo "Created: $APP_PATH"
echo ""
echo "Drag this app to your Dock for quick access!"
echo "It will start the dev server if needed and open the Electron app."
echo ""
echo "Port handling:"
echo "  - Checks for existing claude-kanban dev server on ports 3000-3003"
echo "  - If none found, starts new server on first available port"
echo "  - Remembers port in .dev-port file for faster subsequent launches"

# Reveal in Finder
open -R "$APP_PATH"
