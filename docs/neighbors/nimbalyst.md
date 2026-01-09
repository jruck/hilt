# Nimbalyst

> A Better Way to Work with Claude Code - Local WYSIWYG editor and session manager

**URL:** https://nimbalyst.com/
**GitHub:** [Nimbalyst/nimbalyst](https://github.com/Nimbalyst/nimbalyst) (issues/releases only)
**Company:** Stravu
**Pricing:** Free (requires Claude Pro or Max subscription)
**Platforms:** macOS, Windows, Linux
**Last Updated:** 2026

## Overview

Nimbalyst positions itself as an "Integrated Vibe Environment" (IVE) - a WYSIWYG editor that integrates document editing, diagrams, mockups, and Claude Code session management. Their pitch: eliminate the cognitive overhead of juggling Claude Code, Obsidian, and Cursor in separate windows.

The key innovation is combining document editing with AI session management. You can write markdown, create Mermaid diagrams, build HTML mockups, and manage Claude sessions all in one interface. AI can annotate and iterate on your mockups directly.

Related: Stravu also created Crystal, an open-source multi-session manager (2.7k stars).

## Key Features

- **WYSIWYG markdown editor** - Local, no cloud
- **Mermaid diagram support** - Visual diagrams inline
- **HTML mockup editing** - Build and preview mockups
- **Data model visualization** - Schema diagrams
- **Parallel Claude Code sessions** - Multiple sessions side-by-side
- **Session management** - Resume, search, organize
- **AI diffs** - Red/green diff view for code changes
- **MCP support** - Model Context Protocol integration
- **Git integration** - Local file management with version control

## Technology Stack

**Platform:**
- Electron desktop application
- Cross-platform: macOS (.dmg), Windows (.exe), Linux (.AppImage)
- Local-first architecture

**Security:**
- SOC Type II certified
- No server infrastructure
- Data stays on device

**Related Project - Crystal:**
- Open source (MIT)
- 2.7k stars, 172 forks
- Same multi-session concept
- Built by same team (Stravu)

## Crystal (Open Source Sibling)

Crystal is worth noting as it's open-source with similar goals:

**Tech Stack:**
- TypeScript (96.8%)
- Electron
- pnpm workspaces
- Playwright for testing

**Features:**
- Multi-session Claude/Codex management
- Git worktree isolation
- Diff viewer
- Squash/merge workflows

**Installation:**
- Homebrew: `brew install --cask stravu-crystal`
- Or download DMG

## Comparison with Hilt

### They Have, We Don't

| Feature | Their Implementation | Priority for Us |
|---------|---------------------|-----------------|
| WYSIWYG editor | Rich document editing | Low - different focus |
| Mermaid diagrams | Inline diagram rendering | Low - nice but niche |
| HTML mockups | Preview mockups with AI | Low - different use case |
| Desktop app | Native Electron experience | Low - web is flexible |
| SOC Type II | Enterprise security cert | Low - overkill for us |
| Data model viz | Schema diagrams | Medium - interesting |

### We Have, They Don't

| Feature | Our Implementation | Their Gap |
|---------|-------------------|-----------|
| Web-based | No install required | Requires download |
| Open source | MIT, fully open | Closed source (Nimbalyst) |
| Built-in terminal | Run sessions inline | External terminal |
| Kanban board | Visual workflow management | Session list only |
| Tree view | Hierarchical organization | Flat structure |
| Inbox/drafts | Queue prompts | No draft concept |
| Lightweight | Next.js, instant start | Electron, heavier |

### Both Have (Compare Quality)

| Feature | Theirs | Ours | Winner |
|---------|--------|------|--------|
| Session management | Rich UI, parallel | Kanban + terminal | Tie |
| Docs viewing | WYSIWYG editor | Read + edit | Them (richer) |
| Cross-platform | Electron apps | Web-based | Tie |
| Local-first | Yes | Yes | Tie |
| Git integration | Worktrees, diffs | Branch display | Them |
| MCP support | Yes | Not yet | Them |

## Learning Opportunities

### Features to Consider

1. **AI Diff View** (Medium Priority)
   - Show red/green diffs for session changes
   - Visualize what Claude modified
   - Could integrate with git diff

2. **Session Resume/Search** (High Priority)
   - Quick resume of previous sessions
   - Search across session history
   - We have some of this but could improve

3. **Diagram Support** (Low Priority)
   - Mermaid rendering in docs viewer
   - Nice for architectural docs
   - Not core to our mission

### UX Patterns

1. **Integrated editor** - Docs and sessions in one view
2. **AI annotation on mockups** - Interesting for design work
3. **Session search** - Find previous work quickly

### Technical Approaches

1. **Electron** - Cross-platform desktop
2. **WYSIWYG with Markdown** - Rich editing experience
3. **SOC Type II** - Enterprise-ready security

## Our Unique Value

**Lightweight workflow management vs heavy document editor**

Nimbalyst wants to be your everything tool - editor, diagram tool, mockup builder, AND session manager. We focus on one thing: organizing Claude Code sessions.

| Nimbalyst Approach | Our Approach |
|-------------------|--------------|
| All-in-one editor | Focused session manager |
| Desktop app required | Web, instant access |
| Document-centric | Workflow-centric |
| Rich editing | Lightweight viewing |

For developers who want Obsidian + Claude Code merged, Nimbalyst is compelling. For those who want quick session organization without switching tools, we're simpler.

## Crystal as Reference

Crystal (their open-source project) is more comparable to us:
- Session management focus
- Git worktree isolation
- Diff viewing
- MIT licensed

Worth studying Crystal's architecture and features for ideas.

## Verdict

**Different philosophy - editor vs organizer**

Nimbalyst is building an "IDE for AI-assisted work" with rich document editing. We're building a "dashboard for Claude Code sessions."

Key differences:
- They: Document-centric, heavy features, Electron app
- Us: Session-centric, lightweight, web-based

**Actionable items:**
1. Study Crystal (open source) for implementation ideas
2. AI diff view is worth considering
3. Their WYSIWYG is overkill for our use case
4. Session search/resume UX worth improving

---

*Analysis performed: 2026-01-08*
*Sources: [Website](https://nimbalyst.com/), [GitHub](https://github.com/Nimbalyst/nimbalyst), [Crystal](https://github.com/stravu/crystal)*
