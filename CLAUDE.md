# Hilt

Kanban UI for managing Claude Code sessions. See `README.md` for full feature list.

## Documentation

**Before making changes**, read:
- `docs/ARCHITECTURE.md` - System design, data flow, component structure, constraints
- `docs/CHANGELOG.md` - Recent changes and technical context
- `docs/DESIGN-PHILOSOPHY.md` - **Read before UI work** to match user's preferences

**As you work** - Update docs incrementally to capture context:
- `docs/CHANGELOG.md` - Add entries as you complete features/fixes (captures reasoning while fresh)
- `docs/DESIGN-PHILOSOPHY.md` - Note UI/UX decisions and patterns as you learn them

**Before every commit** (MANDATORY safety net):
1. **Verify `docs/CHANGELOG.md`** has entries for all changes - if not, add them now
2. If architectural changes were made, update `docs/ARCHITECTURE.md`
3. For new/modified types, update `docs/DATA-MODELS.md`
4. For new/modified API routes, update `docs/API.md`

⚠️ **Do not commit without checking CHANGELOG.md** - incremental updates are preferred, but commit-time is the last chance.

**Ad-hoc documentation requests**: When the user says things like:
- "make a note of this in my design philosophy" → Update `docs/DESIGN-PHILOSOPHY.md`
- "document this in the project" → Choose the appropriate doc based on content:
  - Architecture/system design → `docs/ARCHITECTURE.md`
  - API changes → `docs/API.md`
  - Type definitions → `docs/DATA-MODELS.md`
  - UI/UX preferences, patterns, or decisions → `docs/DESIGN-PHILOSOPHY.md`
  - Component behavior → `docs/COMPONENTS.md`
- "remember this for future sessions" → Usually means `docs/DESIGN-PHILOSOPHY.md` (Evolution Log) or `CLAUDE.md` (constraints)

## Quick Context

Fills gaps that Claude Code CLI doesn't provide:
- Persistent task/status tracking (native TodoWrite is session-scoped only)
- Visual session organization across workflow states
- Draft prompts (Inbox) for queuing work

## Key Files

| Purpose | Location |
|---------|----------|
| Session parsing | `src/lib/claude-sessions.ts` - reads `~/.claude/projects/*.jsonl` |
| Status persistence | `src/lib/db.ts` → `data/session-status.json` |
| Board UI | `src/components/Board.tsx`, `Column.tsx`, `SessionCard.tsx` |
| Terminal | `server/ws-server.ts` (PTY), `src/components/Terminal.tsx` (xterm.js) |
| Tree View | `src/components/TreeView.tsx`, `src/lib/tree-utils.ts` |

## Critical Constraints

1. **Claude JSONL files are read-only** - Never write to `~/.claude/projects/`
2. **Use `terminalId` not `sessionId`** as React key for terminals (prevents reload)
3. **Scope filtering modes differ**: Board uses exact match, Tree uses prefix match
4. **Running detection**: 30-second file mtime threshold

## Session Data Model

```typescript
interface Session {
  id: string;           // UUID from JSONL filename
  slug: string | null;  // Claude's name (e.g., "dynamic-tickling-thunder")
  title: string;        // Summary or first prompt
  messageCount: number;
  gitBranch: string | null;
  status: "inbox" | "active" | "recent";  // Kanban column
  isRunning?: boolean;  // File modified within 30s
  terminalId?: string;  // Stable ID for terminal tracking
}
```

## Custom Commands

- `/track [type] [description]` - Track bugs, tasks, ideas, decisions
- `/plan [description]` - Create feature plans
- `/hilt` - Open Hilt UI

## Hilt Navigation (CLI)

Open files, views, or projects in the running Hilt app:
```bash
PORT=$(cat ~/.hilt-ws-port)
curl -s -X POST "http://localhost:$PORT/navigate" \
  -H "Content-Type: application/json" \
  -d '{"view":"docs","path":"/absolute/path/to/file"}'
```

Views: `bridge`, `docs`, `stack`, `briefings`, `people`
- `path` is optional — omit to just switch views
- `docs`/`stack` use absolute file paths; `people` uses slug paths (e.g. `/amrit`)
- Window auto-focuses in Electron mode

## Development

```bash
npm run dev:all   # Start Next.js + WebSocket servers
```

Open http://localhost:3000 in your browser.
