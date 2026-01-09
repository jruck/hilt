# Neighbors

Competitive analysis and tracking of complementary tools in the Claude/AI coding assistant space.

## Purpose

Track tools that solve similar problems or operate in adjacent spaces to understand:
- What features they offer that we could learn from
- What makes our approach unique
- Where the market is heading
- Potential integration opportunities

## Structure

```
neighbors/
├── README.md           # This file
├── agent/              # Agent prompts for analysis
│   └── competitive-analysis.md
└── [tool-name].md      # Individual tool analyses
```

## How to Add a New Analysis

Run the competitive analysis agent with a competitor's URL:

```
Analyze this tool: [URL]
```

The agent will research the tool and generate a report in this folder.

## Analyses

| Tool | Category | Key Insight |
|------|----------|-------------|
| [Lightsprint](lightsprint.md) | AI Task Management | Cloud-first team tool; we differentiate with local-first privacy |
| [Claude Code UI](claude-code-ui.md) | Session Monitoring | Closest technical cousin - learn AI summaries, XState status |
| [Vibe Kanban](vibe-kanban.md) | Agent Orchestration | 14k stars, task-centric; consider MCP server integration |
| [Weft](weft.md) | AI Automation | Cloud-hosted, multi-domain; different category |
| [Conductor](conductor.md) | Mac Agent Runner | VC-backed, closed-source; one-click launch is key feature |
| [Nimbalyst](nimbalyst.md) | Editor + Sessions | Document-centric; we're simpler, workflow-focused |

## Summary Insights

### High-Priority Features to Consider
1. **AI Session Summaries** - claude-code-ui shows this is valuable
2. **One-Click Agent Launch** - Conductor's killer UX feature
3. **"Waiting for Approval" Detection** - XState approach from claude-code-ui
4. **MCP Server** - Vibe Kanban's interoperability play

### Our Unique Positioning
- **Local-first + Open Source** - Only fully open option with no cloud dependency
- **Session-centric** - We organize existing work, others create new tasks
- **Built-in Terminal** - No other tool runs sessions inline
- **Lightweight** - Next.js vs Rust/Electron/Cloudflare complexity

### Competitive Landscape
```
                    Local ←————————→ Cloud
                      │                │
    Session-centric   │  Claude Kanban │  Lightsprint
                      │  claude-code-ui│
                      │                │
    Task-centric      │  Conductor     │  Vibe Kanban
                      │  Nimbalyst     │  Weft
                      │  Crystal       │
```
