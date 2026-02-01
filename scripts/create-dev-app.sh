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

# Create launcher script
cat > "$APP_PATH/Contents/MacOS/launcher" << 'LAUNCHER_EOF'
#!/bin/bash
# Hilt Launcher - Electron handles all dev servers internally

PROJECT_DIR="PLACEHOLDER_PROJECT_DIR"
cd "$PROJECT_DIR"

# Add nvm node to PATH without sourcing slow nvm.sh
if [ -d "$HOME/.nvm/versions/node" ]; then
    NODE_DIR=$(ls -1 "$HOME/.nvm/versions/node" | tail -1)
    if [ -n "$NODE_DIR" ]; then
        export PATH="$HOME/.nvm/versions/node/$NODE_DIR/bin:$PATH"
    fi
fi

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
echo "Double-click to launch. Electron starts all dev servers automatically."
echo "No Terminal.app needed."

# Reveal in Finder
open -R "$APP_PATH"
