#!/bin/bash
# Creates a macOS app bundle for development
# Single click launches Electron, which starts all dev servers internally

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Hilt"
APP_PATH="$PROJECT_DIR/dist/$APP_NAME.app"

echo "Creating $APP_NAME.app..."

# Create app bundle structure
rm -rf "$APP_PATH"
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
# (dist/Hilt.app/Contents/MacOS/launcher.sh -> 4 levels up), so moving the
# whole project folder doesn't break the app. The app must stay inside this
# checkout's dist/ folder because it is a source launcher, not a distribution
# package with bundled runtime assets.
#
# CFBundleExecutable itself must be a native Mach-O binary. On Apple Silicon
# systems without Rosetta, LaunchServices can show a Rosetta prompt before it
# even executes a script-based app launcher. Keep the shell logic in
# launcher.sh and compile a tiny native launcher executable below.
cat > "$APP_PATH/Contents/MacOS/launcher.sh" << 'LAUNCHER_EOF'
#!/bin/bash
# Hilt Launcher - Electron handles all dev servers internally

show_error() {
    /usr/bin/osascript -e "display dialog \"$1\" buttons {\"OK\"} default button \"OK\" with title \"Hilt\" with icon caution" >/dev/null 2>&1 || true
}

# Self-locate: launcher.sh lives at dist/Hilt.app/Contents/MacOS/launcher.sh
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SELF_DIR/../../../.." 2>/dev/null && pwd)"

if [ ! -f "$PROJECT_DIR/electron/launcher.cjs" ]; then
    show_error "Could not find the Hilt project beside this app. Open it from the repo's dist/Hilt.app, or re-run npm run app:prod."
    exit 1
fi

case "$PROJECT_DIR" in
    /Volumes/*)
        show_error "Hilt is running from a network volume. Move or clone the checkout onto this Mac, run npm install, then run npm run app:prod."
        exit 1
        ;;
esac

if [ ! -f "$PROJECT_DIR/.nvmrc" ]; then
    show_error "Hilt is missing .nvmrc. Re-run npm install from a complete checkout, then run npm run app:prod."
    exit 1
fi

cd "$PROJECT_DIR"

# Ensure node is in PATH (Finder doesn't inherit shell PATH). Prefer the exact
# major version declared by .nvmrc, then fall back to Homebrew's normal PATH.
NODE_VERSION="$(tr -d '[:space:]' < "$PROJECT_DIR/.nvmrc")"
NODE_VERSION="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_VERSION%%.*}"
NODE_BIN_DIR=""

if [ -d "$HOME/.nvm/versions/node" ]; then
    for CANDIDATE in "$HOME/.nvm/versions/node/v$NODE_VERSION" "$HOME/.nvm/versions/node/$NODE_VERSION"; do
        if [ -x "$CANDIDATE/bin/node" ]; then
            NODE_BIN_DIR="$CANDIDATE/bin"
            break
        fi
    done
    if [ -z "$NODE_BIN_DIR" ] && [ "$NODE_VERSION" = "$NODE_MAJOR" ]; then
        for CANDIDATE in "$HOME/.nvm/versions/node/v$NODE_MAJOR".* "$HOME/.nvm/versions/node/$NODE_MAJOR".*; do
            if [ -x "$CANDIDATE/bin/node" ]; then
                NODE_BIN_DIR="$CANDIDATE/bin"
                break
            fi
        done
    fi
fi

if [ -z "$NODE_BIN_DIR" ] && [ -n "$NODE_MAJOR" ]; then
    for CANDIDATE in "/opt/homebrew/opt/node@$NODE_MAJOR/bin" "/usr/local/opt/node@$NODE_MAJOR/bin"; do
        if [ -x "$CANDIDATE/node" ]; then
            NODE_BIN_DIR="$CANDIDATE"
            break
        fi
    done
fi

if [ -n "$NODE_BIN_DIR" ]; then
    export PATH="$NODE_BIN_DIR:/opt/homebrew/bin:/usr/local/bin:$PATH"
else
    export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    show_error "Hilt needs Node.js $NODE_VERSION and npm. Install dependencies, run npm install, then open Hilt again."
    exit 1
fi

export HILT_EXPECTED_NODE_MAJOR="$NODE_MAJOR"
APP_MODE="PLACEHOLDER_APP_MODE"

if ! node -e "const major = Number(process.versions.node.split('.')[0]); if (major !== Number(process.env.HILT_EXPECTED_NODE_MAJOR)) process.exit(1)" >/dev/null 2>&1; then
    show_error "Hilt expects Node.js $NODE_VERSION from .nvmrc. Run npm run doctor:local from Terminal for setup details."
    exit 1
fi

if ! node -e "require('electron')" >/dev/null 2>&1; then
    show_error "Hilt's Electron install is incomplete. Run npm install, then run npm run doctor:local."
    exit 1
fi

if ! node -e "require('better-sqlite3')" >/dev/null 2>&1; then
    show_error "Hilt's native dependencies are not built for this Node version. Run npm install with Node.js $NODE_VERSION, then run npm run doctor:local."
    exit 1
fi

if [ -f "$PROJECT_DIR/package-lock.json" ] && { [ ! -f "$PROJECT_DIR/node_modules/.package-lock.json" ] || [ "$PROJECT_DIR/package-lock.json" -nt "$PROJECT_DIR/node_modules/.package-lock.json" ]; }; then
    show_error "Hilt dependencies are older than package-lock.json. Run npm install with Node.js $NODE_VERSION, then reopen Hilt."
    exit 1
fi

if [ ! -x "$PROJECT_DIR/node_modules/.bin/electron" ]; then
    show_error "Hilt's local Electron dependency is missing. Run npm install, then run npm run app:prod."
    exit 1
fi

if [ ! -f "$PROJECT_DIR/electron/launcher.cjs" ]; then
    show_error "Hilt could not find its Electron launcher at $PROJECT_DIR/electron/launcher.cjs."
    exit 1
fi

if [ "$APP_MODE" = "prod" ] && [ ! -d "$PROJECT_DIR/.next-prod" ]; then
    show_error "Hilt prod mode needs .next-prod. Run npm run app:prod from Terminal."
    exit 1
fi

# Server mode baked at app-creation time: "prod" serves the .next-prod build
# (created by `npm run rebuild`); anything else runs the dev server.
export HILT_APP_MODE="$APP_MODE"

exec "$PROJECT_DIR/node_modules/.bin/electron" "$PROJECT_DIR/electron/launcher.cjs"
LAUNCHER_EOF

# Bake the server mode (npm run app => dev, npm run app:prod => prod)
sed -i '' "s|PLACEHOLDER_APP_MODE|${HILT_APP_MODE:-dev}|g" "$APP_PATH/Contents/MacOS/launcher.sh"

chmod +x "$APP_PATH/Contents/MacOS/launcher.sh"

LAUNCHER_C="$(mktemp "${TMPDIR:-/tmp}/hilt-launcher.XXXXXX.c")"
trap 'rm -f "$LAUNCHER_C"' EXIT

cat > "$LAUNCHER_C" << 'LAUNCHER_C_EOF'
#include <errno.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
    char executablePath[PATH_MAX];
    uint32_t executablePathSize = sizeof(executablePath);

    if (_NSGetExecutablePath(executablePath, &executablePathSize) != 0) {
        fprintf(stderr, "Hilt launcher failed: executable path is too long\n");
        return 1;
    }

    char *lastSlash = strrchr(executablePath, '/');
    if (lastSlash == NULL) {
        fprintf(stderr, "Hilt launcher failed: could not resolve executable directory\n");
        return 1;
    }
    *lastSlash = '\0';

    char scriptPath[PATH_MAX];
    int written = snprintf(scriptPath, sizeof(scriptPath), "%s/launcher.sh", executablePath);
    if (written < 0 || written >= (int)sizeof(scriptPath)) {
        fprintf(stderr, "Hilt launcher failed: launcher script path is too long\n");
        return 1;
    }

    char **childArgv = calloc((size_t)argc + 2, sizeof(char *));
    if (childArgv == NULL) {
        fprintf(stderr, "Hilt launcher failed: could not allocate argv\n");
        return 1;
    }

    childArgv[0] = "/bin/bash";
    childArgv[1] = scriptPath;
    for (int i = 1; i < argc; i++) {
        childArgv[i + 1] = argv[i];
    }
    childArgv[argc + 1] = NULL;

    execv("/bin/bash", childArgv);
    fprintf(stderr, "Hilt launcher failed: %s\n", strerror(errno));
    return 1;
}
LAUNCHER_C_EOF

CLANG_BIN="${CC:-$(command -v clang || true)}"
if [ -z "$CLANG_BIN" ]; then
    echo "Error: clang is required to build the native Hilt.app launcher." >&2
    echo "Install Xcode Command Line Tools, then re-run: npm run app:prod" >&2
    exit 1
fi

"$CLANG_BIN" -Os -mmacosx-version-min=10.15 \
    "$LAUNCHER_C" \
    -o "$APP_PATH/Contents/MacOS/launcher"

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
