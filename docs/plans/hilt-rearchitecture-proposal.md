# Claude's Suggestion for Hilt Re-Architecture

> A proposal, not the current architecture. The current system is documented in
> [`ARCHITECTURE.md`](../ARCHITECTURE.md). This document argues for where Hilt should go
> next and gives an agent-executable order of operations to get there.
>
> **Audience:** dual. The prose sections ("Summary", "Why", "What we're learning from")
> are for a product/design reader. The "Target Tech Stack", "The Hilt Protocol",
> "Order of Operations", and "Appendix" sections are execution-grade for engineering agents.
>
> **Provenance:** restored from the pre-pull stash `codex/pull-latest-hilt-before-2026-06-19`,
> created on 2026-06-18 at 21:04:15 -04:00 from local uncommitted work based on `9b80a5e`.

---

## Summary

Hilt is currently built like **a website that happens to run on the desktop**: the Electron
window (the Screen) talks to a Next.js server running on `localhost` (the Kitchen) over HTTP
for nearly everything it does — even trivial local reads. Claude's desktop app and OpenAI's
Codex desktop app are built the other way around: **desktop apps that happen to use web tech
for the screen**, where the heavy work lives in-process and the network is only used when
something genuinely external is needed.

This proposal moves Hilt across that line. The destination is three clean parts:

1. **The Screen** — a static React app (built with Vite), instant to load, holds no business logic.
2. **The Shell** — a thin Electron main process (windows, menus, native dialogs, deep links).
3. **The Engine** — one persistent local service (an Electron `utilityProcess`) that owns all the
   heavy work: the database, the file watchers, the Map indexer, search, sync, the Bridge vault,
   and the local-apps scanner — exposed to the Screen through a single **typed protocol** ("the order pad").

Same features. Same UI. Same markdown-vault-as-source-of-truth. What changes is the *plumbing*:
from "web app calling a server over HTTP" to "desktop app calling its own engine directly."

**This is a plumbing re-architecture, not a UI rewrite.** The React components, the Tiptap/CodeMirror
editors, the Tailwind styling, the design — all survive. The work is moving the data layer underneath them.

---

## Why this (the diagnosis)

Think of a desktop app as a **restaurant**: a *dining room* (the screen), a *kitchen* (where the
real work happens), and a *supplier* (the outside world — the AI, the web, your other machines).

| App | Where's the kitchen? | Result |
|-----|----------------------|--------|
| **Claude** | Barely has one — a dining room with a phone to a supplier (the AI API) | Feels instant; the room never waits on its own kitchen |
| **Codex** | A real kitchen **in the same building** (a native Rust engine) + a phone to the supplier | Fast local work; calls the supplier only when needed |
| **Hilt (today)** | A kitchen **in a separate building across the street** (the Next server on `localhost`) | Every order — even a glass of water — is a round trip across the street, and there's only one waiter |

The "separate building across the street" is the localhost HTTP server. Even though it's on the
same machine, Hilt treats it like a remote backend. Every interaction pays an HTTP round-trip +
React-Server-Component serialization for what is, underneath, a microsecond-fast local read.
And because the server handles one request at a time on a single event loop, **one slow job blocks
everything behind it.**

Two findings from reading the code confirmed this is the real ceiling:

- **Verified hotspot — recursive synchronous filesystem scans.** `docs/tree` walks the directory
  tree with synchronous `fs.statSync` / `fs.readdirSync`
  ([`src/app/api/docs/tree/route.ts`](../../src/app/api/docs/tree/route.ts)). Synchronous recursion on
  the single server event loop stalls *every other in-flight request* for the duration of the walk —
  which reads to the user as "the whole app hitches when I open a big folder."
- **The IPC boundary is barely used.** Only a handful of operations go native today (folder picker,
  window focus, a few push events in [`electron/preload.ts`](../../electron/preload.ts)). The other
  ~95% of the app's data flows over HTTP to **62 Next.js API routes**. The "desktop app" is, in
  practice, a local website.

The deeper point: **Hilt does a lot of genuinely heavy local work** (see "What Hilt has to do" below).
It is *not* a thin client like Claude. That is exactly why the Codex shape — thin Screen + heavy
local Engine behind a typed boundary — is the right target.

---

## What Hilt has to do (the function surface)

Re-architecting safely means respecting everything Hilt already does. From the code, that's six real jobs:

| Subsystem | What it does | Work profile |
|-----------|--------------|--------------|
| **Bridge** | People / projects / tasks / thoughts / briefings / weekly reviews knowledge base, backed by a markdown vault at `~/work/bridge/` | Frequent small reads/writes; the daily-driver hot path |
| **Docs** | Markdown + code file browser with `[[wikilinks]]`, syntax highlighting, Mermaid, CSV/PDF/image viewers | Tree scans, file reads — **the verified hotspot** |
| **Map** | Indexes coding-agent sessions into SQLite; builds work-graphs + activity heatmaps | CPU-heavy indexing; should never block UI |
| **System** | Multi-machine sessions, **cross-device sync + conflict resolution**, peers | Network + reconciliation; long-running |
| **Local-apps** | Discovers & previews running dev servers, incl. over Tailscale | Network probing; should be backgrounded |
| **Live layer** | chokidar watchers push "changed on disk" events to the Screen in real time | Long-lived; event source |

Storage today is a deliberate mix that we **keep**:

- **Markdown vault** (`~/work/bridge/`) — human-readable source of truth (read-write). *Do not replace with a DB.*
- **JSON stores** (`data/preferences.json`, `inbox.json`, `session-status.json`) — small local state.
- **SQLite** (`src/lib/map/local-index-db.ts`, `better-sqlite3`) — derived index/cache for the Map.
- **Read-only sources** — `~/.claude/` configs and `~/.claude/projects/*.jsonl` sessions.

---

## What we're learning from Claude and Codex (verified on disk)

All three reference apps are Electron. The lesson is *where the work lives*, not the shell.

| | Claude | Codex | Takeaway for Hilt |
|---|---|---|---|
| Shell | Electron 41 | Electron ~42 / Chromium 149 ✓ | Keep Electron |
| Renderer | Vite + React + Tailwind (static SPA) | Vite + React + Tailwind (static SPA) ✓ | **Adopt the static-SPA Screen** |
| "Backend" | Remote Anthropic API (thin client) | **Native Rust `codex` sidecar** ✓ (typed protocol, `app-server`) | **Adopt the local-Engine shape** |
| Hot path | IPC / HTTPS | Typed RPC → sidecar | **Typed protocol, not localhost HTTP** |

✓ = confirmed by inspecting the installed app bundles.

**Steal the Screen from Claude** — instant load, streaming, optimistic UI. **Steal the Engine from
Codex** — one persistent local service behind a typed boundary. Hilt is closer to Codex's needs
(real local work), so Codex is true north; Claude informs the renderer's feel.

> Note on substrate: Codex's engine is native Rust. We do **not** start there. Hilt's engine starts
> as **Node + TypeScript** so the existing `src/lib/*` logic moves almost verbatim. Rust (via napi-rs)
> stays an *optional, later* escalation for a proven hotspot — not a day-one cost.

---

## Goals

- **Sub-frame local interactions.** Opening a note, switching views, expanding a tree should feel
  native — no perceptible network latency for local data.
- **No "one slow job freezes the app."** Heavy work (indexing, scans, search, probing) never blocks
  the UI thread.
- **One brain, not 62 endpoints.** Consolidate scattered HTTP route logic into a single Engine with
  a clean, typed API surface — easier to test, reason about, and hand to agents.
- **Fewer moving parts.** Collapse 3–4 cooperating processes (Electron + Next + WS/event servers)
  and their lock-file/port-probe startup dance into **two**: Shell + Engine.
- **Local-first by default.** The Engine is the source of truth for this machine; the AI and other
  machines are things we *sync with*, not things the Screen *waits on* to render.
- **Incremental and safe.** Every step ships on its own and leaves a working app. Built to be
  parceled out to parallel agents.

## Non-Goals

- **Not a UI redesign.** Components, editors, styling, and interaction design carry over unchanged.
- **Not a data-model migration.** The markdown vault stays the source of truth; SQLite stays the index.
- **Not a rewrite in another language.** TypeScript throughout; Rust is deferred and optional.
- **Not solving cross-machine sync here.** Sync is a separate concern (see
  [`hilt-sync-control-plane.md`](./hilt-sync-control-plane.md) and
  [`hilt-map-convex-work-graph-plan.md`](./hilt-map-convex-work-graph-plan.md)). This plan
  defines *where the sync layer plugs into the Engine*, not which sync backend wins.

---

## Locked-in principles

1. **The vault is the source of truth.** The Engine reads/writes/parses/watches `~/work/bridge/`.
   SQLite is a derived cache that the Engine keeps in sync — never the authority for vault content.
2. **Strangler-fig migration.** Grow the Engine *beside* the Next server. Move one capability at a
   time. Delete each route only once its replacement is proven. Never a big-bang cutover.
3. **The protocol contract is the keystone.** A single shared TypeScript module defines every
   operation and event. It is written first and is the coordination point for parallel agents.
4. **Heavy work never runs on the main thread.** `better-sqlite3` is synchronous; a heavy query or
   scan on the Electron main thread freezes every window. Fast indexed reads → Engine; CPU-bound jobs
   → `worker_threads` inside the Engine.
5. **Preserve the CLI `/navigate` integration.** Scripts drive the app today via
   `POST http://localhost:$(cat ~/.hilt-ws-port)/navigate`. The re-architecture must keep an
   equivalent external control path (see Phase 6).

---

## Target architecture

### Before (today)

```
┌──────────────────────────────────────────────────────────┐
│ Electron window (Screen)                                 │
│   Next.js 16 + React 19  ── SWR/fetch ──┐                 │
└─────────────────────────────────────────┼────────────────┘
            │ HTTP :3000          WebSocket │ :3001
            ▼                               ▼
   ┌─────────────────┐            ┌─────────────────────┐
   │ Next.js server  │            │ WS + Event server   │
   │ (child process) │            │ (child process)     │
   │ 62 API routes   │            │ chokidar watchers   │
   └────────┬────────┘            └──────────┬──────────┘
            ▼                                ▼
     Vault / JSON / SQLite          (file-change events)
   = Electron + Next + WS/Event  →  3–4 processes, port files, lock files
```

### After (target)

```
┌──────────────────────────────────────────────────────────┐
│ Electron window (Screen)                                 │
│   Static React + Vite  ──┐                               │
│   TanStack Query / Router │  (no business logic, no fetch)│
└───────────────────────────┼──────────────────────────────┘
                            │ typed RPC over IPC (the "order pad")
                            │ queries · mutations · subscriptions
                            ▼
                 ┌────────────────────────────┐
                 │ Engine (utilityProcess)    │
                 │  • SQLite (index/cache)    │
                 │  • Bridge vault r/w + parse│
                 │  • chokidar watchers       │
                 │  • Map indexer ┐           │
                 │  • search      │ heavy →   │──▶ worker_threads
                 │  • local-apps  │ off the   │
                 │  • sync client ┘ msg loop  │
                 └─────────────┬──────────────┘
                               ▼
                Vault / JSON / SQLite   +   AI API · other machines (only when needed)
   = Electron Shell + Engine  →  2 processes, no port/lock dance
```

The **Shell** (Electron main) stays thin: it creates windows, owns menus/tray/native dialogs and the
`hilt://` deep-link protocol, loads the Screen (`file://` in prod, Vite dev server in dev), and
spawns + supervises the Engine. It brokers the IPC channel (or hands the Screen a `MessagePort`
straight to the Engine).

---

## Target tech stack

| Layer | Today | Target | Disposition | Why |
|-------|-------|--------|-------------|-----|
| Shell | Electron 33 | Electron (upgrade to 40+) | **Keep** | Cross-platform desktop shell is fine; the problem was never Electron |
| Build/orchestration | Next build + Turbopack | **electron-vite** (Vite under the hood) | **Change** | One config builds Screen + Shell + Engine; fast HMR; static renderer output. Same tool Codex/Loft use |
| Renderer framework | Next.js 16 (App Router, RSC, localhost server) | **Static React 19 SPA** | **Change** | Removes the localhost server, SSR/RSC overhead, and hydration from the hot path |
| Routing | Next App Router + `[[...path]]` catch-all | **TanStack Router** (alt: React Router) | **Change** | Client-side, typed routes; keep the existing URL-as-state model on top |
| Server-state / cache | SWR (HTTP polling) | **TanStack Query** (queryFn → IPC) | **Change** | Same cache/invalidation ergonomics as SWR, but calls the Engine; live events invalidate the cache |
| UI state | React context | **Zustand** for pure client state | **Add** | Lightweight; keeps view/selection state out of the query layer |
| Renderer↔Engine transport | HTTP + WebSocket | **tRPC over Electron IPC** (electron-trpc / MessagePort link); alt: Comlink | **Change** | End-to-end TypeScript types; queries + mutations + **subscriptions** (subscriptions replace the WebSocket entirely) |
| Local service | Next API routes (in the Next process) | **Electron `utilityProcess`** (Node + TypeScript) | **Change** | Isolated, persistent, restartable; keeps heavy Node work off the main/UI thread |
| Heavy CPU jobs | (ran inline in routes, blocking) | **`worker_threads`** inside the Engine | **Add** | Scans, indexing, search never stall the Engine's message loop |
| Database / index | better-sqlite3 (Map only) | better-sqlite3 (expanded as the read index) | **Keep + expand** | Already fast; make it the index the Screen reads so it never waits on a file scan |
| Source of truth | Markdown vault | Markdown vault | **Keep** | Deliberate, human-readable design; unchanged |
| Watchers | chokidar (in WS server) | chokidar (in Engine) | **Keep + move** | Events flow to the Screen as tRPC subscriptions |
| Realtime transport | `ws` WebSocket + EventServer + port 3001 | (deleted — folded into tRPC subscriptions) | **Drop** | One fewer process and port; one event mechanism |
| Editors | Tiptap / CodeMirror / MDXEditor | same, **lazy-loaded** | **Keep + code-split** | Load per view/panel so they're off the initial parse |
| Virtualization | @tanstack/react-virtual | same, used everywhere large | **Keep + expand** | Window every large tree/list/board |
| Validation | Zod | Zod, **shared in the protocol** | **Keep** | One schema validates both sides of the boundary |
| Packaging | electron-builder | electron-builder | **Keep** | Works; only the inputs change |
| Web framework | Next.js | — | **Drop (desktop)** | Hilt has no web deploy target (`output: "standalone"` is Electron-only); Next buys the desktop nothing a static SPA + IPC can't do better |

**Net process change:** Electron + Next + WS/Event server(s) → **Shell + Engine**. Ports `3000`/`3001`,
`~/.hilt-ws-port`, and `~/.hilt-server.lock` all go away.

---

## The Hilt Protocol (the "order pad")

The single most important artifact. One shared TypeScript module (e.g. `src/engine/contract.ts`),
imported by both the Screen and the Engine, defining:

- **Queries** — read operations (`people.list`, `docs.tree.children`, `map.workGraph`).
- **Mutations** — writes (`tasks.create`, `note.save`, `tasks.reorder`).
- **Subscriptions** — server-pushed event streams (`fs.changed`, `tasks.updated`, `startup.activity`),
  which replace the WebSocket EventServer.

Recommended realization: **tRPC v11 over an Electron IPC/MessagePort link.** Reasons:

1. **Types flow end to end** — the Screen calls `engine.people.list()` and gets a fully typed result;
   rename a field in the Engine and the Screen fails to compile. This is Codex's "typed protocol."
2. **Subscriptions are first-class** — the watcher events become `subscription` procedures; no bespoke
   socket protocol to maintain.
3. **TanStack Query integration is built-in** — a near-mechanical migration away from SWR; the Screen's
   data-fetching mental model barely changes, it just points at the Engine.

Lighter alternative if tRPC feels heavy: **Comlink** over `MessagePort` gives typed proxy calls with
almost no ceremony (`await engine.people.list()`), plus a small typed event emitter for the
subscription side. Decision recorded under "Open decisions."

Every operation in the Appendix maps to one procedure in this contract. Writing the contract **first**
(Phase 0) is what lets multiple agents work different subsystems in parallel without colliding.

---

## Data & storage strategy

- **Vault stays authoritative.** The Engine is the only component that touches `~/work/bridge/`.
  All parsing (`src/lib/bridge/*`) moves into the Engine.
- **SQLite becomes the read index.** Today the Screen triggers live filesystem scans (the hotspot).
  Target: the Engine keeps a SQLite index of vault structure + metadata, updated incrementally by the
  watchers; the Screen reads the *index* (instant) and never the raw filesystem. The recursive
  whole-tree scan is replaced by **shallow + lazy-expand + cache-by-(path, mtime) + push-deltas**.
- **JSON stores** (preferences/inbox) move under Engine ownership. Optionally fold into SQLite later
  for a single store; not required.
- **The sync layer plugs into the Engine, not the Screen.** Whichever backend wins (Syncthing-style
  file sync, or a reactive cloud DB like Convex for the work graph), it is an Engine concern with a
  clear contract. The Screen always talks only to the local Engine; the Engine reconciles with the
  network. This keeps the UI fast and offline-tolerant regardless of sync choice.

---

## Order of operations

Each phase is independently shippable and leaves a working app. Phases 1–4 use the strangler-fig
pattern (Engine and Next server coexist; routes are deleted as they're replaced).

### Phase 0 — Foundations (no behavior change)
- Lock the decisions in "Open decisions" below.
- **Write the protocol contract skeleton** (`src/engine/contract.ts`) — operations + events derived
  from the 62 routes (see Appendix). This is the keystone.
- Scaffold **electron-vite** alongside the existing Next setup (parallel; prod untouched).
- Stand up an empty **Engine `utilityProcess`** that boots, connects over IPC, and answers a `ping`.
- Prove the full Screen↔Engine loop with one trivial typed call.

### Phase 1 — Engine spine + first vertical slice
- Move [`src/lib/db.ts`](../../src/lib/db.ts) (preferences + inbox) into the Engine; expose
  `preferences.*` and `inbox.*`. Swap the Screen's preferences/inbox calls from `fetch` → tRPC.
  Delete those routes. *(Smallest end-to-end proof of the pattern.)*
- Move the **watchers** (scope / inbox / bridge) into the Engine; expose them as `fs.*` / `*.updated`
  **subscriptions**; point `EventSocketContext` at them. **Retire the WebSocket EventServer and port 3001.**

### Phase 2 — The verified hotspot (highest visible win)
- Move `docs.tree`, `docs.file`, `docs.raw`, `docs.resolveLinks` into the Engine.
- Re-implement the tree as **shallow + lazy-expand**, backed by the SQLite index, with watcher-pushed
  deltas. Delete the recursive synchronous scan. Measure before/after open-latency; record it.

### Phase 3 — Bridge (the heart) — *parallelizable across agents*
Migrate route-group by route-group. Each: move logic into an Engine module → swap Screen calls →
delete routes. Assign **one agent per group** (the contract prevents collisions):
- `people` (+ `people/[slug]`, notes, next, inbox, suggestions)
- `tasks` (+ `[id]`, reorder)
- `projects` (+ status)
- `thoughts` (+ status)
- `briefings` (+ `[date]`, read-state) / `weekly` / `accomplishments`
- `notes` / `recycle` / `upload` / `preferences`
Bridge parsers (`src/lib/bridge/*`) move into the Engine; the vault stays the source of truth.

### Phase 4 — Heavier subsystems
- **Map** — `local-indexer`, `work-graph`, `sessions`, `activity-heat`, `source-status`. SQLite already
  lives server-side, so this is mostly relocating ownership + exposing typed ops; **indexing → worker_threads**.
- **System** — machines, sessions, sessions/graph, `sync`, `sync/conflicts`, peers. The sync backend
  plugs in here behind the Engine contract.
- **Local-apps** — scanner, classifier, probe, previews, remotes, tailnet. **Probing/preview → worker_threads**
  (network-bound; keep off the UI).
- **Stack** — `claude-stack` + `system/stack` (MCP/plugin discovery).
- **Integrations** — `firecrawl`, `youtube-transcript`.

### Phase 5 — Cut the Screen over to static
- Replace Next App Router + `[[...path]]`/`ScopeContext` URL handling with the client router
  (keep the URL-as-state model).
- Replace SWR with TanStack Query throughout (can land incrementally per-view as Phases 1–4 complete).
- Build the renderer static with Vite; Electron loads `file://` in prod, Vite dev server in dev.
- Lazy-load editors and per-view code (code-split Tiptap/CodeMirror/MDXEditor/Mermaid/PDF).

### Phase 6 — Delete Next + simplify
- Remove `next`, `next.config.*`, the now-empty `src/app/api/` tree, the standalone-server startup in
  [`electron/main.ts`](../../electron/main.ts), and `server/ws-server.ts` / `server/event-server.ts`.
- **Re-point the CLI `/navigate` integration** (locked principle #5): replace the ws-server HTTP
  endpoint with either (a) a small control socket owned by the Engine, or (b) the `hilt://` deep-link
  protocol handled by the Shell. Preserve the existing `curl`/script ergonomics.
- App now boots as **Shell + Engine**. Update `ARCHITECTURE.md`, `API.md` (→ protocol), `DATA-MODELS.md`.

### Phase 7 — Polish from Claude's playbook
- **Optimistic mutations** — tasks/notes appear instantly; persist in the background.
- **Streaming** where it helps (chat, long reads).
- **Virtualize** every remaining large list/tree/board.
- **Measure** startup, view-switch, and tree-open latency; capture before/after in `CHANGELOG.md`.

---

## Parallelization guide for agents

- **Serial, by one agent, first:** Phase 0 (contract + Engine spine) and Phase 1. Everything depends on these.
- **Fan out after Phase 1:** Phase 3 Bridge groups are the big parallel opportunity — one agent per
  route-group, all editing *against* the shared contract, each owning its Engine module + Screen swap
  + route deletion. Minimal overlap.
- **Independent tracks:** Phase 2 (Docs hotspot) and Phase 4 subsystems (Map / System / Local-apps /
  Stack / Integrations) can each be a separate agent once the spine exists.
- **Merge discipline:** the contract file (`src/engine/contract.ts`) is the one place collisions happen.
  Treat changes to it as a coordination event (small, reviewed, frequent) rather than letting agents
  redefine overlapping operations.
- **Definition of done per task:** logic in an Engine module + typed procedure in the contract + Screen
  reads it via TanStack Query/tRPC + old route deleted + a test exercising the operation.

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Big-bang rewrite stalls or breaks the daily driver | Strangler-fig: Engine and Next coexist; ship per-route; the app works after every phase |
| Moving sync `better-sqlite3` into the **main** thread freezes the UI | Engine runs as a `utilityProcess`, not on main; CPU-bound queries/indexing run in `worker_threads` |
| Agents collide redefining operations | Contract-first; the contract is the single coordination point; small frequent edits |
| Losing the CLI `/navigate` automation | Explicitly preserved in Phase 6 (control socket or `hilt://` deep link) |
| Vault treated as a cache and corrupted | Locked principle #1: vault is authoritative; SQLite is derived and rebuildable |
| Live updates regress when the WebSocket is removed | Watcher events become tRPC subscriptions in Phase 1 *before* the WS server is deleted in Phase 6 |
| Scope creep into sync/UI redesign | Non-goals are explicit; sync backend deferred to its own plans |

---

## Open decisions (please confirm)

1. **Transport:** tRPC-over-IPC (recommended — typed, subscriptions, TanStack Query integration) vs
   Comlink-over-MessagePort (lighter, less ceremony).
2. **Router:** TanStack Router (typed, pairs with TanStack Query) vs React Router (maximally mature) vs
   keep a custom History-API URL model.
3. **Server-state lib:** TanStack Query (recommended) vs a thin custom hook over the transport.
4. **JSON stores:** keep `preferences.json` / `inbox.json` as files under the Engine, or fold into SQLite
   for a single store.
5. **Sync backend (deferred but directional):** Syncthing-style file sync
   ([`hilt-sync-control-plane.md`](./hilt-sync-control-plane.md)) vs reactive cloud DB / Convex
   ([`hilt-map-convex-work-graph-plan.md`](./hilt-map-convex-work-graph-plan.md)). Engine
   contract is designed so this can be chosen later.
6. **Rust escalation:** stay all-TypeScript (recommended for now) vs extract a proven hotspot to a
   native module (napi-rs) once profiling justifies it.

---

## Appendix — Route → Engine operation map

Proposed consolidation of the 62 Next API routes into Engine procedures. `Q` = query, `M` = mutation,
`S` = subscription. This is a starting map for the Phase 0 contract, not the final signature set.

### bridge.* (the heart)
| Today (route) | Proposed operation | Kind |
|---|---|---|
| `bridge/people`, `people/[slug]`, `/notes`, `/next`, `people/inbox` | `bridge.people.list` / `.get` / `.notes` / `.next` / `.inbox` | Q |
| `bridge/people/suggestions/promote` · `/hide` | `bridge.people.suggestions.promote` / `.hide` | M |
| `bridge/tasks`, `tasks/[id]` | `bridge.tasks.list` / `.get` | Q |
| `bridge/tasks/reorder` | `bridge.tasks.reorder` | M |
| `bridge/projects`, `projects/status` | `bridge.projects.list` / `.status` | Q |
| `bridge/thoughts`, `thoughts/status` | `bridge.thoughts.list` / `.setStatus` | Q/M |
| `bridge/briefings`, `briefings/[date]`, `/read-state` | `bridge.briefings.list` / `.get` / `.markRead` | Q/M |
| `bridge/weekly`, `accomplishments`, `notes`, `recycle`, `upload`, `preferences` | `bridge.weekly.*`, `bridge.accomplishments.*`, `bridge.notes.*`, `bridge.recycle`, `bridge.upload`, `bridge.preferences.*` | Q/M |

### docs.*
| Today | Proposed | Kind |
|---|---|---|
| `docs/tree` (recursive scan) | `docs.tree.children(path)` — shallow, lazy, index-backed | Q |
| `docs/file`, `docs/raw` | `docs.file.read` / `.raw` / `.write` | Q/M |
| `docs/resolve-links` | `docs.resolveLinks` | Q |

### map.*
| Today | Proposed | Kind |
|---|---|---|
| `map/local/sessions`, `session-detail`, `work-graph`, `source-status` | `map.sessions` / `.sessionDetail` / `.workGraph` / `.sourceStatus` | Q |
| `map/local/refresh` | `map.refresh` (runs in worker_thread) | M |

### system.*
| Today | Proposed | Kind |
|---|---|---|
| `system/machine(s)`, `system/sessions`, `sessions/detail`, `sessions/graph` | `system.machines` / `.sessions` / `.sessionDetail` / `.sessionGraph` | Q |
| `system/sessions/refresh` | `system.sessions.refresh` | M |
| `system/sync`, `sync/conflicts` | `system.sync.status` / `.conflicts` / `.resolve` (sync backend behind this) | Q/M |
| `system/stack`, `stack/file` | `stack.tree` / `stack.file.read|write` | Q/M |

### localApps.*
| Today | Proposed | Kind |
|---|---|---|
| `local-apps`, `local-apps/settings` | `localApps.list` / `.settings.get|set` | Q/M |
| `local-apps/refresh`, `remote-preview`, `previews/[filename]` | `localApps.refresh` / `.remotePreview` / `.preview` (probing in worker_thread) | M/Q |

### stack / claude-stack
| Today | Proposed | Kind |
|---|---|---|
| `claude-stack`, `claude-stack/file`, `claude-stack/mcp` | `stack.discover` / `stack.file.*` / `stack.mcp.detail` | Q/M |

### inbox / folders / misc
| Today | Proposed | Kind |
|---|---|---|
| `inbox`, `inbox-counts` | `inbox.list` / `inbox.counts` | Q |
| `folders`, `cwd`, `sources`, `reveal`, `preferences`, `plans/[slug]`, `chat/config` | `folders.browse` / `system.cwd` / `sources.list` / `shell.reveal` (Shell) / `preferences.*` / `plans.read|write` / `chat.config` | Q/M |
| `firecrawl`, `youtube-transcript` | `integrations.firecrawl` / `integrations.youtubeTranscript` (worker_thread) | M |

### Events (replace the WebSocket EventServer)
| Today (WS channel) | Proposed subscription | Kind |
|---|---|---|
| tree changed / file changed / inbox changed | `fs.changed` (scoped) | S |
| plan created / updated | `plans.changed` | S |
| startup activity | `startup.activity` | S |
| navigate goto (CLI control) | `nav.goto` (via Engine control socket / `hilt://`) | S |

### Removed entirely
- `ws-port` — no WebSocket, no port file.
- The Next standalone server, `server/ws-server.ts`, `server/event-server.ts`, `~/.hilt-ws-port`,
  `~/.hilt-server.lock`.

---

*Authored by Claude (Opus 4.8) as a proposal for discussion. Grounded in a read of the current Hilt
codebase and in verified inspection of the Claude and Codex desktop app bundles. Supersedes nothing
until adopted; update [`ARCHITECTURE.md`](../ARCHITECTURE.md) as phases land.*
