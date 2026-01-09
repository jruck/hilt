# Conductor

> Run a team of coding agents on your Mac

**URL:** https://www.conductor.build/
**GitHub:** [meltylabs](https://github.com/meltylabs) (releases only, closed source)
**Company:** Melty Labs (Y Combinator backed)
**Platform:** macOS only (Apple Silicon)
**Pricing:** Free (uses your Claude API key or subscription)
**Last Updated:** 2026

## Overview

Conductor by Melty Labs is a macOS-native application for running multiple Claude Code and Codex agents in parallel. It focuses on simplicity and local execution - "no cloud server needed, everything runs on your Mac."

The key differentiator is the one-click agent spawning with automatic git worktree isolation. They also have deep Linear integration for issue tracking. The team (Charlie Holtz from Replicate, Jackson de Campos from Netflix ML) brings strong product/infrastructure backgrounds.

Conductor is closed source, distributed as a Mac app, and backed by Y Combinator. This positions them as a venture-backed commercial product vs our open-source approach.

## Key Features

- **One-click agent launch** - Start Claude Code in isolated worktree instantly
- **Parallel agent execution** - Multiple agents working simultaneously
- **Git worktree isolation** - Each agent gets clean workspace
- **Linear integration** - Start work on Linear issues directly
- **Unified dashboard** - See all agent activity at a glance
- **Code review & merge** - Review and integrate changes
- **Local execution** - No cloud required

## Technology Stack

**Platform:**
- macOS native application
- Apple Silicon required (Intel support in progress)
- Git worktree-based architecture

**Supported Agents:**
- Claude Code
- OpenAI Codex

**Auth Methods:**
- Claude API key
- Claude Pro plan
- Claude Max plan

**Related Projects:**
- Melty - "Chat first code editor"
- DesktopCommanderMCP - Terminal/filesystem MCP server
- Chorus - AI chat app for Mac

## Comparison with Claude Kanban

### They Have, We Don't

| Feature | Their Implementation | Priority for Us |
|---------|---------------------|-----------------|
| One-click agent launch | Spawn Claude in worktree instantly | High - great UX |
| Git worktree isolation | Automatic isolation per agent | Low - different model |
| Linear integration | Pull issues, start work | Medium - nice workflow |
| Native Mac app | Polished desktop experience | Low - web works fine |
| Codex support | Multiple agent types | Medium - could expand |
| VC backing | Resources for development | N/A |

### We Have, They Don't

| Feature | Our Implementation | Their Gap |
|---------|-------------------|-----------|
| Open source | MIT licensed, customizable | Closed source |
| Cross-platform | Web-based, works anywhere | Mac-only |
| Session history | Parse existing ~/.claude sessions | Creates new only |
| Built-in terminal | Run sessions in UI | Spawns external |
| Docs viewer | Browse project files | No file browsing |
| Tree view | Hierarchical organization | Dashboard only |
| Inbox/drafts | Queue prompts for later | No draft system |
| Intel Mac support | Works on any Mac | Apple Silicon only |

### Both Have (Compare Quality)

| Feature | Theirs | Ours | Winner |
|---------|--------|------|--------|
| Parallel execution | Worktree-based | Terminal-based | Them (safer) |
| Dashboard | Polished native | Web-based | Them (native) |
| Local-first | Yes | Yes | Tie |
| Git integration | Deep (worktrees, review) | Branch display | Them |
| Privacy | Data stays local | Data stays local | Tie |

## Learning Opportunities

### Features to Consider

1. **One-Click Agent Launch** (High Priority)
   - "New Session" button that spawns Claude
   - Pre-populate with scope/context
   - Could open in our integrated terminal
   - Dramatically reduces friction

2. **Linear/Issue Tracker Integration** (Medium Priority)
   - Pull issues from Linear/GitHub
   - Associate sessions with issues
   - Track which issue a session addresses

3. **Agent Activity Dashboard** (Medium Priority)
   - Real-time view of what each session is doing
   - Similar to claude-code-ui's approach
   - Quick status across all active work

### UX Patterns

1. **"Start from Linear"** - Issue → Agent flow
2. **Worktree status indicators** - Clear isolation state
3. **One-click spawning** - Minimal friction to start

### Technical Approaches

1. **Git worktrees** - Clean isolation strategy
2. **Native Mac app** - Better system integration
3. **Linear API** - Issue tracker integration

## Our Unique Value

**Open, cross-platform, session-centric**

Conductor is:
- Closed source
- Mac-only (Apple Silicon)
- Task/issue-centric
- Creates new work

We are:
- Open source
- Cross-platform (web)
- Session-centric
- Organize existing work

For Mac-owning developers who want polished parallel agent execution, Conductor wins on UX. For everyone else, or those who want to customize their tools, we're the option.

## Controversy Note

Conductor faced backlash over GitHub permissions requests. Some users were concerned about the scope of access requested. This highlights the trust advantage of local, open-source tools like ours.

## Verdict

**Well-funded competitor - different platform philosophy**

Conductor has VC backing, strong team, and polished product. But they've made strategic choices that create gaps we fill:

| Their Choice | Our Opportunity |
|--------------|-----------------|
| Mac-only | Cross-platform |
| Closed source | Open, customizable |
| Task-centric | Session history |
| Native app | Web accessibility |

**Actionable items:**
1. One-click agent launch is the feature to copy
2. Linear integration is interesting for power users
3. Their GitHub permissions controversy = our trust advantage
4. Watch for Windows/Linux expansion from them

---

*Analysis performed: 2026-01-08*
*Sources: [Website](https://www.conductor.build/), [Y Combinator](https://www.ycombinator.com/companies/conductor), [GitHub Org](https://github.com/meltylabs)*
