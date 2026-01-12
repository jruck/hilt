# Assistant (kcosr/assistant)

> A personal AI assistant with a panel-based plugin system, multi-agent CLI integrations, and text/voice UI.

**URL:** https://github.com/kcosr/assistant
**GitHub:** https://github.com/kcosr/assistant
**Pricing:** Open-source (MIT)
**Last Updated:** 2026-01-11

## Overview

Assistant is a panel-based personal AI workspace designed for productivity workflows. It provides a unified interface where AI agents collaborate with users through notes, lists, diff reviews, time tracking, and custom workflows. The system emphasizes multi-modal interaction (text and voice) and extensibility through a plugin SDK.

The tool targets power users who want a centralized AI workspace with multiple specialized panels working together. Unlike session-focused tools, Assistant treats the workspace itself as the primary organizing metaphor, with sessions being one of many panel types rather than the central unit.

The project is in early stages (4 GitHub stars, 13 commits) but shows sophisticated architecture with a well-documented plugin SDK and comprehensive WebSocket protocol.

## Key Features

- **Multi-modal interaction** - Text chat with streaming, voice input (Web Speech API), voice output (OpenAI TTS or ElevenLabs)
- **Panel-based workspace** - Flexible dock/split/tab layout system with drag-and-drop
- **Plugin architecture** - SDK for building custom panels with lifecycle methods, state persistence, and WebSocket events
- **Multi-agent support** - Claude Code, Codex, Pi CLI integrations alongside built-in providers
- **MCP tool support** - Model Context Protocol integration over stdio
- **Productivity panels** - Notes, lists, time tracker, diff review, file browser, terminal
- **Session management** - Persistent JSONL conversation logs with multi-client sync
- **Skills export** - Plugins can be exposed as CLI skills for external agents
- **Keyboard-driven** - Comprehensive shortcuts for panel navigation and management

## Technology Stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript (89%), CSS, JavaScript |
| Architecture | Monorepo with npm workspaces |
| Backend | Node.js with WebSocket (JSON + binary audio) |
| Frontend | Browser-based with CSS flexbox panels |
| External APIs | OpenAI, ElevenLabs, MCP servers |
| Persistence | JSONL files, SQLite (time tracker) |

## Comparison with Hilt

### They Have, We Don't

| Feature | Their Implementation | Priority for Us |
|---------|---------------------|-----------------|
| Voice input/output | Web Speech API + OpenAI/ElevenLabs TTS | Low - not aligned with CLI focus |
| Panel-based workspace | Flexible dock/split/tab with drag-and-drop | Medium - could enhance multi-session work |
| Notes plugin | Markdown notes with search, tags, CRUD | Medium - captures longer-form context |
| Lists plugin | Structured lists with tags and filtering | Low - we have inbox/todos |
| Time tracker | Task-based timer with SQLite persistence | Low - adjacent feature |
| Diff review panel | Git diff viewer with comments | Medium - useful for code review workflows |
| File browser panel | Workspace tree with file preview | Low - users have IDEs |
| Plugin SDK | Full lifecycle, events, state persistence | High - enables community extensions |
| Multi-agent chat | Claude, Codex, Pi in same interface | Medium - different model strengths |
| Built-in tools | bash, read, write, edit, ls, grep | Low - we delegate to Claude CLI |
| Skills export | Plugins become CLI tools for agents | Medium - interesting integration pattern |

### We Have, They Don't

| Feature | Our Implementation | Their Gap |
|---------|-------------------|-----------|
| Session-centric organization | Kanban board with To Do/In Progress/Recent | They have sessions panel but no workflow states |
| Scope navigation | Breadcrumbs, folder pinning, recent scopes | No project hierarchy navigation |
| Tree visualization | Squarified treemap with heat scoring | No visual hierarchy overview |
| Running detection | 30-second mtime threshold with indicator | No session activity detection |
| Draft prompts (Inbox) | Queue prompts for future sessions | No pre-session prompt staging |
| Plan file integration | MDX editor for Claude plan files | No plan mode support |
| Session search | Full-text search across prompts | Limited to session list |
| Branch awareness | Git branch display per session | Not visible in session context |
| Scope-aware counts | Inbox counts, activity metrics by folder | No hierarchical metrics |
| Electron app | Native macOS app with IPC transport | Browser-only |

### Both Have (Compare Quality)

| Feature | Theirs | Ours | Winner |
|---------|--------|------|--------|
| Terminal integration | PTY with read/write ops, panel-based | PTY with tabs, drawer, title extraction | **Tie** - different approaches |
| Session persistence | JSONL with multi-client sync | Read Claude's JSONL, separate status DB | **Tie** - they own their format, we adapt to Claude's |
| WebSocket protocol | Multiplexed sessions, audio frames | Terminal I/O, title/context extraction | **Theirs** - more sophisticated protocol |
| UI layout | Flexible panels, splits, tabs | Fixed kanban columns, tree view | **Theirs** - more flexible |
| Documentation | SDK docs, UI spec, well-structured | Architecture doc, design philosophy | **Tie** - both good |
| TypeScript types | Shared package with protocols | Zod schemas, comprehensive interfaces | **Tie** |

## Learning Opportunities

### Features to Consider

1. **Plugin SDK** - Their SDK enables community-built panels with lifecycle hooks (`mount`, `onFocus`, `onBlur`, `onResize`), state persistence, and bidirectional WebSocket events. We could enable custom cards, visualizations, or integrations without forking.

2. **Panel context system** - Panels can publish selections and state (`setContext`, `subscribeContext`) so other panels react without hardcoding. Chat knows what's selected in Files without explicit wiring. Could help our terminal-session relationship.

3. **Diff review panel** - Built-in git diff viewer with comments. For code review workflows, this would let users review changes without leaving the session context. Low-hanging fruit for Claude Code users.

4. **Skills export** - Plugins can be exposed as CLI tools for agents. This creates a bridge between UI features and automation. Our `/track` and `/plan` commands could benefit from this pattern.

### UX Patterns

1. **Panel chrome standardization** - Every panel has consistent title bar with icon, badge/status, close button, and actions menu. Reduces cognitive load when switching between panel types.

2. **Keyboard navigation** - `Ctrl/Cmd + ]` and `[` cycle panel focus. Layout mode hotkey. Panel-specific shortcuts. More comprehensive than our current approach.

3. **Session binding indicator** - Chat panels show which session they're bound to. Clear disambiguation when multiple sessions are visible.

4. **Empty state CTAs** - Empty panels show actionable placeholders, not just "no data" messages.

### Technical Approaches

1. **WebSocket multiplexing** - Single connection handles multiple sessions via subscribe/unsubscribe. More efficient than connection-per-session, enables cross-session features.

2. **Plugin manifest discovery** - Plugins declare capabilities, operations, and panel types in manifest. Runtime discovers and wires without hardcoding.

3. **Context attribute namespacing** - Plugins store session context under `attributes.plugins.<pluginId>.*` to avoid collisions. Good pattern for extensibility.

4. **LRU session caching** - Configurable limit on cached sessions prevents memory bloat. We could benefit from similar bounds on our session parsing.

## Our Unique Value

Hilt's strength is **deep Claude Code integration** with a **workflow-oriented mental model**:

1. **Native Claude session understanding** - We parse Claude's actual JSONL format, detect running sessions, extract plan files, and understand the Claude Code lifecycle. Assistant manages its own sessions.

2. **Workflow states** - Sessions move through To Do → In Progress → Recent. This maps to how developers actually work: queue up tasks, work on them, archive completed. Assistant has sessions but no workflow progression.

3. **Scope navigation** - Projects are first-class. Breadcrumbs, folder pinning, recent scopes, tree visualization - all oriented around "where am I working". Assistant is workspace-centric but not project-hierarchical.

4. **Draft-to-session pipeline** - Inbox items become sessions with initial prompts injected. Queue prompts while working, execute later. Assistant has no prompt staging.

5. **Lightweight focus** - We're a dashboard for Claude Code, not a replacement. Assistant is a full AI workspace that competes with Claude Code itself.

## Verdict

**Adjacent tool, not direct competitor.**

Assistant is building a general-purpose AI workspace with plugin extensibility - closer to an IDE or Obsidian-with-AI. Hilt is a specialized dashboard for Claude Code session management with workflow tracking.

Key differences:
- **Scope**: Assistant = full AI workspace; Hilt = Claude Code companion
- **Sessions**: Assistant = one of many panel types; Hilt = the central organizing unit
- **Extensibility**: Assistant = plugin SDK; Hilt = focused feature set

**Integration opportunity**: If Assistant supports Claude Code as an agent (it does), Hilt could potentially export session context or commands that Assistant consumes. The skills export pattern is interesting - our `/track` and `/plan` commands could become skills.

**Learning priority**: Plugin SDK architecture is the most transferable concept. If Hilt ever wants community extensions, their approach (manifests, lifecycle, context, events) is a solid reference.

---

*Analysis performed: 2026-01-11*
