# CodexMonitor

> macOS Tauri application to manage multiple Codex agents across local workspaces

**URL:** https://github.com/Dimillian/CodexMonitor
**GitHub:** 118 stars, 12 forks
**Pricing:** Open source (MIT)
**Last Updated:** 2026-01-11

## Overview

CodexMonitor is a native macOS desktop application built with Tauri (Rust + React/TypeScript) that provides a unified interface for managing multiple OpenAI Codex AI agents across different local workspaces. It's designed for developers who want to orchestrate multiple Codex sessions simultaneously with a polished native UI.

The app fills a similar gap for Codex users that Hilt fills for Claude Code users - providing persistent workspace management, visual session organization, and terminal-like interaction that the CLI alone doesn't offer. It communicates with spawned `codex app-server` processes via JSON-RPC over stdio.

Created by Dimillian (Thomas Ricouard), a well-known iOS/macOS developer, the project shows strong native macOS design sensibilities with vibrancy effects and overlay titlebars.

## Key Features

- **Workspace Management**: Add/persist workspaces via system folder picker
- **Agent Spawning**: Launch one `codex app-server` per workspace with JSON-RPC streaming
- **Thread Restoration**: Recover previous threads from Codex rollout history (`thread/list`)
- **Agent Interactions**: Start threads, send messages, display reasoning/tool calls, manage approvals
- **Git Integration**: Sidebar showing diff statistics via libgit2
- **Skills Menu**: Insert `$skill` tokens into the composer
- **Thread Archiving**: Remove threads from UI and invoke `thread/archive`
- **Native macOS UI**: Overlay title bar with vibrancy effects

## Technology Stack

| Layer | Technology | Notes |
|-------|------------|-------|
| Desktop Framework | Tauri 2.x | Rust backend, WebView frontend |
| Frontend | React + TypeScript | 72% of codebase |
| Backend | Rust | 14% of codebase |
| Styling | CSS Modules | 14% of codebase |
| Bundler | Vite | Modern build tooling |
| Git | libgit2 | Native git diff support |
| Protocol | JSON-RPC over stdio | Codex app-server communication |

## Comparison with Hilt

### They Have, We Don't

| Feature | Their Implementation | Priority for Us |
|---------|---------------------|-----------------|
| Native desktop app | Tauri (Rust + WebView) | Low - We have Electron |
| Git diff sidebar | libgit2 integration shows changed files | Medium - Useful context |
| Skills menu | Insert `$skill` tokens in composer | Low - Claude uses `/` syntax |
| Thread archival | Archive threads via `thread/archive` API | Low - We just change status |
| Multi-agent orchestration | One agent per workspace simultaneously | Medium - We focus on single session |
| JSON-RPC protocol | Direct app-server communication | N/A - Different AI platform |
| Approval management | UI for tool call approvals | Medium - Could add for plan mode |

### We Have, They Don't

| Feature | Our Implementation | Their Gap |
|---------|-------------------|-----------|
| Kanban board | Drag-drop columns (To Do/In Progress/Recent) | No workflow status tracking |
| Tree/Treemap view | Squarified treemap visualization | Single list only |
| Inbox drafts | Queue prompts for later execution | No draft/planning queue |
| Scope navigation | Breadcrumb + pin folders + URL routing | Basic workspace picker |
| Running detection | 30s mtime heuristic | Unknown |
| Plan editor | MDXEditor for plan.md files | No plan file support |
| Search | Filter sessions by title/content | No visible search |
| Session starring | Mark important sessions | No prioritization |
| Heat scoring | Activity-based sizing in tree view | No activity metrics |
| Browser-based option | Works without desktop app install | Desktop-only |

### Both Have (Compare Quality)

| Feature | Theirs | Ours | Winner |
|---------|--------|------|--------|
| Workspace management | Folder picker + persistence | URL-based scoping + pins | **Ours** (more flexible) |
| Terminal integration | Via app-server protocol | PTY + xterm.js | **Ours** (real terminal) |
| Session history | Thread list from Codex | JSONL parsing | Tie (both work) |
| Native feel | True native (Tauri) | Electron optional | **Theirs** (truly native) |
| Git info | Diff sidebar with stats | Branch name only | **Theirs** (more detail) |
| UI polish | macOS vibrancy effects | Tailwind + clean | **Theirs** (native UI) |

## Learning Opportunities

### Features to Consider

1. **Git Diff Sidebar** - Show changed files count and diff stats in session cards or sidebar. Would provide useful context for what a session accomplished. Could integrate with simple git commands rather than libgit2.

2. **Multi-Session Orchestration** - Consider ability to view/manage multiple running sessions simultaneously. Currently we focus on one terminal at a time.

3. **Approval Queue UI** - When Claude enters plan mode or requests confirmation, a dedicated UI for reviewing/approving could be cleaner than inline terminal interaction.

### UX Patterns

1. **Workspace Persistence** - They use a `workspaces.json` in app data. We use URL-based scoping which is more flexible but less "sticky" - pinned folders help but aren't the same.

2. **Skills/Commands Menu** - Dedicated UI for inserting commands into the composer. We could consider a command palette for `/` commands.

3. **Thread-First Navigation** - They organize by threads (conversations), we organize by sessions. Worth considering if thread-level granularity adds value.

### Technical Approaches

1. **Tauri vs Electron** - Tauri produces smaller binaries with better native integration. If we wanted tighter macOS integration (menu bar, vibrancy), Tauri is worth considering for v2.

2. **JSON-RPC Protocol** - Clean structured communication vs our PTY-based approach. Different tradeoffs: PTY gives us real terminal, JSON-RPC gives structured data.

3. **libgit2** - Native git integration without shelling out. More reliable for git operations but adds native dependency complexity.

## Our Unique Value

Hilt's distinct advantages over CodexMonitor:

1. **Workflow-centric design** - Kanban board with explicit status tracking (To Do/In Progress/Recent) matches how developers actually work through tasks. CodexMonitor is conversation-centric.

2. **Inbox/Draft queue** - Ability to queue up prompts before executing them is unique. Great for planning work sessions.

3. **Multi-view flexibility** - Board, Tree, and (upcoming) Docs views serve different mental models. They have a single list view.

4. **Browser-first** - No installation required for basic usage. `npm run dev:all` and go.

5. **Scope-based navigation** - Deep folder navigation with URL routing, breadcrumbs, and pinning. Much richer than their workspace picker.

6. **Heat scoring and metrics** - Session activity analysis for intelligent sizing and prioritization.

## Verdict

**Adjacent tool, same problem space, different ecosystem.**

CodexMonitor solves the same core problem (GUI for CLI AI agents) but for OpenAI Codex instead of Claude Code. The approaches differ significantly:

- **Their focus**: Native macOS polish, multi-agent orchestration, conversation threads
- **Our focus**: Workflow management, flexible visualization, draft planning

**Key insight**: They've invested heavily in native feel (Tauri, vibrancy, macOS conventions) while we've invested in workflow features (Kanban, inbox, tree view). Both are valid strategies.

**Watch for**: If Codex gains market share, their patterns for multi-agent orchestration and approval UIs could become relevant for Claude Code as agent capabilities expand.

**Not a direct competitor** since we serve different AI platforms, but useful for:
- UX inspiration (git diff sidebar, native UI polish)
- Feature validation (others also see need for GUI layer on AI CLIs)
- Technical comparison (Tauri vs Electron tradeoffs)

---

*Analysis performed: 2026-01-11*
