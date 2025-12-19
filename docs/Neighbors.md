# Neighboring Projects Analysis

An evaluation of related open-source projects for managing Claude Code sessions, with insights for our Kanban implementation.

---

## 1. philipp-spiess/claude-code-viewer

**What it is:** A web-based transcript uploader and viewer. Users run `npx claude-code-uploader` to select local JSONL transcripts and upload them to a hosted viewer for sharing.

**URL:** https://github.com/philipp-spiess/claude-code-viewer

### Tech Stack
- TypeScript monorepo (pnpm workspaces)
- Hosted on GitHub Pages (claude-code-viewer.pages.dev)
- CLI with interactive selection (arrow key navigation)

### Pros
- Simple, focused scope (upload → share)
- Zero-config CLI invocation via npx
- Already parses `~/.claude/projects/` directory structure

### Cons
- Upload/sharing focus, not local management
- No search, filtering, or status tracking
- Read-only viewing (no session interaction)
- Requires uploading data to external server

### Ideas to Consider
| Item | Relevance |
|------|-----------|
| Interactive CLI transcript selector | Could add a CLI companion tool for quick session selection |
| Monorepo structure with shared packages | Good pattern if we add CLI tools later |
| Shareable session links | Future feature: export/share a session summary |

---

## 2. jhlee0409/claude-code-history-viewer

**What it is:** A Tauri desktop app (Rust + React) that provides browsing, search, and analytics for Claude Code conversation history. The most mature viewer with 251 stars.

**URL:** https://github.com/jhlee0409/claude-code-history-viewer

### Tech Stack
- Tauri (Rust backend, React frontend)
- Tailwind CSS + Radix UI components
- TypeScript (78.6%), Rust (18%)

### Pros
- **Activity heatmaps** showing usage patterns over time
- **Token usage analytics** per project/session
- Full-text search across all conversations
- Syntax highlighting with proper diff rendering
- Tool output visualization (git, terminal, web search)
- Auto-refresh when new conversations appear
- Multi-language support (EN, KO, JA, ZH)
- 100% local, no data leaves machine

### Cons
- Desktop app requires separate install (not web-based)
- No session interaction (view-only)
- No status/workflow tracking
- macOS/Linux only (no Windows yet)
- Large histories can load slowly

### Ideas to Consider
| Item | Relevance | Priority |
|------|-----------|----------|
| Activity heatmaps | Great for understanding usage patterns | Medium |
| Token usage analytics | Useful for cost awareness | Medium |
| Tool output visualization | Makes terminal/git output readable | High |
| Syntax-highlighted diffs | Essential for code review | High |
| Auto-refresh on new sessions | Good UX for live updates | High |
| File tree navigation | Alternative to flat card list | Medium |
| Multi-language i18n | Future internationalization | Low |

---

## 3. desis123/claude-code-viewer

**What it is:** A lightweight Python/FastAPI web viewer with search. Simplest of the viewers—pip install and run.

**URL:** https://github.com/desis123/claude-code-viewer

### Tech Stack
- FastAPI (Python)
- Bootstrap CSS
- Pygments for syntax highlighting
- pip-installable CLI

### Pros
- **Extremely simple**: `pip install claude-code-viewer && claude-viewer`
- Zero configuration needed
- Search across conversations
- Dark/light theme support
- Pagination for large histories
- Customizable host/port/path flags

### Cons
- Basic UI (Bootstrap, not modern)
- No analytics or visualizations
- No session interaction
- Limited feature set
- Python dependency (vs Node.js ecosystem)

### Ideas to Consider
| Item | Relevance | Priority |
|------|-----------|----------|
| Zero-config defaults | Our app should "just work" out of the box | High |
| CLI flags for customization | `--host`, `--port`, `--projects-path` | Medium |
| Pagination for large datasets | Essential for users with many sessions | High |

---

## 4. d-kimuson/claude-code-viewer

**What it is:** The most feature-rich viewer. A full web client with session management, git integration, file uploads, browser preview, and even message scheduling. Almost an IDE-like experience.

**URL:** https://github.com/d-kimuson/claude-code-viewer

### Tech Stack
- React + TypeScript + Vite
- Node.js backend
- Zod validation, Lingui i18n
- Playwright e2e testing
- Docker support

### Pros
- **Resume/continue sessions** from the UI
- **Git integration**: diff viewer, commit, push without terminal
- **File upload**: images, PDFs, text with preview
- **Browser preview panel** for testing web apps
- **Message scheduling** with cron expressions
- **Audio notifications** on task completion
- Password authentication option
- Mobile-responsive design
- Real-time session log viewing
- Extensive customization (themes, keybindings, sounds)

### Cons
- Very complex—may be over-engineered for simple use cases
- No kanban/workflow management
- No terminal embedding (uses Claude Code's own session resume)
- Requires Node 20.19+
- Windows unsupported

### Ideas to Consider
| Item | Relevance | Priority |
|------|-----------|----------|
| Resume/continue sessions | **Core to our app**—this validates the approach | Critical |
| Git diff viewer | Useful for reviewing session changes | High |
| Audio notifications | Nice UX for background tasks | Low |
| Password authentication | Good for shared machines | Low |
| Real-time log viewing | Could show live session output | Medium |
| File upload/preview | Nice-to-have for adding context | Low |
| Message scheduling | Interesting but out of scope | Out of scope |
| Progressive disclosure UI | Good pattern for complex data | Medium |
| Zod schema validation | Strong typing for JSONL parsing | High |

---

## 5. BloopAI/vibe-kanban

**What it is:** A kanban board for orchestrating multiple AI coding agents. Creates tasks, assigns them to agents (Claude Code, Gemini, Codex, etc.), and manages parallel execution in isolated git worktrees.

**URL:** https://github.com/BloopAI/vibe-kanban

### Tech Stack
- Rust backend (58%) with Actix-web
- React/TypeScript frontend (39%)
- PostgreSQL database
- pnpm monorepo

### Pros
- **Kanban UI** for task management (closest to our vision)
- Multi-agent support (not Claude-specific)
- Parallel execution with git worktree isolation
- VS Code extension for IDE integration
- Remote SSH deployment support
- Centralized MCP configuration
- Active development (143 releases, 6.6k stars)

### Cons
- **Different mental model**: creates new tasks → spawns agents (we track existing sessions)
- Heavy infrastructure (Rust, PostgreSQL)
- Git worktree complexity we don't need
- Dev-workflow focused (PRs, merges)
- Doesn't read Claude Code's session database

### Ideas to Consider
| Item | Relevance | Priority |
|------|-----------|----------|
| Kanban board UI patterns | Study their column/card design | High |
| Drag-and-drop interactions | Reference for @dnd-kit implementation | High |
| VS Code extension | Future integration possibility | Low |
| Task status state machine | Validate our Inbox→Active→Inactive→Done flow | Medium |
| Real-time status updates | How they show agent progress | Medium |
| MCP configuration UI | Could add MCP server management | Out of scope |

---

## Summary Matrix

| Project | Type | Session Interaction | Kanban/Workflow | Analytics | Complexity |
|---------|------|---------------------|-----------------|-----------|------------|
| philipp-spiess | Web uploader | None | None | None | Low |
| jhlee0409 | Desktop app | None | None | **Strong** | Medium |
| desis123 | Web viewer | None | None | None | Low |
| d-kimuson | Web client | **Resume/Continue** | None | Basic | High |
| vibe-kanban | Orchestrator | Creates new | **Kanban** | Basic | High |
| **Our project** | Web app | **Resume via terminal** | **Kanban** | TBD | Medium |

---

## Key Takeaways for Our Implementation

### Must Have (validated by neighbors)
1. **Session resume capability** (d-kimuson proves this is valuable)
2. **Zero-config startup** (desis123's simplicity is compelling)
3. **Syntax-highlighted diffs** (jhlee0409, d-kimuson)
4. **Auto-refresh** when sessions change (jhlee0409)
5. **Pagination/virtualization** for large session lists

### Should Have
1. **Activity visualization** (heatmaps from jhlee0409)
2. **Token/cost tracking** (jhlee0409)
3. **Tool output formatting** (git, terminal, search results)
4. **Search across sessions** (all viewers have this)
5. **Zod schema validation** for robust JSONL parsing (d-kimuson)

### Nice to Have
1. **Git diff viewer** for reviewing changes (d-kimuson)
2. **Audio notifications** for long-running tasks
3. **Shareable session exports** (philipp-spiess concept)
4. **CLI companion** for quick session selection

### Out of Scope (for now)
1. Multi-agent orchestration (vibe-kanban's domain)
2. Git worktree isolation
3. Message scheduling
4. VS Code extension
5. Remote SSH deployment

---

## Architecture Insights

### What we can learn from each:

**From jhlee0409:** Their Tauri app shows that parsing JSONL efficiently matters. Consider streaming/lazy loading for large files rather than loading everything into memory.

**From d-kimuson:** Their Zod validation approach is smart—define strict schemas for the JSONL format to catch parsing errors early. Also, their progressive disclosure UI pattern (show summary first, expand for details) would work well for session cards.

**From vibe-kanban:** Their kanban UI is the closest reference for our board design. Study their column layout, card components, and drag-drop interactions.

**From desis123:** Sometimes simple is better. Their zero-config approach (`pip install && run`) is the gold standard for developer tools. We should match this with `npx claude-kanban` or similar.
