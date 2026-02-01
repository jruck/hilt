# Remote-Hosted Hilt Architecture

## The Request

Run Hilt from a public web server while still reading local Claude sessions and providing terminal access. No server-side caching - all session data stays local.

## The Core Problem

**Browsers cannot access the local filesystem.** This is a fundamental security boundary, not a technical limitation to work around. A website at `hilt.example.com` cannot read `~/.claude/projects/` - and this is by design.

The terminal functionality has the same constraint: you cannot spawn a PTY (pseudo-terminal) from browser JavaScript.

## Honest Assessment

**This architecture requires running something locally.** There's no way around it. The question becomes: what's the minimum viable local component?

### Current State (Fully Local)
```
┌─────────────────────────────────────────┐
│              Local Machine              │
│  ┌─────────────────────────────────┐   │
│  │         Hilt (Next.js)          │   │
│  │  • UI                           │   │
│  │  • API routes                   │   │
│  │  • Session parsing              │   │
│  │  • WebSocket server             │   │
│  │  • PTY management               │   │
│  └─────────────────────────────────┘   │
│              ↓ reads                    │
│     ~/.claude/projects/*.jsonl          │
└─────────────────────────────────────────┘
```

### Proposed: Split Architecture
```
┌──────────────────────┐      ┌─────────────────────────────────┐
│    Public Server     │      │         Local Machine           │
│  ┌────────────────┐  │      │  ┌───────────────────────────┐  │
│  │   Hilt UI      │  │ ←──→ │  │      Local Bridge         │  │
│  │  (Static/CDN)  │  │  WS  │  │  • File watcher           │  │
│  └────────────────┘  │      │  │  • Session parser         │  │
└──────────────────────┘      │  │  • PTY manager            │  │
                              │  │  • WebSocket server       │  │
                              │  └───────────────────────────┘  │
                              │              ↓ reads            │
                              │     ~/.claude/projects/*.jsonl  │
                              └─────────────────────────────────┘
```

## Options Analysis

### Option 1: Minimal Local Bridge (Recommended if pursuing this)

**What runs locally:** A small binary (~5-10MB) that:
- Watches `~/.claude/projects/` for changes
- Parses JSONL files on demand
- Manages PTY sessions
- Exposes a WebSocket API on localhost

**What's hosted publicly:**
- Static React/Next.js UI
- No backend - pure client-side app

**Pros:**
- UI updates don't require local updates
- Smaller local footprint
- Could be distributed as a single binary (Go/Rust)

**Cons:**
- Still requires local installation
- Two things to maintain (bridge + UI)
- Security surface: localhost WebSocket needs auth
- Complexity: browser ↔ local bridge communication

**Implementation complexity:** Medium-High

### Option 2: File System Access API (Browser Native)

Modern browsers have `window.showDirectoryPicker()` which lets users grant folder access.

**Pros:**
- No local server needed for file reading
- Native browser API

**Cons:**
- User must re-grant access every browser session
- No file watching - must poll or manual refresh
- **Terminal is impossible** - no PTY access
- Limited browser support (no Firefox, no Safari)
- Can't run in Electron (different API)

**Verdict:** Non-starter due to terminal requirement

### Option 3: Browser Extension

A browser extension can access local files and communicate with web pages.

**Cons:**
- Extensions can't spawn PTY processes
- Need separate extension per browser
- Complex security model
- Extension store approval process

**Verdict:** Non-starter due to terminal requirement

### Option 4: Hybrid (Electron loads remote UI)

Electron shell that loads UI from a public URL but has full local access.

**Pros:**
- UI always up-to-date
- Full local capabilities

**Cons:**
- Still need Electron installed locally
- Basically current architecture with extra network dependency
- Offline doesn't work

**Verdict:** Marginal benefit, added fragility

## The Uncomfortable Truth

**If you need terminal access, you need a local process.**

The "public web server" framing suggests benefits like:
1. No installation required
2. Always up-to-date
3. Access from any device

But requirements 1 and 3 are impossible given the need to read local files and spawn terminals. Only requirement 2 (auto-updates) could be achieved, and there are simpler ways to do that.

## Alternative: Better Local Distribution

Instead of splitting local/remote, consider improving local distribution:

### Auto-Updating Local App
- Electron with auto-update
- Or: local server + web UI that checks for updates
- User runs one thing, it stays current

### Cross-Device Access (Different Problem)
If the goal is accessing sessions from multiple devices:
- Sync `~/.claude/projects/` via iCloud/Dropbox
- Hilt reads from synced folder
- Still runs locally on each device

### True Remote Access (Major Scope Change)
If you want to access your sessions from your phone while away from your computer:
- Requires running a server on your machine
- Expose via Tailscale/Cloudflare Tunnel/ngrok
- Significant security implications
- This is "remote desktop for Claude sessions"

## Recommendation

**Don't pursue the split architecture.** The complexity cost outweighs the benefits:

| Benefit | Split Arch | Current + Auto-Update |
|---------|------------|----------------------|
| No local install | ❌ Still need bridge | ❌ Need app |
| Auto-updating UI | ✅ Yes | ✅ Yes (Electron) |
| Access anywhere | ❌ Only where bridge runs | ❌ Only local |
| Simpler maintenance | ❌ Two codebases | ✅ One codebase |
| Works offline | ❌ No (needs hosted UI) | ✅ Yes |

If the goal is "less friction to stay updated," add auto-update to the Electron app.

If the goal is "access from other devices," that's a different (and larger) problem involving secure tunneling.

## Questions to Clarify Intent

1. **What's the pain point with local?** Is it installation friction, update friction, or something else?

2. **Do you need terminal access?** If not, the File System Access API becomes viable (with caveats).

3. **Multi-device access?** If yes, that's achievable but requires explicit tunneling setup and has security implications.

4. **Offline requirement?** Split architecture breaks offline use.

---

*Written: 2025-01-16*
