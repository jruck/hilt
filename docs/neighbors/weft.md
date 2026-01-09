# Weft

> Self-hosted AI agent task management with approval gates

**URL:** https://github.com/jonesphillip/weft
**GitHub:** [jonesphillip/weft](https://github.com/jonesphillip/weft)
**Stars:** 210 | **Forks:** 25
**License:** Apache-2.0
**Last Updated:** Recent (3 commits on main)

## Overview

Weft is a self-hosted task management system where AI agents autonomously execute assigned work. Unlike coding-focused tools, Weft targets broader automation: email, documents, spreadsheets, and code repositories. Users create tasks, delegate them to agents, and approve state-mutating actions.

The key differentiator is the approval gate system - all mutations require user confirmation. This positions Weft as a cautious, human-in-the-loop automation platform rather than a hands-off executor.

Built entirely on Cloudflare's platform (Workers, Durable Objects, Workflows), it's designed for cloud-native deployment with real-time WebSocket updates.

## Key Features

- **Multi-domain agents** - Not just code: Gmail, Google Docs/Sheets, GitHub
- **Approval gates** - All state-mutating actions require user confirmation
- **Parallel execution** - Run as many agents as needed
- **MCP server integration** - Extensible tool framework
- **Cloudflare-native** - Workers, Durable Objects, Workflows
- **Real-time updates** - WebSocket communication for live board
- **Notifications** - Task completion and approval request alerts
- **Self-hosted** - Deploys to user's Cloudflare account

## Technology Stack

**Frontend:**
- React with TypeScript
- Vite
- CSS

**Backend:**
- TypeScript on Cloudflare Workers
- Durable Objects for state
- Workflows for agent execution

**Infrastructure:**
- Cloudflare Workers (HTTP/auth)
- Durable Objects (persistent state)
- Workflows (durable agent loop with retry)
- Cloudflare Sandboxes (isolated code execution)

**AI:** Anthropic Claude API

## Architecture

```
worker/          - Backend logic, integrations, MCP registry
src/             - React components, hooks, API client
wrangler.jsonc   - Cloudflare configuration
```

**Key design:**
- Registry-driven tool architecture
- Per-board Anthropic API key configuration
- Encrypted credential storage
- OAuth for Google and GitHub

## Comparison with Claude Kanban

### They Have, We Don't

| Feature | Their Implementation | Priority for Us |
|---------|---------------------|-----------------|
| Approval gates | All mutations need confirmation | Low - we trust user |
| Non-code integrations | Gmail, Docs, Sheets | Low - we're code-focused |
| Cloudflare deployment | Workers + Durable Objects | Low - we're local-first |
| Agent notifications | Alerts for completion/approval | Medium - could be useful |
| MCP tool registry | Add integrations without code changes | Medium - interesting pattern |

### We Have, They Don't

| Feature | Our Implementation | Their Gap |
|---------|-------------------|-----------|
| Local-first | No cloud dependency | Requires Cloudflare account |
| Session tracking | Parse existing Claude sessions | Creates new tasks only |
| Terminal integration | Built-in PTY | External execution |
| Docs viewer | Browse project files | No file browsing |
| Zero-config | Works out of box | Complex setup required |
| Privacy | Data stays local | Data on Cloudflare |
| Offline | Works without internet | Cloud-dependent |

### Both Have (Compare Quality)

| Feature | Theirs | Ours | Winner |
|---------|--------|------|--------|
| Kanban board | Task-focused | Session-focused | Tie |
| Open source | Apache-2.0 | MIT | Tie |
| Real-time updates | WebSocket | Polling | Them |
| Multi-agent | Parallel via Workflows | Via terminals | Them |

## Learning Opportunities

### Features to Consider

1. **Approval Notifications** (Medium Priority)
   - Alert when a session needs user input
   - Desktop notification or badge
   - Ties into "waiting for approval" detection

2. **MCP Tool Registry** (Medium Priority)
   - Dynamic tool registration pattern
   - Could enable custom integrations
   - Interesting architecture pattern

### UX Patterns

1. **Approval gates** - Clear action/consequence before mutations
2. **Board-level configuration** - Per-project settings
3. **Completion notifications** - Know when agents finish

### Technical Approaches

1. **Cloudflare Durable Objects** - Interesting for state management
2. **Workflows** - Durable execution with checkpointing
3. **Registry pattern** - Extensible tool architecture

## Our Unique Value

**Local simplicity vs cloud complexity**

Weft requires:
- Cloudflare Workers Paid plan
- Docker for sandboxes
- OAuth credentials for Google/GitHub
- Anthropic API key configuration

We require:
- npm install && npm run dev

For individual developers managing Claude Code sessions, our zero-config local approach is dramatically simpler. Weft is for teams building automated workflows; we're for developers organizing their own work.

## Verdict

**Different category - automation platform vs session manager**

Weft is an AI automation platform that happens to support coding. We're a Claude Code session manager that focuses on coding workflows.

Key differences:
- They: Cloud-hosted, multi-domain, approval-focused
- Us: Local-first, code-focused, lightweight

**Overlap:** Both use Kanban metaphor for AI task organization
**Divergence:** They automate diverse tasks; we organize coding sessions

**Actionable items:**
1. Notification system is worth considering
2. MCP registry pattern is interesting
3. Approval gates could be overkill for our use case
4. Their Cloudflare architecture is clever but complex

---

*Analysis performed: 2026-01-08*
*Sources: [GitHub](https://github.com/jonesphillip/weft)*
