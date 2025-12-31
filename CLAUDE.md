# Claude Kanban

See @README.md for full documentation, architecture diagram, and project structure.

## Quick Context

Kanban UI for managing Claude Code sessions. Fills gaps that Claude Code CLI doesn't provide:
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

## Session Data Model

```typescript
interface Session {
  id: string;           // UUID from JSONL filename
  slug: string | null;  // Claude's name (e.g., "dynamic-tickling-thunder")
  title: string;        // Summary or first prompt
  messageCount: number;
  gitBranch: string | null;
  status: "inbox" | "active" | "inactive" | "done";  // Our kanban state
}
```

## Custom Commands

- `/track [type] [description]` - Track bugs, tasks, ideas, decisions
- `/plan [description]` - Create feature plans in `nimbalyst-local/plans/`
- `/kanban` - Open the Kanban UI

## Development

```bash
npm run dev:all   # Start Next.js + WebSocket servers
```

Open http://localhost:3000 in your browser.
