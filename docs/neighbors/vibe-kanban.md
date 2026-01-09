# Vibe Kanban

> Orchestrate AI Coding Agents - Get 10X more out of Claude Code, Codex or any coding agent

**URL:** https://www.vibekanban.com/
**GitHub:** [BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban)
**Stars:** 14.1k | **Forks:** 1.3k
**License:** Apache-2.0
**Last Updated:** 2026-01-08 (v0.0.145)

## Overview

Vibe Kanban by BloopAI is the most popular open-source tool in this space with 14k+ stars. It's a task orchestration platform for managing multiple AI coding agents in parallel. The key innovation is using git worktrees to give each agent an isolated workspace, preventing conflicts.

Unlike our session-tracking approach, Vibe Kanban is task-centric. You define coding tasks, assign them to agents, and the agents execute in isolated environments. It supports multiple agents: Claude Code, Codex, Gemini CLI, Cursor CLI, Amp, GitHub Copilot, and more.

Their VS Code extension and MCP server integration make it a hub for AI-assisted development workflows.

## Key Features

- **Parallel Agent Execution** - Run multiple coding agents simultaneously without conflicts
- **Git Worktree Isolation** - Each agent operates in a separate worktree
- **Built-in Code Review** - Integrated diff tools for inspecting agent changes
- **Multi-Agent Support** - Claude Code, Codex, Gemini CLI, Cursor CLI, Amp, Copilot, Qwen, Opencode
- **VS Code Extension** - Monitor and control agents from IDE
- **MCP Server** - Connect third-party MCP clients (Claude Desktop)
- **GitHub Integration** - Automatic PR creation, rebasing, merging
- **Remote SSH Access** - Self-host and access from anywhere

## Technology Stack

**Backend:**
- Rust (59% of codebase)
- PostgreSQL with sqlx
- Tauri for desktop

**Frontend:**
- TypeScript (38.5%)
- React
- pnpm workspaces

**Architecture:**
```
├── crates/           → Rust backend modules
├── frontend/         → React/TypeScript UI
├── npx-cli/          → NPM CLI wrapper (npx vibe-kanban)
├── remote-frontend/  → SSH remote access UI
├── shared/           → Shared code
```

**Installation:** `npx vibe-kanban`

## Comparison with Hilt

### They Have, We Don't

| Feature | Their Implementation | Priority for Us |
|---------|---------------------|-----------------|
| Git worktree isolation | Each task gets isolated worktree | Low - different model |
| Multi-agent support | 9+ different AI agents | Medium - could expand |
| VS Code extension | IDE integration for monitoring | Medium - nice to have |
| MCP server | Connect Claude Desktop etc | High - powerful integration |
| Built-in code review | Diff viewer for changes | Medium - we have docs viewer |
| GitHub PR integration | Create/rebase/merge PRs | Low - external workflow |
| Agent switching | Choose agent per task | Medium - interesting |
| Remote SSH access | Self-host, access anywhere | Low - we're local-first |

### We Have, They Don't

| Feature | Our Implementation | Their Gap |
|---------|-------------------|-----------|
| Session-centric view | Track Claude Code sessions | Task-centric only |
| Built-in terminal | Run sessions inline | External terminals |
| Docs viewer | Browse project files | No file browsing |
| Tree view | Hierarchical organization | Flat task list |
| Inbox/drafts | Queue prompts for later | No draft system |
| Lightweight install | Next.js + Node | Rust + PostgreSQL |
| Read existing sessions | Parses ~/.claude | Creates new tasks only |

### Both Have (Compare Quality)

| Feature | Theirs | Ours | Winner |
|---------|--------|------|--------|
| Kanban board | Task-focused | Session-focused | Tie - different purpose |
| Parallel execution | Via worktrees | Via multiple terminals | Them (safer) |
| Open source | Apache-2.0, 14k stars | MIT, new | Them (maturity) |
| Search | Present | Full-text + filters | Tie |
| Git integration | Deep (worktrees, PRs) | Branch display | Them |

## Learning Opportunities

### Features to Consider

1. **MCP Server Integration** (High Priority)
   - Expose our session data via MCP
   - Let Claude Desktop query our board
   - Enable "check my Hilt" from any MCP client
   - Could be powerful for cross-tool workflows

2. **Agent Switching** (Medium Priority)
   - Support different AI agents beyond Claude Code
   - Codex, Gemini CLI becoming popular
   - Would need to track different session formats

3. **VS Code Extension** (Medium Priority)
   - Show session status in IDE
   - Quick actions from editor
   - Session picker sidebar

4. **Code Review/Diff View** (Medium Priority)
   - Show git diff for session's changes
   - Integrate into session card or detail view
   - Help review what Claude accomplished

### UX Patterns

1. **npx installation** - Zero friction startup
2. **Agent dropdown** - Easy agent switching
3. **Worktree status** - Clear isolation indicators
4. **Remote access** - SSH tunnel for self-hosted

### Technical Approaches

1. **Rust backend** - Performance and reliability
2. **Git worktrees** - Isolation without copying repos
3. **Tauri** - Modern desktop app framework
4. **PostgreSQL** - Robust data persistence

## Our Unique Value

**Session management vs task orchestration**

Vibe Kanban is about creating and executing new coding tasks. We're about organizing and managing existing Claude Code sessions.

Key differentiators:
- We work with existing `~/.claude` sessions, they create new ones
- We're lightweight (Next.js), they're heavyweight (Rust + PostgreSQL)
- We have built-in terminal and docs viewer
- We focus on individual workflow, they focus on parallel execution

Our approach is better for:
- Developers who already use Claude Code directly
- Those who want to organize existing work
- Users who prefer integrated terminal experience
- Single-developer workflows

Their approach is better for:
- Teams running many parallel AI tasks
- Those who want agent isolation via worktrees
- Users who need multi-agent support
- CI/CD integration workflows

## Verdict

**Major player in adjacent space - different philosophy**

Vibe Kanban is the 800lb gorilla of AI coding orchestration (14k stars). But their philosophy differs from ours:
- They: Task execution platform, create-and-run workflow
- Us: Session management tool, organize existing work

We're not directly competing - users could use both. They create isolated task environments; we organize ongoing session history.

**Actionable items:**
1. Consider MCP server for interoperability
2. Watch their VS Code extension approach
3. Git worktrees are interesting for advanced users
4. Their community/docs quality is worth studying

---

*Analysis performed: 2026-01-08*
*Sources: [Website](https://www.vibekanban.com/), [GitHub](https://github.com/BloopAI/vibe-kanban)*
