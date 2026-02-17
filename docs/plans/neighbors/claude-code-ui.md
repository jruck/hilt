# Claude Code UI (Session Tracker)

> Real-time dashboard for monitoring Claude Code sessions across multiple projects

**URL:** https://github.com/KyleAMathews/claude-code-ui
**GitHub:** [KyleAMathews/claude-code-ui](https://github.com/KyleAMathews/claude-code-ui)
**Stars:** 25 | **Forks:** 4
**License:** Not specified
**Last Updated:** 2026-01-08

## Overview

Claude Code Session Tracker by Kyle Mathews (creator of Gatsby) is a real-time monitoring dashboard for Claude Code sessions. It provides a Kanban-style view of what Claude is working on across multiple projects, with AI-powered summaries of session activity.

The key innovation is using XState for deterministic session state derivation and Durable Streams for real-time synchronization. It monitors the `~/.claude/projects/` directory (same as us) and provides a more sophisticated state machine for session status.

This is the most technically similar project to ours - same data source, similar goals, different implementation approach.

## Key Features

- **Real-time session monitoring** via Durable Streams
- **Kanban board** organized by status (Working, Needs Approval, Waiting, Idle)
- **AI-powered summaries** using Claude Sonnet for session activity
- **PR & CI tracking** - shows associated pull requests
- **Multi-repository support** with session grouping
- **Hover cards** with recent output previews

## Technology Stack

**Core:**
- TypeScript (68.3%)
- JavaScript (18.1%)
- React with TanStack Router
- Radix UI components

**Key Dependencies:**
- `@durable-streams/*` - Real-time state synchronization
- `@tanstack/db` - Reactive database layer
- `XState` - State machine for session status
- `Chokidar` - File system monitoring
- Anthropic API - AI summaries

**Architecture:**
- Monorepo with `packages/daemon` and `packages/ui`
- Daemon monitors JSONL files, publishes to Durable Streams
- UI subscribes to streams for real-time updates

## Session State Machine

Their XState-based approach is more sophisticated than ours:

| State | Trigger |
|-------|---------|
| `idle` | 5+ minutes inactivity |
| `working` | Active Claude processing |
| `waiting_for_approval` | Tool use pending user approval |
| `waiting_for_input` | Claude awaiting user response |

**Timeout fallbacks:**
- 5 seconds: pending tool use
- 60 seconds: missing turn-end marker
- 5 minutes: no activity

## Comparison with Hilt

### They Have, We Don't

| Feature | Their Implementation | Priority for Us |
|---------|---------------------|-----------------|
| AI session summaries | Claude Sonnet generates activity summaries | High - very useful |
| Real-time streaming | Durable Streams for instant updates | Medium - we use polling |
| Approval state detection | XState detects "waiting for approval" | High - useful status |
| PR/CI integration | Shows associated PRs and CI status | Medium - nice to have |
| Hover previews | Recent output on hover | Low - nice polish |

### We Have, They Don't

| Feature | Our Implementation | Their Gap |
|---------|-------------------|-----------|
| Status persistence | Manual status + JSON storage | Auto-derived only |
| Terminal integration | Built-in PTY terminal | No terminal |
| Docs viewer | Browse/edit project files | No docs browsing |
| Tree view | Hierarchical organization | Flat by repo |
| Edit mode | Move between columns manually | No manual control |
| Inbox/drafts | Queue prompts for later | No draft concept |
| Scope filtering | Filter by path prefix | Repository-based |
| Search | Full-text search + filters | Not visible |

### Both Have (Compare Quality)

| Feature | Theirs | Ours | Winner |
|---------|--------|------|--------|
| JSONL parsing | Incremental, stateful | Full re-read | Them |
| Status derivation | XState machine | Simple time-based | Them |
| Kanban board | Real-time, 4 columns | Manual, 3 columns | Tie |
| Multi-project | By repository | By scope path | Tie |

## Learning Opportunities

### Features to Consider

1. **AI Session Summaries** (High Priority)
   - Generate summaries of what each session accomplished
   - Could run on session end or on-demand
   - Use Claude to analyze the conversation
   - Show in card tooltip or expanded view

2. **Approval State Detection** (High Priority)
   - Parse JSONL for tool_use without tool_result
   - Add "Needs Approval" indicator to running sessions
   - Helps prioritize which terminal to check

3. **XState for Status** (Medium Priority)
   - More robust state derivation
   - Handle edge cases better
   - Cleaner timeout logic

4. **Incremental JSONL Parsing** (Medium Priority)
   - Don't re-parse entire file on changes
   - Track file position, parse only new lines
   - Better performance for long sessions

### UX Patterns

1. **Hover previews** - Show recent output without clicking
2. **Repository grouping** - Visual separation by project
3. **Status badges** - Clear visual indicators

### Technical Approaches

1. **Durable Streams** - Interesting for real-time sync
2. **XState** - Cleaner state machine implementation
3. **TanStack DB** - Reactive database queries

## Our Unique Value

**Full workflow management vs monitoring only**

Claude Code UI is a monitoring dashboard - it shows what's happening but doesn't help you manage your work. We provide:
- Active workflow management (move cards between columns)
- Draft/queue system for planning work
- Terminal integration for actually running sessions
- Docs browsing for context while working
- Manual status for human-meaningful organization

They're watching Claude work. We're organizing how you work with Claude.

## Verdict

**Closest technical cousin - learn from their innovations**

Same data source, similar goals, complementary features. Their XState-based status derivation and AI summaries are worth adopting. Their real-time architecture is more sophisticated.

Key differences:
- They: Monitoring-focused, auto-derived status, real-time
- Us: Workflow-focused, manual status, integrated tools

**Actionable items:**
1. Adopt AI session summaries
2. Add "waiting for approval" detection
3. Consider incremental JSONL parsing
4. Evaluate XState for status logic

---

*Analysis performed: 2026-01-08*
*Sources: [GitHub Repository](https://github.com/KyleAMathews/claude-code-ui)*
