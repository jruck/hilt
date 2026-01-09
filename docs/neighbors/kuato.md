# Kuato

> Easily recall what you discussed with your favorite coding agents, what decisions you made, and where you left off

**URL:** https://github.com/alexknowshtml/kuato
**GitHub:** [alexknowshtml/kuato](https://github.com/alexknowshtml/kuato)
**Stars:** 65 | **Forks:** 1
**License:** MIT
**Last Updated:** 2026-01-09

## Overview

Kuato solves the persistent memory problem for AI coding agents. Claude Code forgets everything between sessions, making it hard to resume work or recall past decisions. Kuato indexes your session history and provides fast search across all conversations.

The project offers two implementations: a zero-setup file-based version for quick lookups, and a PostgreSQL-powered version for production use with sub-100ms queries, full-text search, and a REST API.

The key insight is that "user messages are what define the actions that matter" - rather than indexing full transcripts, Kuato focuses on the user's requests, decisions, corrections, and completions.

## Key Features

- **Full-text search** across all Claude Code sessions
- **Two deployment options**: File-based (zero setup) or PostgreSQL (production-grade)
- **PostgreSQL FTS** with stemming, stop-word removal, weighted ranking
- **REST API** for programmatic access (`/sessions?search=...`)
- **Claude Code skill integration** - teach Claude to query Kuato for context
- **Time filtering** - search within specific day ranges
- **Session statistics** - token counts and usage patterns
- **Transcript retrieval** - get full conversation when needed

## Technology Stack

- **Runtime:** Bun
- **Language:** TypeScript (87.4%)
- **Database:** PostgreSQL (optional)
- **Search:** PostgreSQL `tsvector`/`tsquery` with GIN indexes
- **SQL:** PLpgSQL stored procedures (12.6%)

## Comparison with Hilt

### They Have, We Don't

| Feature | Their Implementation | Priority for Us |
|---------|---------------------|-----------------|
| Full-text search | PostgreSQL FTS with stemming | Medium - we have basic search |
| REST API | `/sessions?search=...` endpoint | Low - we're UI-first |
| Claude skill integration | Skill file for "where did we leave off" | High - great UX pattern |
| Session statistics | Token counts, usage over time | Low - analytics backlog |
| File-based zero-setup mode | `bun run search.ts --query "..."` | Low - we have npm run |

### We Have, They Don't

| Feature | Our Implementation | Their Gap |
|---------|-------------------|-----------|
| Visual UI | Kanban board, tree view, docs browser | CLI/API only |
| Terminal integration | Built-in PTY for running sessions | No session interaction |
| Status/workflow tracking | Inbox, Active, Recent columns | No status concept |
| Scope filtering | Filter by project path prefix | Query-based only |
| Real-time updates | Polling for running sessions | Sync on demand |
| Draft prompts | Queue prompts in Inbox for later | No draft concept |
| Session organization | Manual status assignment | Search-only discovery |

### Both Have (Compare Quality)

| Feature | Theirs | Ours | Winner |
|---------|--------|------|--------|
| Session parsing | User messages only | Full JSONL read | Depends on use case |
| Search | PostgreSQL FTS | Basic substring | Them |
| JSONL source | `~/.claude/projects/` | Same | Tie |
| Time filtering | `--days N` parameter | Last modified sort | Them (explicit) |

## Learning Opportunities

### Features to Consider

1. **Claude Skill Integration** (High Priority)
   - Kuato includes a skill template that teaches Claude to query session history
   - "Where did we leave off on X?" becomes answerable
   - Could create a Hilt MCP server or skill for this pattern
   - Enables context recall without leaving Claude Code

2. **PostgreSQL Full-Text Search** (Medium Priority)
   - Our current search is basic substring matching
   - PostgreSQL FTS offers stemming (find "running" when searching "run")
   - Weighted ranking (user messages > file paths)
   - Worth considering if search becomes a primary feature

3. **User Messages as Signal** (Medium Priority)
   - Kuato's insight: index user messages, not full transcripts
   - Reduces noise from tool outputs and assistant responses
   - More efficient storage and faster search
   - We could apply this to our search/summary features

### UX Patterns

1. **"Where did we leave off"** - Natural language for session recall
2. **Time-bounded search** - `--days 7` is intuitive for recent work
3. **Stats endpoint** - Token usage awareness without full analytics

### Technical Approaches

1. **Bun runtime** - Faster than Node for TypeScript
2. **GIN indexes** - O(log n) lookup for large session histories
3. **Weighted `tsvector`** - Prioritize user content over metadata
4. **Skill/MCP integration** - Make tools discoverable to Claude

## Our Unique Value

**Visual workflow management vs text search**

Kuato is a search/recall tool - you query it when you need to find something. Hilt is a workspace - you see all sessions organized, track status, run terminals, and manage your workflow visually.

Key differences:
- **Discovery**: They search to find; we browse to see everything
- **Interaction**: They return data; we run sessions inline
- **Organization**: They rely on search; we provide kanban/tree structure
- **Workflow**: They help recall; we help manage ongoing work

They answer "what did we discuss?" We answer "what should I work on next?"

## Integration Opportunity

Kuato's search could complement Hilt's visual interface:
- Hilt for visual organization and session management
- Kuato search integrated as a feature (or MCP server)
- "Search all history" button that queries Kuato API
- Combine visual workflow + powerful recall

## Verdict

**Complementary tool - different problem, same data source**

Kuato solves recall/search; Hilt solves organization/workflow. Both read `~/.claude/projects/` but serve different needs. Integration makes sense - their search could power a "find in history" feature in our UI.

**Actionable items:**
1. Consider Claude skill integration pattern for Hilt
2. Evaluate adding Kuato as optional search backend
3. Apply "user messages as signal" insight to our search
4. Track their PostgreSQL FTS approach for future search improvements

---

*Analysis performed: 2026-01-09*
*Sources: [GitHub Repository](https://github.com/alexknowshtml/kuato)*
