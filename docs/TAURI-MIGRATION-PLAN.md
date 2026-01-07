# Tauri Migration Implementation Plan

This document provides a detailed implementation plan for migrating Claude Kanban from a Next.js + WebSocket server architecture to a Tauri native desktop application.

## Executive Summary

**Current Architecture**: Next.js (port 3000) + WebSocket server (port 3001) + node-pty for terminal emulation

**Target Architecture**: Tauri app with Rust backend handling all system operations, React frontend via WebView

**Estimated Effort**: 4-6 weeks for one developer

**Critical Blocker**: PTY support requires a Tauri plugin or alternative approach (see Phase 2)

**Key Feature**: Dev Mode with hot-reload for users who want to customize (see Dev Mode Architecture)

---

## Dev Mode Architecture

Since Claude Kanban users are developers who likely want to customize the app, we should make dev mode a first-class experience with a native macOS menu toggle.

### How Tauri Dev Mode Works

Tauri supports two modes of operation:

| Mode | How It Works | Use Case |
|------|--------------|----------|
| **Production** | WebView loads static files from `frontendDist` | Normal app usage |
| **Dev Mode** | WebView connects to `devUrl` (e.g., `localhost:3000`) | Live editing with HMR |

In dev mode, Tauri's `build.devUrl` points to your Next.js dev server. Changes to React components hot-reload instantly without rebuilding the Rust backend.

### User-Controlled Dev Mode Toggle

We'll add a **"Developer" menu** to the macOS menu bar with a toggle to switch between production and dev mode at runtime.

```
┌─────────────────────────────────────────────────────────┐
│ Claude Kanban  File  Edit  View  Developer  Window  Help │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │ ✓ Dev Mode          │  ← Toggle checkbox
                    │   ─────────────────  │
                    │   Open in Browser   │
                    │   Reload Frontend   │
                    │   ─────────────────  │
                    │   Start Dev Server  │
                    │   View Logs         │
                    └─────────────────────┘
```

### Implementation

**1. Menu Creation (`src-tauri/src/menu.rs`)**

```rust
use tauri::{
    menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    AppHandle, Manager, Wry,
};

pub fn create_app_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<Wry>> {
    // Developer menu with dev mode toggle
    let dev_mode_toggle = CheckMenuItemBuilder::with_id("dev_mode", "Dev Mode")
        .accelerator("Cmd+Shift+D")
        .checked(false)  // Start in production mode
        .build(app)?;

    let open_browser = MenuItemBuilder::with_id("open_browser", "Open in Browser")
        .accelerator("Cmd+Shift+B")
        .build(app)?;

    let reload = MenuItemBuilder::with_id("reload_frontend", "Reload Frontend")
        .accelerator("Cmd+R")
        .build(app)?;

    let start_dev_server = MenuItemBuilder::with_id("start_dev_server", "Start Dev Server")
        .build(app)?;

    let view_logs = MenuItemBuilder::with_id("view_logs", "View Logs")
        .build(app)?;

    let developer_menu = SubmenuBuilder::new(app, "Developer")
        .item(&dev_mode_toggle)
        .separator()
        .item(&open_browser)
        .item(&reload)
        .separator()
        .item(&start_dev_server)
        .item(&view_logs)
        .build()?;

    // Standard menus
    let app_menu = SubmenuBuilder::new(app, "Claude Kanban")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&reload)
        .separator()
        .fullscreen()
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .zoom()
        .separator()
        .close_window()
        .build()?;

    MenuBuilder::new(app)
        .item(&app_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&developer_menu)
        .item(&window_menu)
        .build()
}
```

**2. Dev Mode State Management (`src-tauri/src/dev_mode.rs`)**

```rust
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

pub struct DevModeState {
    pub enabled: Mutex<bool>,
    pub dev_server: Mutex<Option<Child>>,
}

impl Default for DevModeState {
    fn default() -> Self {
        Self {
            enabled: Mutex::new(false),
            dev_server: Mutex::new(None),
        }
    }
}

const DEV_URL: &str = "http://localhost:3000";
const PROD_DIST: &str = "../out";  // Static export directory

/// Toggle dev mode on/off
pub fn toggle_dev_mode(app: &AppHandle, state: &DevModeState) -> Result<bool, String> {
    let mut enabled = state.enabled.lock().unwrap();
    *enabled = !*enabled;
    let is_dev = *enabled;
    drop(enabled);

    // Reload the main window with new URL
    if let Some(window) = app.get_webview_window("main") {
        let url = if is_dev {
            WebviewUrl::External(DEV_URL.parse().unwrap())
        } else {
            WebviewUrl::App("index.html".into())
        };

        // Navigate to new URL
        window.navigate(url.into());

        // Notify frontend of mode change
        let _ = app.emit("dev-mode-changed", is_dev);
    }

    // Update menu checkbox state
    if let Some(menu) = app.menu() {
        if let Some(item) = menu.get("dev_mode") {
            if let Some(check_item) = item.as_check_menuitem() {
                let _ = check_item.set_checked(is_dev);
            }
        }
    }

    Ok(is_dev)
}

/// Start the Next.js dev server
pub fn start_dev_server(state: &DevModeState) -> Result<(), String> {
    let mut server = state.dev_server.lock().unwrap();

    // Kill existing server if running
    if let Some(mut child) = server.take() {
        let _ = child.kill();
    }

    // Start new dev server
    let child = Command::new("npm")
        .args(["run", "dev"])
        .current_dir(env!("CARGO_MANIFEST_DIR").to_string() + "/..")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start dev server: {}", e))?;

    *server = Some(child);
    Ok(())
}

/// Open current view in default browser
pub fn open_in_browser(state: &DevModeState) -> Result<(), String> {
    let enabled = state.enabled.lock().unwrap();
    let url = if *enabled { DEV_URL } else { "http://localhost:1430" };

    open::that(url).map_err(|e| e.to_string())
}
```

**3. Menu Event Handler (`src-tauri/src/main.rs`)**

```rust
use crate::dev_mode::{DevModeState, toggle_dev_mode, start_dev_server, open_in_browser};
use crate::menu::create_app_menu;

fn main() {
    tauri::Builder::default()
        .manage(DevModeState::default())
        .setup(|app| {
            let menu = create_app_menu(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let state = app.state::<DevModeState>();

            match event.id().0.as_str() {
                "dev_mode" => {
                    if let Ok(is_dev) = toggle_dev_mode(app, &state) {
                        println!("Dev mode: {}", if is_dev { "enabled" } else { "disabled" });
                    }
                }
                "open_browser" => {
                    let _ = open_in_browser(&state);
                }
                "reload_frontend" => {
                    if let Some(window) = app.get_webview_window("main") {
                        // Trigger page reload via JavaScript
                        let _ = window.eval("window.location.reload()");
                    }
                }
                "start_dev_server" => {
                    if let Err(e) = start_dev_server(&state) {
                        eprintln!("Error starting dev server: {}", e);
                    }
                }
                "view_logs" => {
                    // Open logs directory or dev tools
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.open_devtools();
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### User Workflow

**For Normal Users:**
1. Download and run the app (production mode by default)
2. Everything works out of the box

**For Developers Customizing the App:**
1. Clone the repo: `git clone https://github.com/you/claude-kanban`
2. Install dependencies: `npm install`
3. Run the app: `npm run tauri:dev` (starts in dev mode)
4. Edit React components → instant hot-reload
5. Edit Rust backend → auto-recompile

**Switching Modes at Runtime:**
1. Open the app (any mode)
2. Click **Developer → Dev Mode** (or press `⌘⇧D`)
3. App switches to dev server URL
4. If dev server isn't running, click **Developer → Start Dev Server**
5. Toggle off to return to production

### Dev Mode Indicator

Add a visual indicator in the UI when dev mode is active:

```typescript
// src/components/DevModeIndicator.tsx
import { listen } from '@tauri-apps/api/event';
import { useState, useEffect } from 'react';

export function DevModeIndicator() {
  const [isDev, setIsDev] = useState(false);

  useEffect(() => {
    // Check initial state
    const checkDevMode = async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const devMode = await invoke<boolean>('is_dev_mode');
      setIsDev(devMode);
    };
    checkDevMode();

    // Listen for changes
    const unlisten = listen<boolean>('dev-mode-changed', (event) => {
      setIsDev(event.payload);
    });

    return () => { unlisten.then(fn => fn()); };
  }, []);

  if (!isDev) return null;

  return (
    <div className="fixed bottom-4 left-4 px-2 py-1 bg-amber-500 text-black text-xs font-medium rounded">
      DEV MODE
    </div>
  );
}
```

### Configuration Persistence

Save dev mode preference to persist across restarts:

```rust
// In dev_mode.rs
use std::fs;
use std::path::PathBuf;

fn get_config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_default()
        .join("claude-kanban")
        .join("dev-mode.json")
}

pub fn load_dev_mode_preference() -> bool {
    fs::read_to_string(get_config_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(false)
}

pub fn save_dev_mode_preference(enabled: bool) {
    let path = get_config_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&path, serde_json::to_string(&enabled).unwrap());
}
```

### Benefits of This Approach

1. **Zero friction for normal users** - App works out of the box
2. **First-class dev experience** - Hot-reload without terminal juggling
3. **Native integration** - Uses macOS menu bar, not custom UI
4. **Discoverable** - Developers will naturally explore the menu
5. **Keyboard shortcut** - `⌘⇧D` for quick toggle
6. **Persistent preference** - Remembers your choice

---

## Current System Analysis

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (localhost:3000)                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Next.js 16 + React 19                                   │   │
│  │  ├── Board.tsx (main container)                         │   │
│  │  ├── Terminal.tsx (xterm.js via WebSocket)              │   │
│  │  └── SWR polling (5-second refresh)                     │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
          │ HTTP/REST                    │ WebSocket
          ▼                              ▼
┌──────────────────┐           ┌──────────────────┐
│  Next.js API     │           │  ws-server.ts    │
│  (port 3000)     │           │  (port 3001)     │
│  10 routes       │           │  PTY management  │
│  ~1000 lines     │           │  367 lines       │
└──────────────────┘           └──────────────────┘
          │                              │
          ▼                              ▼
┌──────────────────┐           ┌──────────────────┐
│  ~/.claude/      │           │  node-pty        │
│  projects/*.jsonl│           │  (native module) │
│  plans/*.md      │           │  246 lines       │
└──────────────────┘           └──────────────────┘
```

### Key Dependencies

| Dependency | Version | Purpose | Tauri Impact |
|-----------|---------|---------|--------------|
| `@cdktf/node-pty-prebuilt-multiarch` | 0.10.2 | PTY spawning | **CRITICAL** - No Tauri equivalent |
| `ws` | 8.18.3 | WebSocket | Replaced by Tauri IPC |
| `chokidar` | 5.0.0 | File watching | Tauri fs-watch plugin |
| `xterm.js` | 5.5.0 | Terminal UI | Keep as-is |
| `next` | 16.1.0 | Framework | Static export only |
| `swr` | 2.3.8 | Data fetching | Keep for UI state |

### Node.js APIs Currently Used

| File | APIs | Lines | Migration Difficulty |
|------|------|-------|---------------------|
| `server/ws-server.ts` | ws, http, fs, path, chokidar | 367 | High - Core server |
| `src/lib/pty-manager.ts` | node-pty, fs, EventEmitter | 246 | **Critical** - PTY |
| `src/lib/claude-sessions.ts` | fs, path, readline, chokidar | 471 | Medium - File parsing |
| `src/lib/db.ts` | fs, path | 205 | Low - Simple JSON I/O |
| `src/app/api/folders/route.ts` | fs, path, child_process | 160 | Medium - Native APIs |
| `src/app/api/sessions/route.ts` | fs (indirect) | 194 | Medium |
| `src/app/api/inbox/route.ts` | fs (indirect) | 176 | Medium |
| `src/app/api/plans/[slug]/route.ts` | fs/promises | 81 | Low |
| `src/app/api/reveal/route.ts` | child_process | 28 | Low - Shell command |
| `src/app/api/youtube-transcript/route.ts` | child_process | 57 | Low - Shell command |

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Tauri WebView                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  React 19 (static build)                                 │   │
│  │  ├── Board.tsx (unchanged)                              │   │
│  │  ├── Terminal.tsx (xterm.js via Tauri IPC)              │   │
│  │  └── Tauri invoke() instead of fetch()                  │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
          │ Tauri IPC (invoke/listen)
          ▼
┌─────────────────────────────────────────────────────────────────┐
│  Tauri Rust Backend (src-tauri/)                                │
│  ├── commands/                                                  │
│  │   ├── sessions.rs    - Session CRUD                         │
│  │   ├── inbox.rs       - Draft prompts                        │
│  │   ├── folders.rs     - Scope navigation                     │
│  │   ├── plans.rs       - Plan files                           │
│  │   └── terminal.rs    - PTY management                       │
│  ├── services/                                                  │
│  │   ├── session_parser.rs  - JSONL parsing                    │
│  │   ├── db.rs              - JSON persistence                 │
│  │   ├── file_watcher.rs    - File system events               │
│  │   └── pty.rs             - PTY spawning (plugin)            │
│  └── main.rs                                                    │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  ~/.claude/      │  │  data/           │  │  PTY processes   │
│  projects/*.jsonl│  │  session-status  │  │  (claude CLI)    │
│  plans/*.md      │  │  .json           │  │                  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

---

## Phase 1: Project Setup & Foundation (Week 1)

### 1.1 Initialize Tauri Project

```bash
# Install Tauri CLI
npm install -D @tauri-apps/cli

# Initialize Tauri in existing project
npx tauri init
```

**Configuration (`src-tauri/tauri.conf.json`)**:
```json
{
  "productName": "Claude Kanban",
  "identifier": "com.claudekanban.app",
  "build": {
    "beforeBuildCommand": "npm run build:tauri",
    "beforeDevCommand": "npm run dev:tauri",
    "frontendDist": "../out",
    "devUrl": "http://localhost:3000"
  },
  "app": {
    "windows": [{
      "title": "Claude Kanban",
      "width": 1400,
      "height": 900,
      "minWidth": 1000,
      "minHeight": 600,
      "decorations": true,
      "transparent": false
    }],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["dmg", "app"],
    "icon": ["icons/icon.icns"],
    "macOS": {
      "entitlements": null,
      "minimumSystemVersion": "10.15"
    }
  }
}
```

### 1.2 Configure Next.js for Static Export

**Update `next.config.ts`**:
```typescript
const nextConfig = {
  output: 'export',
  distDir: 'out',
  images: {
    unoptimized: true,
  },
  // Disable server-side features
  experimental: {
    // Force client-side only
  },
};
```

**Add new npm scripts to `package.json`**:
```json
{
  "scripts": {
    "build:tauri": "next build",
    "dev:tauri": "next dev --port 3000",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  }
}
```

### 1.3 Create Rust Backend Structure

```
src-tauri/
├── Cargo.toml
├── tauri.conf.json
├── src/
│   ├── main.rs           # Entry point, command registration
│   ├── lib.rs            # Module exports
│   ├── commands/         # Tauri command handlers
│   │   ├── mod.rs
│   │   ├── sessions.rs
│   │   ├── inbox.rs
│   │   ├── folders.rs
│   │   ├── plans.rs
│   │   └── terminal.rs
│   ├── services/         # Business logic
│   │   ├── mod.rs
│   │   ├── session_parser.rs
│   │   ├── db.rs
│   │   ├── file_watcher.rs
│   │   └── pty.rs
│   └── types/            # Shared types
│       ├── mod.rs
│       ├── session.rs
│       └── inbox.rs
└── icons/
    └── icon.icns
```

**`Cargo.toml` dependencies**:
```toml
[dependencies]
tauri = { version = "2", features = ["shell-open"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
notify = "6"           # File watching
dirs = "5"             # Home directory
chrono = "0.4"         # Timestamps
uuid = "1"             # UUID generation
thiserror = "1"        # Error handling
log = "0.4"
env_logger = "0.11"

# For PTY (see Phase 2 options)
# portable-pty = "0.8"  # Option A
```

### 1.4 Basic Tauri Commands

**`src-tauri/src/main.rs`**:
```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod services;
mod types;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::sessions::get_sessions,
            commands::sessions::update_session_status,
            commands::inbox::get_inbox,
            commands::inbox::create_inbox_item,
            commands::inbox::update_inbox_item,
            commands::inbox::delete_inbox_item,
            commands::folders::get_folders,
            commands::folders::get_home_dir,
            commands::plans::get_plan,
            commands::plans::save_plan,
            commands::terminal::spawn_terminal,
            commands::terminal::write_terminal,
            commands::terminal::resize_terminal,
            commands::terminal::kill_terminal,
        ])
        .setup(|app| {
            // Initialize file watcher
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                services::file_watcher::start(handle);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 1.5 Deliverables - Phase 1

- [ ] Tauri project initialized and configured
- [ ] Next.js configured for static export
- [ ] Rust project structure created
- [ ] Basic Tauri commands scaffolded (stubs returning mock data)
- [ ] App launches in dev mode with React frontend
- [ ] CI/CD pipeline updated for Tauri builds

---

## Phase 2: Terminal/PTY Integration (Week 2-3)

**This is the critical path.** node-pty has no direct Tauri equivalent.

### Option A: Use `portable-pty` Rust Crate (Recommended)

The `portable-pty` crate provides cross-platform PTY support in Rust.

**Pros**:
- Pure Rust, no external dependencies
- Cross-platform (macOS, Linux, Windows)
- Well-maintained by Wez (creator of WezTerm)

**Cons**:
- Different API than node-pty
- May have edge cases with shell behavior

**Implementation**:

```rust
// src-tauri/src/services/pty.rs
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

pub struct PtySession {
    pub id: String,
    pub session_id: String,
    pub project_path: String,
    writer: Box<dyn std::io::Write + Send>,
    // Reader handled separately via channel
}

pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
    pty_system: NativePtySystem,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            pty_system: NativePtySystem::default(),
        }
    }

    pub fn spawn(
        &self,
        terminal_id: &str,
        session_id: &str,
        project_path: &str,
        is_new: bool,
        initial_prompt: Option<String>,
        data_tx: mpsc::Sender<(String, String)>, // (terminal_id, data)
    ) -> Result<(), String> {
        let pair = self.pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

        let mut cmd = CommandBuilder::new(&shell);
        cmd.cwd(project_path);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        // Start reader thread
        let tid = terminal_id.to_string();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = data_tx.blocking_send((tid.clone(), data));
                    }
                    Err(_) => break,
                }
            }
        });

        // Store session
        let session = PtySession {
            id: terminal_id.to_string(),
            session_id: session_id.to_string(),
            project_path: project_path.to_string(),
            writer,
        };
        self.sessions.lock().unwrap().insert(terminal_id.to_string(), session);

        // Send initial command
        self.send_initial_command(terminal_id, session_id, is_new, initial_prompt)?;

        Ok(())
    }

    fn send_initial_command(
        &self,
        terminal_id: &str,
        session_id: &str,
        is_new: bool,
        initial_prompt: Option<String>,
    ) -> Result<(), String> {
        std::thread::sleep(std::time::Duration::from_millis(200));

        if is_new {
            self.write(terminal_id, "claude\r")?;
            if let Some(prompt) = initial_prompt {
                // Wait for Claude to be ready, then inject prompt
                // Similar logic to pty-manager.ts
            }
        } else {
            self.write(terminal_id, &format!("claude --resume {}\r", session_id))?;
        }

        Ok(())
    }

    pub fn write(&self, terminal_id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(session) = sessions.get_mut(terminal_id) {
            session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
            session.writer.flush().map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn resize(&self, terminal_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        // portable-pty resize implementation
        Ok(())
    }

    pub fn kill(&self, terminal_id: &str) -> Result<(), String> {
        self.sessions.lock().unwrap().remove(terminal_id);
        Ok(())
    }
}
```

**Tauri Command**:

```rust
// src-tauri/src/commands/terminal.rs
use tauri::{AppHandle, Emitter, State};
use crate::services::pty::PtyManager;

#[tauri::command]
pub async fn spawn_terminal(
    app: AppHandle,
    state: State<'_, PtyManager>,
    terminal_id: String,
    session_id: String,
    project_path: String,
    is_new: bool,
    initial_prompt: Option<String>,
) -> Result<(), String> {
    let (tx, mut rx) = tokio::sync::mpsc::channel(100);

    state.spawn(&terminal_id, &session_id, &project_path, is_new, initial_prompt, tx)?;

    // Forward PTY data to frontend via events
    let handle = app.clone();
    tokio::spawn(async move {
        while let Some((tid, data)) = rx.recv().await {
            let _ = handle.emit("pty-data", serde_json::json!({
                "terminalId": tid,
                "data": data,
            }));
        }
    });

    Ok(())
}

#[tauri::command]
pub fn write_terminal(
    state: State<'_, PtyManager>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    state.write(&terminal_id, &data)
}

#[tauri::command]
pub fn resize_terminal(
    state: State<'_, PtyManager>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.resize(&terminal_id, cols, rows)
}

#[tauri::command]
pub fn kill_terminal(
    state: State<'_, PtyManager>,
    terminal_id: String,
) -> Result<(), String> {
    state.kill(&terminal_id)
}
```

### Option B: Embed Node.js Sidecar

Keep the WebSocket server as a sidecar process.

**Pros**:
- Minimal code changes to existing PTY logic
- Proven working implementation

**Cons**:
- Adds Node.js runtime dependency
- Larger bundle size
- More complex process management

**Implementation**:
1. Bundle `server/ws-server.ts` as a standalone Node.js script
2. Use Tauri's sidecar feature to manage the process
3. Frontend connects to WebSocket as before

### Option C: Terminal-less Mode

Provide a UI without live terminal, just session management.

**Pros**:
- Fastest to implement
- Smallest bundle

**Cons**:
- Major feature regression
- Users must use separate terminal

**Not recommended** unless as fallback.

### 2.1 Frontend Terminal Changes

**Update `src/components/Terminal.tsx`**:

```typescript
// Before: WebSocket
const ws = new WebSocket(`ws://localhost:${wsPort}`);

// After: Tauri IPC
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

useEffect(() => {
  // Spawn terminal via Tauri command
  invoke('spawn_terminal', {
    terminalId,
    sessionId: sessionIdRef.current,
    projectPath,
    isNew: isNewRef.current,
    initialPrompt: initialPromptRef.current,
  });

  // Listen for PTY data events
  const unlisten = listen<{ terminalId: string; data: string }>('pty-data', (event) => {
    if (event.payload.terminalId === terminalId) {
      term.write(event.payload.data);
      // Extract title/context as before
    }
  });

  return () => {
    unlisten.then(fn => fn());
    invoke('kill_terminal', { terminalId });
  };
}, [terminalId, projectPath]);

// Handle user input
const handleData = (data: string) => {
  invoke('write_terminal', { terminalId, data });
};

// Handle resize
const handleResize = (cols: number, rows: number) => {
  invoke('resize_terminal', { terminalId, cols, rows });
};
```

### 2.2 Deliverables - Phase 2

- [ ] PTY approach selected and validated with prototype
- [ ] `PtyManager` implemented in Rust
- [ ] Terminal spawn/write/resize/kill commands working
- [ ] PTY data events forwarded to frontend
- [ ] `Terminal.tsx` updated to use Tauri IPC
- [ ] Title extraction (OSC parsing) working
- [ ] Context progress extraction working
- [ ] Initial prompt injection working for new sessions
- [ ] Session resume (`claude --resume`) working

---

## Phase 3: Session & File Operations (Week 2-3, parallel with Phase 2)

### 3.1 Session Parser (Rust)

**Port `src/lib/claude-sessions.ts` to Rust**:

```rust
// src-tauri/src/services/session_parser.rs
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use chrono::{DateTime, Utc};

#[derive(Debug, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub title: String,
    pub project: String,
    pub project_path: String,
    pub last_activity: DateTime<Utc>,
    pub message_count: u32,
    pub git_branch: Option<String>,
    pub first_prompt: Option<String>,
    pub last_prompt: Option<String>,
    pub slug: Option<String>,
    pub slugs: Vec<String>,
    pub status: String,
    pub sort_order: Option<i32>,
    pub starred: Option<bool>,
    pub is_running: Option<bool>,
    pub plan_slugs: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum JsonlEntry {
    #[serde(rename = "summary")]
    Summary { summary: String },
    #[serde(rename = "user")]
    User {
        timestamp: String,
        message: UserMessage,
        #[serde(rename = "gitBranch")]
        git_branch: Option<String>,
    },
    #[serde(rename = "assistant")]
    Assistant { timestamp: String },
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
struct UserMessage {
    content: String,
}

pub fn get_claude_projects_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".claude")
        .join("projects")
}

pub fn parse_session_file(path: &Path) -> Option<Session> {
    let file = File::open(path).ok()?;
    let reader = BufReader::new(file);

    let filename = path.file_stem()?.to_str()?;
    let id = filename.to_string();

    let mut title: Option<String> = None;
    let mut last_timestamp: Option<DateTime<Utc>> = None;
    let mut message_count = 0u32;
    let mut git_branch: Option<String> = None;
    let mut first_prompt: Option<String> = None;
    let mut last_prompt: Option<String> = None;

    for line in reader.lines().flatten() {
        if let Ok(entry) = serde_json::from_str::<JsonlEntry>(&line) {
            match entry {
                JsonlEntry::Summary { summary } => {
                    title = Some(summary);
                }
                JsonlEntry::User { timestamp, message, git_branch: branch } => {
                    message_count += 1;
                    if first_prompt.is_none() {
                        first_prompt = Some(message.content.clone());
                    }
                    last_prompt = Some(message.content);
                    if let Ok(ts) = timestamp.parse::<DateTime<Utc>>() {
                        last_timestamp = Some(ts);
                    }
                    if branch.is_some() {
                        git_branch = branch;
                    }
                }
                JsonlEntry::Assistant { timestamp } => {
                    message_count += 1;
                    if let Ok(ts) = timestamp.parse::<DateTime<Utc>>() {
                        last_timestamp = Some(ts);
                    }
                }
                JsonlEntry::Other => {}
            }
        }
    }

    // Derive title from first prompt if no summary
    let final_title = title.unwrap_or_else(|| {
        first_prompt.clone()
            .map(|p| p.chars().take(100).collect())
            .unwrap_or_else(|| "Untitled Session".to_string())
    });

    // Derive project path from parent directory
    let parent = path.parent()?;
    let project = parent.file_name()?.to_str()?.to_string();
    let project_path = decode_project_path(&project);

    Some(Session {
        id,
        title: final_title,
        project,
        project_path,
        last_activity: last_timestamp.unwrap_or_else(Utc::now),
        message_count,
        git_branch,
        first_prompt,
        last_prompt,
        slug: None,  // TODO: Extract from session
        slugs: vec![],
        status: "recent".to_string(),
        sort_order: None,
        starred: None,
        is_running: None,
        plan_slugs: None,
    })
}

fn decode_project_path(encoded: &str) -> String {
    // Claude encodes paths by replacing / with -
    // e.g., "-Users-jruck-Work-Code" -> "/Users/jruck/Work/Code"
    if encoded.starts_with('-') {
        encoded.replacen('-', "/", 1).replace('-', "/")
    } else {
        encoded.replace('-', "/")
    }
}

pub fn is_session_running(path: &Path) -> bool {
    const RUNNING_THRESHOLD_MS: u128 = 30_000;

    if let Ok(metadata) = fs::metadata(path) {
        if let Ok(modified) = metadata.modified() {
            if let Ok(duration) = modified.elapsed() {
                return duration.as_millis() < RUNNING_THRESHOLD_MS;
            }
        }
    }
    false
}

pub fn get_all_sessions(scope: Option<&str>, mode: &str) -> Vec<Session> {
    let projects_dir = get_claude_projects_dir();
    let mut sessions = Vec::new();

    if let Ok(entries) = fs::read_dir(&projects_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Ok(files) = fs::read_dir(&path) {
                    for file in files.flatten() {
                        let file_path = file.path();
                        if file_path.extension().map_or(false, |e| e == "jsonl") {
                            if let Some(mut session) = parse_session_file(&file_path) {
                                // Apply scope filter
                                if let Some(scope) = scope {
                                    if mode == "exact" {
                                        if session.project_path != scope {
                                            continue;
                                        }
                                    } else {
                                        // tree mode - prefix match
                                        if !session.project_path.starts_with(scope) {
                                            continue;
                                        }
                                    }
                                }

                                // Check if running
                                session.is_running = Some(is_session_running(&file_path));
                                sessions.push(session);
                            }
                        }
                    }
                }
            }
        }
    }

    // Sort by last activity descending
    sessions.sort_by(|a, b| b.last_activity.cmp(&a.last_activity));
    sessions
}
```

### 3.2 Session Status DB (Rust)

**Port `src/lib/db.ts` to Rust**:

```rust
// src-tauri/src/services/db.rs
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStatus {
    pub status: String,
    pub sort_order: Option<i32>,
    pub starred: Option<bool>,
    pub last_known_mtime: Option<u64>,
}

pub struct SessionStatusDb {
    path: PathBuf,
    data: Mutex<HashMap<String, SessionStatus>>,
}

impl SessionStatusDb {
    pub fn new(data_dir: &PathBuf) -> Self {
        let path = data_dir.join("session-status.json");
        let data = if path.exists() {
            fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            HashMap::new()
        };

        Self {
            path,
            data: Mutex::new(data),
        }
    }

    pub fn get(&self, session_id: &str) -> Option<SessionStatus> {
        self.data.lock().unwrap().get(session_id).cloned()
    }

    pub fn set(&self, session_id: &str, status: SessionStatus) {
        let mut data = self.data.lock().unwrap();
        data.insert(session_id.to_string(), status);
        self.save(&data);
    }

    pub fn update(&self, session_id: &str, updates: SessionStatusUpdate) {
        let mut data = self.data.lock().unwrap();
        let entry = data.entry(session_id.to_string()).or_insert(SessionStatus {
            status: "recent".to_string(),
            sort_order: None,
            starred: None,
            last_known_mtime: None,
        });

        if let Some(status) = updates.status {
            entry.status = status;
        }
        if let Some(sort_order) = updates.sort_order {
            entry.sort_order = Some(sort_order);
        }
        if let Some(starred) = updates.starred {
            entry.starred = Some(starred);
        }

        self.save(&data);
    }

    fn save(&self, data: &HashMap<String, SessionStatus>) {
        if let Ok(json) = serde_json::to_string_pretty(data) {
            let _ = fs::write(&self.path, json);
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct SessionStatusUpdate {
    pub status: Option<String>,
    pub sort_order: Option<i32>,
    pub starred: Option<bool>,
}
```

### 3.3 Tauri Commands for Sessions

```rust
// src-tauri/src/commands/sessions.rs
use tauri::State;
use crate::services::{session_parser, db::SessionStatusDb};

#[derive(serde::Serialize)]
pub struct SessionsResponse {
    sessions: Vec<session_parser::Session>,
    total: usize,
    counts: SessionCounts,
}

#[derive(serde::Serialize)]
pub struct SessionCounts {
    inbox: usize,
    active: usize,
    recent: usize,
}

#[tauri::command]
pub fn get_sessions(
    db: State<'_, SessionStatusDb>,
    scope: Option<String>,
    mode: Option<String>,
) -> Result<SessionsResponse, String> {
    let mode = mode.unwrap_or_else(|| "exact".to_string());
    let mut sessions = session_parser::get_all_sessions(scope.as_deref(), &mode);

    // Merge with status DB
    for session in &mut sessions {
        if let Some(status) = db.get(&session.id) {
            session.status = status.status;
            session.sort_order = status.sort_order;
            session.starred = status.starred;
        }
    }

    let total = sessions.len();
    let counts = SessionCounts {
        inbox: sessions.iter().filter(|s| s.status == "inbox").count(),
        active: sessions.iter().filter(|s| s.status == "active").count(),
        recent: sessions.iter().filter(|s| s.status == "recent").count(),
    };

    Ok(SessionsResponse { sessions, total, counts })
}

#[tauri::command]
pub fn update_session_status(
    db: State<'_, SessionStatusDb>,
    session_id: String,
    status: Option<String>,
    sort_order: Option<i32>,
    starred: Option<bool>,
) -> Result<(), String> {
    db.update(&session_id, crate::services::db::SessionStatusUpdate {
        status,
        sort_order,
        starred,
    });
    Ok(())
}
```

### 3.4 Frontend Changes for Sessions

**Update `src/hooks/useSessions.ts`**:

```typescript
// Before: SWR with fetch
const { data } = useSWR(`/api/sessions?scope=${scope}`, fetcher);

// After: SWR with Tauri invoke
import { invoke } from '@tauri-apps/api/core';

const tauriFetcher = async ([_, scope, mode]: [string, string?, string?]) => {
  return invoke('get_sessions', { scope, mode });
};

export function useSessions(scope?: string) {
  const { data, error, mutate } = useSWR(
    ['sessions', scope, 'exact'],
    tauriFetcher,
    {
      refreshInterval: 5000,
      keepPreviousData: true,
    }
  );

  return {
    sessions: data?.sessions ?? [],
    counts: data?.counts,
    isLoading: !error && !data,
    mutate,
  };
}
```

### 3.5 Deliverables - Phase 3

- [ ] Session parser ported to Rust
- [ ] Session status DB ported to Rust
- [ ] `get_sessions` command working
- [ ] `update_session_status` command working
- [ ] `useSessions` hook using Tauri invoke
- [ ] Session filtering by scope working (exact and tree modes)
- [ ] Running session detection working
- [ ] Plan slugs discovery working

---

## Phase 4: Inbox, Folders, Plans (Week 3-4)

### 4.1 Inbox (Todo.md) Commands

```rust
// src-tauri/src/commands/inbox.rs
use std::fs;
use std::path::PathBuf;

#[derive(serde::Serialize, serde::Deserialize)]
pub struct InboxItem {
    id: String,
    prompt: String,
    completed: bool,
    section: Option<String>,
    project_path: Option<String>,
    created_at: String,
    sort_order: i32,
}

#[tauri::command]
pub fn get_inbox(scope: Option<String>) -> Result<Vec<InboxItem>, String> {
    let todo_path = get_todo_path(scope.as_deref())?;

    if !todo_path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&todo_path).map_err(|e| e.to_string())?;
    parse_todo_md(&content)
}

#[tauri::command]
pub fn create_inbox_item(
    scope: Option<String>,
    prompt: String,
    section: Option<String>,
) -> Result<InboxItem, String> {
    // Implementation mirrors todo-md.ts
    todo!()
}

#[tauri::command]
pub fn update_inbox_item(
    scope: Option<String>,
    id: String,
    prompt: Option<String>,
    completed: Option<bool>,
    section: Option<String>,
) -> Result<(), String> {
    todo!()
}

#[tauri::command]
pub fn delete_inbox_item(scope: Option<String>, id: String) -> Result<(), String> {
    todo!()
}

fn get_todo_path(scope: Option<&str>) -> Result<PathBuf, String> {
    let scope = scope.ok_or("No scope provided")?;
    Ok(PathBuf::from(scope).join("docs").join("Todo.md"))
}

fn parse_todo_md(content: &str) -> Result<Vec<InboxItem>, String> {
    // Port logic from todo-md.ts
    // Parse markdown checkboxes, extract IDs from HTML comments
    todo!()
}
```

### 4.2 Folder Commands

```rust
// src-tauri/src/commands/folders.rs
use std::fs;

#[tauri::command]
pub fn get_folders(scope: Option<String>) -> Result<FoldersResponse, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let projects_dir = home.join(".claude").join("projects");

    let mut folders: Vec<String> = vec![];

    if let Ok(entries) = fs::read_dir(&projects_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or_default();
                let decoded = decode_project_path(name);

                // Apply scope filter
                if let Some(ref scope) = scope {
                    if !decoded.starts_with(scope) {
                        continue;
                    }
                }

                folders.push(decoded);
            }
        }
    }

    folders.sort();
    folders.dedup();

    Ok(FoldersResponse {
        folders,
        home_dir: home.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn get_home_dir() -> String {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct FoldersResponse {
    folders: Vec<String>,
    home_dir: String,
}

fn decode_project_path(encoded: &str) -> String {
    if encoded.starts_with('-') {
        encoded.replacen('-', "/", 1).replace('-', "/")
    } else {
        encoded.replace('-', "/")
    }
}
```

### 4.3 Plan Commands

```rust
// src-tauri/src/commands/plans.rs
use std::fs;
use std::path::PathBuf;

fn get_plans_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".claude")
        .join("plans")
}

#[tauri::command]
pub fn get_plan(slug: String) -> Result<PlanResponse, String> {
    let path = get_plans_dir().join(format!("{}.md", slug));

    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        Ok(PlanResponse {
            exists: true,
            slug,
            content: Some(content),
            path: Some(path.to_string_lossy().to_string()),
        })
    } else {
        Ok(PlanResponse {
            exists: false,
            slug,
            content: None,
            path: None,
        })
    }
}

#[tauri::command]
pub fn save_plan(slug: String, content: String) -> Result<(), String> {
    let dir = get_plans_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let path = dir.join(format!("{}.md", slug));
    fs::write(&path, content).map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(serde::Serialize)]
pub struct PlanResponse {
    exists: bool,
    slug: String,
    content: Option<String>,
    path: Option<String>,
}
```

### 4.4 Deliverables - Phase 4

- [ ] Inbox (Todo.md) parsing ported to Rust
- [ ] Inbox CRUD commands working
- [ ] Folder listing command working
- [ ] Home directory command working
- [ ] Reveal in Finder command working
- [ ] Plan read/write commands working
- [ ] Frontend hooks updated for inbox/folders/plans

---

## Phase 5: File Watching & Real-time Events (Week 4)

### 5.1 File Watcher Service

```rust
// src-tauri/src/services/file_watcher.rs
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::mpsc::channel;
use tauri::{AppHandle, Emitter};

pub fn start(app: AppHandle) {
    let plans_dir = dirs::home_dir()
        .unwrap_or_default()
        .join(".claude")
        .join("plans");

    let (tx, rx) = channel();

    let mut watcher = RecommendedWatcher::new(tx, Config::default()).unwrap();

    if plans_dir.exists() {
        watcher.watch(&plans_dir, RecursiveMode::NonRecursive).ok();
    }

    // Watch for events
    std::thread::spawn(move || {
        for event in rx {
            if let Ok(event) = event {
                match event.kind {
                    notify::EventKind::Create(_) | notify::EventKind::Modify(_) => {
                        for path in event.paths {
                            if path.extension().map_or(false, |e| e == "md") {
                                let slug = path.file_stem()
                                    .and_then(|s| s.to_str())
                                    .unwrap_or_default()
                                    .to_string();

                                let content = std::fs::read_to_string(&path).ok();

                                let _ = app.emit("plan-updated", serde_json::json!({
                                    "slug": slug,
                                    "content": content,
                                    "path": path.to_string_lossy(),
                                }));
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    });

    // Keep watcher alive
    std::mem::forget(watcher);
}
```

### 5.2 Frontend Event Listeners

```typescript
// src/hooks/usePlanWatcher.ts
import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';

interface PlanEvent {
  slug: string;
  content: string;
  path: string;
}

export function usePlanWatcher(onPlanUpdate: (slug: string, content: string) => void) {
  useEffect(() => {
    const unlisten = listen<PlanEvent>('plan-updated', (event) => {
      onPlanUpdate(event.payload.slug, event.payload.content);
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, [onPlanUpdate]);
}
```

### 5.3 Deliverables - Phase 5

- [ ] File watcher service implemented in Rust
- [ ] Plan file events emitted to frontend
- [ ] `usePlanWatcher` hook working
- [ ] Session file changes detected (for running indicator)
- [ ] Events properly cleaned up on window close

---

## Phase 6: Polish & Distribution (Week 5-6)

### 6.1 Remove Dead Code

- [ ] Delete all Next.js API routes (`src/app/api/`)
- [ ] Remove `server/ws-server.ts`
- [ ] Remove WebSocket-related code from `Terminal.tsx`
- [ ] Remove unused dependencies from `package.json`
- [ ] Update all imports

### 6.2 Build Configuration

**`tauri.conf.json` updates**:
```json
{
  "bundle": {
    "active": true,
    "targets": ["dmg", "app"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/icon.icns"
    ],
    "macOS": {
      "entitlements": null,
      "minimumSystemVersion": "10.15",
      "signingIdentity": null,
      "providerShortName": null
    }
  }
}
```

### 6.3 App Icons

Generate icons for all platforms:
```bash
# From existing SVG
npm install -D @anthropic-ai/tauri-plugin-icons
npx tauri icon build/icon.svg
```

### 6.4 Code Signing (macOS)

For distribution outside App Store:
```bash
# Sign the app
codesign --force --deep --sign "Developer ID Application: Your Name" target/release/bundle/macos/Claude\ Kanban.app

# Create notarized DMG
xcrun notarytool submit target/release/bundle/macos/Claude\ Kanban.dmg --wait --keychain-profile "AC_PASSWORD"
```

### 6.5 Auto-Updates (Optional)

Configure Tauri updater plugin for future updates.

### 6.6 Deliverables - Phase 6

- [ ] All dead code removed
- [ ] App icons generated
- [ ] DMG builds successfully
- [ ] App launches and all features work
- [ ] Code signing configured (if distributing)
- [ ] README updated with Tauri build instructions
- [ ] Documentation updated

---

## Migration Checklist

### Frontend Changes

| Component | Current | Tauri | Status |
|-----------|---------|-------|--------|
| `Terminal.tsx` | WebSocket | Tauri IPC + events | [ ] |
| `useSessions.ts` | fetch() | invoke() | [ ] |
| `useInboxItems.ts` | fetch() | invoke() | [ ] |
| `useTreeSessions.ts` | fetch() | invoke() | [ ] |
| `Board.tsx` | No changes needed | - | [ ] |
| `Column.tsx` | No changes needed | - | [ ] |
| `SessionCard.tsx` | No changes needed | - | [ ] |
| `TreeView.tsx` | No changes needed | - | [ ] |
| `PlanEditor.tsx` | fetch() for save | invoke() | [ ] |
| `ScopeBreadcrumbs.tsx` | fetch() | invoke() | [ ] |

### Backend Services (Rust)

| Service | Lines | Complexity | Status |
|---------|-------|------------|--------|
| Session parser | ~300 | Medium | [ ] |
| Session status DB | ~100 | Low | [ ] |
| Todo.md parser | ~200 | Medium | [ ] |
| Folder discovery | ~100 | Low | [ ] |
| Plan read/write | ~50 | Low | [ ] |
| PTY manager | ~400 | High | [ ] |
| File watcher | ~100 | Medium | [ ] |

### API Route → Tauri Command Mapping

| API Route | Tauri Command | Status |
|-----------|---------------|--------|
| `GET /api/sessions` | `get_sessions` | [ ] |
| `PATCH /api/sessions` | `update_session_status` | [ ] |
| `GET /api/inbox` | `get_inbox` | [ ] |
| `POST /api/inbox` | `create_inbox_item` | [ ] |
| `PATCH /api/inbox` | `update_inbox_item` | [ ] |
| `DELETE /api/inbox` | `delete_inbox_item` | [ ] |
| `PUT /api/inbox` (reorder) | `reorder_inbox` | [ ] |
| `GET /api/folders` | `get_folders` | [ ] |
| `POST /api/folders` (picker) | `pick_folder` | [ ] |
| `GET /api/plans/[slug]` | `get_plan` | [ ] |
| `PUT /api/plans/[slug]` | `save_plan` | [ ] |
| `POST /api/reveal` | `reveal_in_finder` | [ ] |
| `GET /api/cwd` | (not needed) | N/A |
| `GET /api/ws-port` | (not needed) | N/A |
| `GET /api/youtube-transcript` | `get_youtube_transcript` | [ ] |
| `POST /api/firecrawl` | `firecrawl` | [ ] |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| PTY implementation issues | Medium | Critical | Prototype early; have fallback (Option B sidecar) |
| Rust learning curve | Medium | Medium | Use ChatGPT/Claude for Rust help; follow existing crates |
| Bundle size regression | Low | Low | Tree-shake dependencies; lazy load MDXEditor |
| macOS code signing | Medium | Medium | Test early; document process |
| Performance regression | Low | Medium | Profile critical paths; use release builds |

---

## Success Criteria

1. **Functional parity**: All features work as in current Next.js version
2. **Single binary**: No Node.js runtime required
3. **Terminal works**: PTY spawning, input, output, resize all functional
4. **Native feel**: Window management, menu bar (optional), native dialogs
5. **Reasonable size**: DMG < 100MB (current Electron would be ~200MB)
6. **No data loss**: Session status, inbox items, plans all preserved

---

## Appendix: Key File Reference

### Files to Port (High Priority)

```
server/ws-server.ts          → src-tauri/src/services/pty.rs + file_watcher.rs
src/lib/pty-manager.ts       → src-tauri/src/services/pty.rs
src/lib/claude-sessions.ts   → src-tauri/src/services/session_parser.rs
src/lib/db.ts                → src-tauri/src/services/db.rs
src/lib/todo-md.ts           → src-tauri/src/services/todo_md.rs
```

### Files to Modify (Frontend)

```
src/components/Terminal.tsx       - WebSocket → Tauri IPC
src/hooks/useSessions.ts          - fetch → invoke
src/hooks/useInboxItems.ts        - fetch → invoke
src/components/PlanEditor.tsx     - fetch → invoke
src/components/scope/*.tsx        - fetch → invoke
```

### Files to Delete

```
src/app/api/                      - All API routes
server/ws-server.ts               - WebSocket server
next.config.ts                    - Update for static export
```

---

*Last updated: 2026-01-07*
