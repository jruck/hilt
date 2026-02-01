# Electron Dev Launcher Redesign

## Problem Statement

The current dev launcher experience has several issues:

1. **Visible Terminal window spawns** - When Hilt.app opens, it uses `osascript` to open Terminal.app and run `npm run dev`, which is visually intrusive

2. **Two apps appear** - User sees Terminal + Electron as separate apps in dock/cmd-tab

3. **Unpredictable behavior** - Sometimes another Electron instance spawns alongside the main one

4. **Lifecycle management** - Servers don't cleanly stop when app quits unless manually terminated

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ dist/Hilt.app/Contents/MacOS/launcher (bash)                    │
├─────────────────────────────────────────────────────────────────┤
│ 1. Check for existing dev server on ports 3000-3003             │
│ 2. If none found:                                               │
│    → osascript "tell Terminal to do script 'npm run dev'"       │
│    → Wait up to 60s for server                                  │
│ 3. exec electron electron/launcher.cjs                          │
│    → launcher.cjs requires tsx and main.ts                      │
│    → main.ts creates BrowserWindow, loads localhost:PORT        │
└─────────────────────────────────────────────────────────────────┘

Result: Terminal.app (visible) + Electron.app (visible)
```

## Desired Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ dist/Hilt.app/Contents/MacOS/launcher (bash)                    │
├─────────────────────────────────────────────────────────────────┤
│ 1. Check for existing dev server on ports 3000-3003             │
│ 2. exec electron electron/launcher.cjs (always)                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ electron/main.ts (development mode)                             │
├─────────────────────────────────────────────────────────────────┤
│ 1. Check for existing dev server                                │
│ 2. If none: spawn dev server as background child process        │
│    → npm run dev (detached: false, stdio: 'pipe')               │
│    → Log output to file: ~/.hilt/dev-server.log                 │
│ 3. Create BrowserWindow                                         │
│ 4. On app quit: kill child processes                            │
└─────────────────────────────────────────────────────────────────┘

Result: Single Hilt.app (visible)
```

## Implementation Plan

### Phase 1: Update main.ts to manage dev server

**Changes to `startNextServer()` in main.ts:**

```typescript
async function startNextServer(): Promise<number> {
  const isPackaged = app.isPackaged;

  // Development mode: manage our own dev server
  if (!isPackaged) {
    // First check if a dev server is already running
    const existingPort = await findExistingDevServer([3000, 3001, 3002, 3003]);
    if (existingPort) {
      console.log(`Found existing dev server on port ${existingPort}`);
      serverPort = existingPort;
      return existingPort;
    }

    // No server running - start one as child process
    const port = await findAvailablePort(3000);
    console.log(`Starting dev server on port ${port}...`);

    nextServer = spawn("npm", ["run", "dev", "--", "--port", String(port)], {
      cwd: app.getAppPath(), // or project root
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false, // Dies when parent dies
    });

    // Log output to file
    const logPath = path.join(app.getPath('userData'), 'dev-server.log');
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    nextServer.stdout?.pipe(logStream);
    nextServer.stderr?.pipe(logStream);

    // Wait for server to be ready
    await waitForServer(port, 60000);
    serverPort = port;
    return port;
  }

  // Production mode: unchanged
  // ...
}

async function findExistingDevServer(ports: number[]): Promise<number | null> {
  for (const port of ports) {
    try {
      const response = await fetch(`http://localhost:${port}`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(2000)
      });
      if (response.ok) return port;
    } catch {}
  }
  return null;
}
```

### Phase 2: Simplify the bash launcher

**New `dist/Hilt.app/Contents/MacOS/launcher`:**

```bash
#!/bin/bash
# Hilt Dev Launcher - delegates server management to Electron

PROJECT_DIR="/Users/jruck/bridge/tools/hilt"
cd "$PROJECT_DIR"

# Add nvm node to PATH
if [ -d "$HOME/.nvm/versions/node" ]; then
    NODE_DIR=$(ls -1 "$HOME/.nvm/versions/node" | tail -1)
    [ -n "$NODE_DIR" ] && export PATH="$HOME/.nvm/versions/node/$NODE_DIR/bin:$PATH"
fi

# Let Electron handle everything
exec "$PROJECT_DIR/node_modules/.bin/electron" "$PROJECT_DIR/electron/launcher.cjs"
```

### Phase 3: Add dev server status to UI (optional)

Could add a subtle indicator in the app showing:
- Dev server status (running/starting/error)
- Port number
- Link to view logs

## Trade-offs

| Approach | Pros | Cons |
|----------|------|------|
| **Current (Terminal.app)** | Visible server output, can interact | Intrusive, two apps, manual cleanup |
| **Background child process** | Clean UX, auto-cleanup | Hidden output (need log viewer) |
| **Embedded in Electron** | Most integrated | Complex, harder to debug |

## Migration Steps

1. Update main.ts with dev server management
2. Simplify bash launcher
3. Test: cold start (no server), warm start (server running)
4. Test: app quit kills server
5. Regenerate dev app bundle

## Open Questions

1. **Log viewing** - Should we add a "View Dev Server Logs" menu item or keep it simple?
2. **Port file** - Keep `.dev-port` for external tools to find the port?
3. **Multiple instances** - What if user opens Hilt.app twice? (Currently not handled well)

## Recommendation

Go with **Phase 1 + Phase 2** initially. Skip the UI indicator unless you find yourself needing to debug the dev server frequently.

The key insight: main.ts already has the pattern for managing a child process (it does this in production mode). We just need to extend that same pattern to development mode instead of relying on Terminal.app.
