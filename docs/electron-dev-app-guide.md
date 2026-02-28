# Self-Contained Electron Dev App (Next.js Inside)

How the Hilt Electron app works and how to replicate this pattern for another project. The goal: a `.app` you double-click from your Dock that runs everything internally — dev server, any background servers, hot reload — with no external terminal windows or processes.

---

## What's Actually Happening

There are **two different `.app` bundles** this project can produce, and they work very differently:

### 1. The Dev App (`dist/Hilt.app` via `create-dev-app.sh`)

This is what you're running day-to-day. It's a **thin shell script disguised as a macOS app** that launches Electron pointing at your live source code.

**How it works:**

```
You double-click Hilt.app
  → macOS runs Contents/MacOS/launcher (a bash script)
    → It cd's to your project directory
    → It runs: node_modules/.bin/electron electron/launcher.cjs
      → launcher.cjs uses tsx to load electron/main.ts directly (no compile step)
        → main.ts checks: is a Next.js dev server already running on ports 3000-3004?
          → YES: reuses it (you had `npm run dev` in a terminal)
          → NO: spawns `npm run dev --port <port>` as a child process
        → main.ts spawns any other background servers as child processes
        → Creates a BrowserWindow pointing at http://localhost:<port>
        → You see your app with full hot reload
```

**The `.app` bundle itself is tiny** — it's just:
```
Hilt.app/
  Contents/
    Info.plist          (app metadata, icon reference)
    MacOS/launcher      (bash script that runs Electron)
    Resources/icon.icns (your app icon)
```

It references your project directory by absolute path. The actual code, node_modules, everything lives in your normal working directory. That's why edits to your source files show up immediately — Electron is loading your dev server which is watching your real source files.

### 2. The Production App (`dist/mac-arm64/Hilt.app` via `electron-builder`)

This is a fully packaged, distributable app. It bundles a pre-built Next.js standalone server + all dependencies inside the `.app`. No hot reload, no source code references. This is what you'd ship to users.

---

## How to Replicate the Dev App Pattern

### Prerequisites

Your project needs:
- A Next.js app (or any web app with a dev server)
- Electron as a dev dependency
- `tsx` for running TypeScript without a compile step

```bash
npm install --save-dev electron tsx
```

### Step 1: The Launcher Entry Point

Create `electron/launcher.cjs`:
```js
// Uses tsx to load TypeScript directly — no compile step needed for dev
require("tsx/cjs");
require("./main.ts");
```

This is the key trick for dev mode: `tsx` transpiles TypeScript on-the-fly, so you never need to run a build step for your Electron code during development.

### Step 2: The Main Process (`electron/main.ts`)

This is the brain. It needs to:

1. **Find or start your dev server**
2. **Start any background servers** (WebSocket, API, etc.)
3. **Create a BrowserWindow pointing at localhost**
4. **Kill child processes on exit**

```typescript
import { app, BrowserWindow, shell } from "electron";
import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import * as net from "net";
import * as http from "http";

let mainWindow: BrowserWindow | null = null;
let devServer: ChildProcess | null = null;

// Find an open port starting from startPort
async function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const port = server.address()!.port;
      server.close(() => resolve(port));
    });
    server.on("error", () => resolve(findAvailablePort(startPort + 1)));
  });
}

// Check if a dev server is already responding on a port
async function checkDevServer(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: "localhost", port, path: "/", method: "GET", timeout: 2000 },
      (res) => {
        const ct = res.headers["content-type"] || "";
        resolve(res.statusCode! >= 200 && res.statusCode! < 300 && ct.includes("text/html"));
        res.resume();
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end();
  });
}

// Poll until server responds or timeout
async function waitForServer(port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkDevServer(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function startDevServer(): Promise<number> {
  // First, check if a dev server is already running (e.g., from a terminal)
  for (const port of [3000, 3001, 3002, 3003, 3004]) {
    if (await checkDevServer(port)) {
      console.log(`Found existing dev server on port ${port}`);
      return port;
    }
  }

  // No server found — start one as a child process
  const port = await findAvailablePort(3000);
  const projectDir = path.resolve(__dirname, "..");

  devServer = spawn("npm", ["run", "dev", "--", "--port", String(port)], {
    cwd: projectDir,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false, // Dies when Electron dies
  });

  devServer.stdout?.on("data", (d: Buffer) => console.log("[Dev]", d.toString().trim()));
  devServer.stderr?.on("data", (d: Buffer) => console.error("[Dev]", d.toString().trim()));
  devServer.on("close", () => { devServer = null; });

  // Wait up to 60s for the server to respond
  const ready = await waitForServer(port, 60000);
  if (!ready) console.error("Dev server didn't start in time, trying anyway...");

  return port;
}

async function createWindow() {
  const port = await startDevServer();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    titleBarStyle: "hiddenInset",           // macOS frameless with traffic lights
    trafficLightPosition: { x: 16, y: 14 }, // Fine-tune traffic light placement
    backgroundColor: "#0a0a0a",              // Prevent white flash on load
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  // Open external links in the default browser, not inside Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://localhost")) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

// --- App lifecycle ---
app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (devServer) { devServer.kill(); devServer = null; }
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (mainWindow === null) createWindow();
});

app.on("before-quit", () => {
  if (devServer) devServer.kill();
});
```

**Key design decisions:**
- `detached: false` — child processes die when Electron dies (no orphans)
- Check for existing server first — so you can run `npm run dev` in a terminal and Electron just attaches to it, or launch the app cold and it starts everything itself
- `stdio: ["ignore", "pipe", "pipe"]` — no stdin (it's a background process), but capture stdout/stderr for logging

### Step 3: The Preload Script (`electron/preload.ts`)

Minimal secure bridge between main and renderer:

```typescript
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  // Add any IPC handlers you need here
});
```

### Step 4: The Dev App Shell Script (`scripts/create-dev-app.sh`)

This creates the clickable `.app` bundle:

```bash
#!/bin/bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="YourApp"
APP_PATH="$PROJECT_DIR/dist/$APP_NAME.app"

echo "Creating $APP_NAME.app..."

mkdir -p "$APP_PATH/Contents/MacOS"
mkdir -p "$APP_PATH/Contents/Resources"

# Info.plist — tells macOS this is an app and what to run
cat > "$APP_PATH/Contents/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>launcher</string>
    <key>CFBundleIconFile</key>
    <string>icon</string>
    <key>CFBundleIdentifier</key>
    <string>com.yourapp.dev</string>
    <key>CFBundleName</key>
    <string>YourApp</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleVersion</key>
    <string>1.0</string>
</dict>
</plist>
EOF

# The launcher — a bash script that starts Electron
cat > "$APP_PATH/Contents/MacOS/launcher" << 'LAUNCHER_EOF'
#!/bin/bash
PROJECT_DIR="PLACEHOLDER_PROJECT_DIR"
cd "$PROJECT_DIR"

# Finder doesn't inherit your shell PATH, so we need to find node manually
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
if [ -d "$HOME/.nvm/versions/node" ]; then
    NODE_DIR=$(ls -1 "$HOME/.nvm/versions/node" | tail -1)
    if [ -n "$NODE_DIR" ]; then
        export PATH="$HOME/.nvm/versions/node/$NODE_DIR/bin:$PATH"
    fi
fi

exec "$PROJECT_DIR/node_modules/.bin/electron" "$PROJECT_DIR/electron/launcher.cjs"
LAUNCHER_EOF

# Inject the actual project path
sed -i '' "s|PLACEHOLDER_PROJECT_DIR|$PROJECT_DIR|g" "$APP_PATH/Contents/MacOS/launcher"
chmod +x "$APP_PATH/Contents/MacOS/launcher"

# Copy icon if it exists
if [ -f "$PROJECT_DIR/build/icon.icns" ]; then
    cp "$PROJECT_DIR/build/icon.icns" "$APP_PATH/Contents/Resources/icon.icns"
fi

echo "Created: $APP_PATH"
open -R "$APP_PATH"
```

**Critical detail: the PATH setup.** When you double-click an app from Finder/Dock, it does NOT get your shell's PATH. It gets the bare macOS system PATH. So the launcher must explicitly add `/opt/homebrew/bin` (Apple Silicon), `/usr/local/bin` (Intel), and your nvm node directory. Without this, `node` and `electron` won't be found and the app silently fails to launch.

### Step 5: Package.json Scripts

```json
{
  "main": "electron/main.js",
  "scripts": {
    "dev": "next dev --turbopack",
    "electron:create-dev-app": "bash scripts/create-dev-app.sh"
  }
}
```

The `"main"` field tells Electron where to find the main process. Even though we use `launcher.cjs` → `tsx` → `main.ts` in dev, electron-builder uses the compiled `main.js` for production builds.

### Step 6: Generate It

```bash
# Generate the icon (see macos-icon-generation.md)
node scripts/generate-icons.mjs

# Create the dev app
npm run electron:create-dev-app

# The app appears in dist/YourApp.app — drag it to your Dock
```

---

## Why This Works (The Mental Model)

The dev app is essentially this chain:

```
macOS Dock click
  → bash script (disguised as .app)
    → Electron (a Chromium shell)
      → spawns your dev server as a child process
      → opens a BrowserWindow pointing at localhost
        → your Next.js app with full HMR/hot reload
```

It feels "self-contained" because:
1. **No visible terminal** — Electron spawns the dev server as a background child process with piped stdio
2. **No external processes** — everything is a child of the Electron process, killed when you quit
3. **Live reload works** — because it's literally running `next dev` (or your equivalent), which watches your source files

It's NOT actually a production build. It's your dev server running inside a native window instead of a browser tab. That's the whole trick.

---

## Production Build (For Distribution)

If you also want a fully self-contained production app (no source code dependency):

### next.config.ts
```typescript
const config = {
  output: "standalone",  // This is the key setting
  // ... rest of config
};
```

### Build pipeline
```bash
# 1. Build Next.js (creates .next/standalone/ with embedded server)
npm run build

# 2. Copy static assets into standalone (Next.js doesn't do this automatically)
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public

# 3. Compile Electron TypeScript to JS
tsc -p electron/tsconfig.json

# 4. Package with electron-builder
electron-builder --mac
```

### electron-builder.yml
```yaml
appId: com.yourapp.app
productName: YourApp
directories:
  output: dist
  buildResources: build

files:
  - ".next/**/*"
  - "electron/**/*.js"
  - "server/**/*"
  - "public/**/*"
  - "package.json"
  - "node_modules/**/*"

mac:
  target:
    - target: dmg
      arch: [arm64, x64]
  category: public.app-category.developer-tools
  icon: build/icon.icns
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
```

### Entitlements (`build/entitlements.mac.plist`)
Required for Node.js to run inside a hardened macOS app:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.allow-dyld-environment-variables</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.network.server</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
</dict>
</plist>
```

In production mode, `main.ts` detects `app.isPackaged === true` and starts the standalone server from `process.resourcesPath/app/.next/standalone/server.js` instead of running `npm run dev`.

---

## Common Pitfalls

1. **App launches but shows a blank white window** — The dev server hasn't started yet. Add a loading screen or increase the wait timeout. Hilt waits up to 60 seconds.

2. **App won't launch from Dock (works from terminal)** — PATH issue. Finder doesn't inherit your shell PATH. The launcher script must explicitly set up PATH for node/nvm/homebrew.

3. **"npm" not found errors** — Same PATH issue. Make sure the launcher adds both `/opt/homebrew/bin` and `/usr/local/bin` and checks for nvm.

4. **Orphan processes after quitting** — Use `detached: false` when spawning child processes, and kill them in both `window-all-closed` and `before-quit` handlers.

5. **Port conflicts** — Use the port-scanning pattern: check 3000-3004 for an existing server, then `findAvailablePort()` for a fresh one.

6. **Icon doesn't show in Dock** — The `.icns` must be at `Contents/Resources/icon.icns` and `Info.plist` must have `CFBundleIconFile` set to `icon` (no extension).
