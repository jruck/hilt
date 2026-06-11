#!/bin/bash
# Creates a macOS app bundle for development
# Single click launches Electron, which starts all dev servers internally

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Hilt"
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
    <string>com.hilt.app</string>
    <key>CFBundleName</key>
    <string>Hilt</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleVersion</key>
    <string>1.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.15</string>
</dict>
</plist>
EOF

# Create launcher script.
# Resolves the project dir at runtime from the .app's own location
# (dist/Hilt.app/Contents/MacOS/launcher -> 4 levels up), so moving the
# project folder doesn't break the app. Falls back to the build-time path
# if the .app was copied out of dist/.
cat > "$APP_PATH/Contents/MacOS/launcher" << 'LAUNCHER_EOF'
#!/bin/bash
# Hilt Launcher - Electron handles all dev servers internally

# Self-locate: launcher lives at dist/Hilt.app/Contents/MacOS/launcher
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SELF_DIR/../../../.." 2>/dev/null && pwd)"

# Fall back to the build-time path if self-location didn't land on the project
if [ ! -f "$PROJECT_DIR/electron/launcher.cjs" ]; then
    PROJECT_DIR="PLACEHOLDER_PROJECT_DIR"
fi

if [ ! -f "$PROJECT_DIR/electron/launcher.cjs" ]; then
    osascript -e 'display alert "Hilt" message "Could not find the Hilt project. Re-run: npm run app"'
    exit 1
fi

cd "$PROJECT_DIR"

# Ensure node is in PATH (Finder doesn't inherit shell PATH)
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
if [ -d "$HOME/.nvm/versions/node" ]; then
    NODE_DIR=$(ls -1 "$HOME/.nvm/versions/node" | tail -1)
    if [ -n "$NODE_DIR" ]; then
        export PATH="$HOME/.nvm/versions/node/$NODE_DIR/bin:$PATH"
    fi
fi

# Server mode baked at app-creation time: "prod" serves the .next-prod build
# (created by `npm run rebuild`); anything else runs the dev server.
export HILT_APP_MODE="PLACEHOLDER_APP_MODE"

exec "$PROJECT_DIR/node_modules/.bin/electron" "$PROJECT_DIR/electron/launcher.cjs"
LAUNCHER_EOF

# Replace placeholder with actual project dir (build-time fallback)
sed -i '' "s|PLACEHOLDER_PROJECT_DIR|$PROJECT_DIR|g" "$APP_PATH/Contents/MacOS/launcher"

# Bake the server mode (npm run app => dev, npm run app:prod => prod)
sed -i '' "s|PLACEHOLDER_APP_MODE|${HILT_APP_MODE:-dev}|g" "$APP_PATH/Contents/MacOS/launcher"

chmod +x "$APP_PATH/Contents/MacOS/launcher"

# Copy icon
if [ -f "$PROJECT_DIR/build/icon.icns" ]; then
    cp "$PROJECT_DIR/build/icon.icns" "$APP_PATH/Contents/Resources/icon.icns"
fi

echo "Created: $APP_PATH (server mode: ${HILT_APP_MODE:-dev})"
echo ""
echo "Double-click to launch. Electron starts all servers automatically."
echo "No Terminal.app needed."
if [ "${HILT_APP_MODE:-dev}" = "prod" ]; then
    echo "Prod mode: after code changes, run 'npm run rebuild' — the running app"
    echo "restarts its Next.js server on the new build and reloads automatically."
fi

# Reveal in Finder
open -R "$APP_PATH"
