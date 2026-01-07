#!/bin/bash
# Creates a macOS app bundle for development that connects to the dev server

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Claude Kanban"
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
    <string>com.claude-kanban.app</string>
    <key>CFBundleName</key>
    <string>Claude Kanban</string>
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
# Claude Kanban Launcher
# Fast startup - skips slow nvm sourcing

PROJECT_DIR="PLACEHOLDER_PROJECT_DIR"
PORT_FILE="$PROJECT_DIR/.dev-port"
cd "$PROJECT_DIR"

# Add nvm node to PATH without sourcing slow nvm.sh
if [ -d "$HOME/.nvm/versions/node" ]; then
    NODE_DIR=$(ls -1 "$HOME/.nvm/versions/node" | tail -1)
    if [ -n "$NODE_DIR" ]; then
        export PATH="$HOME/.nvm/versions/node/$NODE_DIR/bin:$PATH"
    fi
fi

# Quick server check with 2-second timeout
check_server() {
    curl -s --max-time 2 "http://localhost:$1" 2>/dev/null | grep -q "_next"
}

# Find available port
find_port() {
    for p in 3000 3001 3002 3003 3004 3005; do
        if ! lsof -i :$p > /dev/null 2>&1; then
            echo $p
            return
        fi
    done
    echo 3000
}

# Try saved port first
DEV_PORT=""
if [ -f "$PORT_FILE" ]; then
    SAVED=$(cat "$PORT_FILE")
    check_server "$SAVED" && DEV_PORT="$SAVED"
fi

# Scan common ports for existing server
if [ -z "$DEV_PORT" ]; then
    for port in 3000 3001 3002 3003; do
        if check_server "$port"; then
            DEV_PORT="$port"
            echo "$DEV_PORT" > "$PORT_FILE"
            break
        fi
    done
fi

# No server found - start one
if [ -z "$DEV_PORT" ]; then
    DEV_PORT=$(find_port)
    echo "$DEV_PORT" > "$PORT_FILE"

    # Start dev server in Terminal
    osascript -e "tell application \"Terminal\" to do script \"cd '$PROJECT_DIR' && source ~/.nvm/nvm.sh 2>/dev/null; nvm use 2>/dev/null; PORT=$DEV_PORT npm run dev\""

    # Wait for server (max 60s)
    for i in {1..60}; do
        check_server "$DEV_PORT" && break
        sleep 1
    done
fi

# Launch Electron
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
