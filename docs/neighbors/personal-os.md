# PersonalOS

> Framework for a local AI agent powered task management system

**URL:** https://github.com/amanaiproduct/personal-os
**GitHub:** 225 stars, 42 forks, 3 contributors
**Pricing:** CC BY-NC-SA 4.0 (free for non-commercial use)
**Last Updated:** 2026-01-11

## Overview

PersonalOS is a file-based task management framework designed for use with Claude and other AI assistants. It centers on a "brain dump → AI processing → prioritized tasks" workflow where users capture unstructured thoughts in a BACKLOG.md file, and Claude processes them into structured task files with YAML frontmatter.

The system is optimized for product managers and solo practitioners who want AI-enhanced personal productivity without cloud dependencies. It uses an MCP server for deduplication and task operations, AGENTS.md instructions to configure Claude's behavior, and a goals-driven prioritization system.

Unlike Hilt which focuses on managing existing Claude Code sessions, PersonalOS creates a parallel task management system that Claude reads and writes to. It's more of an "AI-powered todo app framework" than a session management tool.

## Key Features

- **Brain dump processing** - Capture unstructured notes in BACKLOG.md, let Claude parse and organize
- **Smart deduplication** - MCP tool compares new tasks against existing ones using similarity scoring (60% threshold)
- **Priority system** - P0-P3 with recommended limits (3/5/10 tasks per tier)
- **Status tracking** - n (not started), s (started), b (blocked), d (done), r (recurring)
- **Time estimates** - Built-in time tracking per task
- **Category auto-assignment** - Outreach, technical, research, writing, admin, marketing
- **Goals alignment** - Tasks reference GOALS.md for priority decisions
- **Session evaluation** - Tools to review and annotate past AI sessions
- **Proactive suggestions** - Time-of-day task recommendations (morning: outreach, afternoon: deep work)
- **Ambiguity detection** - Flags vague items and asks clarification questions

## Technology Stack

- Python 84.9%, Shell 15.1%
- MCP server (stdio transport)
- PyYAML for frontmatter
- SequenceMatcher for similarity
- File-based storage (markdown + YAML)
- No database, no external services

## Comparison with Hilt

### They Have, We Don't

| Feature | Their Implementation | Priority for Us |
|---------|---------------------|-----------------|
| Smart deduplication | MCP tool with 0.6 similarity threshold | Low - different problem space |
| Goals-driven prioritization | GOALS.md + AI reasoning | Medium - could inform session prioritization |
| Time estimates per task | YAML frontmatter field | Low - we track sessions not tasks |
| Ambiguity detection | Regex patterns + clarification questions | Low - not relevant to session management |
| Session evaluation tools | Dedicated eval workflow with judgement annotations | Medium - could help review past sessions |
| Time-of-day recommendations | Proactive suggestions based on hour | Low - interesting UX but tangential |
| Category auto-assignment | Pattern matching in MCP server | Low - our scopes serve similar purpose |

### We Have, They Don't

| Feature | Our Implementation | Their Gap |
|---------|-------------------|-----------|
| Visual session management | Kanban board, tree view | They're CLI-only |
| Integrated terminal | Run Claude sessions inline with xterm.js | No execution capability |
| Real-time session monitoring | 30-second mtime detection for running status | No session awareness |
| Session history browsing | Parse JSONL, display conversations | Tasks only, no session context |
| Multiple view modes | Board, tree, docs views | Single file system structure |
| Scope/project filtering | Prefix-based grouping | Basic category only |
| Branch context | Git integration per session | No git awareness |

### Both Have (Compare Quality)

| Feature | Theirs | Ours | Winner |
|---------|--------|------|--------|
| Status tracking | 5 states (n/s/b/d/r) | 3 states (inbox/active/recent) | Theirs - more granular |
| Priority system | P0-P3 with limits | Manual drag-drop ordering | Theirs - more structured |
| Local-first storage | Markdown files | JSON + JSONL | Tie - both local-first |
| MCP integration | Task management tools | Planned | Theirs - already built |
| CLAUDE.md guidance | Rich AGENTS.md template | Project instructions | Theirs - more prescriptive |

## Learning Opportunities

### Features to Consider

1. **Session Evaluation System** - Their eval workflow (list_evals, generate_eval, annotate_eval) provides a structured way to review past sessions. We could adapt this for session quality tracking.

2. **Proactive System Checks** - They run automatic checks (priority distribution, aging tasks) without being asked. We could add proactive notifications for stale sessions or unresolved inbox items.

3. **Goals Alignment** - The concept of anchoring work to stated goals (GOALS.md) could inform session prioritization. Sessions working toward key goals could be auto-elevated.

### UX Patterns

1. **Brain Dump → Processing Flow** - The explicit capture-then-organize workflow reduces cognitive load. Our inbox serves a similar purpose but could be more explicit about the processing step.

2. **Clarification Questions** - Asking "What specific aspect of X do you want to address?" before creating tasks is a nice touch. Could apply to draft prompts in our inbox.

3. **Time-Based Recommendations** - "Morning is good for outreach" type suggestions could inspire session-type recommendations.

### Technical Approaches

1. **Similarity Scoring** - Their SequenceMatcher + keyword overlap approach (70%/30% weighted) is simple and effective. Could apply to detecting duplicate sessions or related work.

2. **YAML Frontmatter** - Their task files use YAML metadata cleanly. We use JSON; could consider YAML for human-editable config.

3. **MCP Server Architecture** - Their server.py is a good reference for building Hilt's planned MCP server. Clean tool definitions with async handlers.

## Our Unique Value

Hilt and PersonalOS solve fundamentally different problems:

- **PersonalOS** creates a new task management layer that AI interacts with
- **Hilt** surfaces and organizes existing Claude Code session data

PersonalOS requires users to adopt a new workflow (brain dump → process → tasks). Hilt works with existing Claude Code usage without behavior change.

Our key advantages:
1. **Zero workflow change** - Use Claude Code normally, we organize what's already there
2. **Visual management** - Kanban board vs. file system navigation
3. **Session context preservation** - See conversations, not just task titles
4. **Integrated execution** - Run sessions without leaving the UI
5. **Running session awareness** - Know what's actively in progress

## Verdict

**Category:** Adjacent tool, not direct competitor

PersonalOS is a task management framework that happens to use Claude as the processing engine. Hilt is a session management UI for Claude Code. They could coexist:
- PersonalOS for planning and task tracking
- Hilt for session execution and monitoring

**Integration opportunity:** PersonalOS tasks could spawn Claude Code sessions tracked in Hilt. We could read their task files and suggest sessions to work on them.

**Threat level:** Low - different problem space, different user workflow

---

*Analysis performed: 2026-01-11*
