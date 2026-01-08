# Development Guide

## Prerequisites

- **Node.js 20+** - Required for Next.js 16
- **Claude Code CLI** - `claude` command must be available in PATH
- **macOS** - Some features use macOS-specific APIs (osascript, Finder)

## Quick Start

```bash
# Clone the repo
git clone https://github.com/yourusername/hilt.git
cd hilt

# Install dependencies
npm install

# Start development servers
npm run dev:all

# Open in browser
open http://localhost:3000
```

## Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev:all` | `npm run dev:all` | Start both Next.js and WebSocket servers |
| `dev` | `npm run dev` | Start Next.js dev server only |
| `ws-server` | `npm run ws-server` | Start WebSocket server only |
| `build` | `npm run build` | Production build |
| `start` | `npm run start` | Start production server |
| `lint` | `npm run lint` | Run ESLint |

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│  Next.js Dev    │     │  WebSocket      │
│  Server         │     │  Server         │
│  port 3000      │     │  port 3001      │
└─────────────────┘     └─────────────────┘
        │                       │
        │ HTTP/REST             │ WebSocket
        │                       │
        ▼                       ▼
┌─────────────────────────────────────────┐
│              Browser                     │
│  React App + xterm.js                    │
└─────────────────────────────────────────┘
```

Both servers must be running for full functionality:
- **Next.js** handles the UI and REST API
- **WebSocket** handles terminal PTY connections

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Next.js server port |
| `WS_PORT` | 3001 | WebSocket server port |
| `DATA_DIR` | `./data` | Directory for persistence files |

## Directory Structure

```
hilt/
├── src/
│   ├── app/                 # Next.js App Router
│   │   ├── [[...path]]/     # Catch-all route for scopes
│   │   ├── api/             # API routes
│   │   ├── layout.tsx       # Root layout
│   │   └── globals.css      # Global styles
│   ├── components/          # React components
│   ├── hooks/               # Custom hooks
│   └── lib/                 # Utilities and core logic
├── server/
│   └── ws-server.ts         # WebSocket + PTY server
├── data/                    # Persistent storage (gitignored)
│   ├── session-status.json  # Kanban states
│   └── inbox.json           # Fallback draft storage
├── docs/                    # Documentation
├── electron/                # Electron wrapper (optional)
└── package.json
```

## Key Files to Know

| File | Purpose |
|------|---------|
| `src/components/Board.tsx` | Main container, all state management |
| `src/lib/claude-sessions.ts` | JSONL parsing, session discovery |
| `src/lib/types.ts` | TypeScript types and Zod schemas |
| `server/ws-server.ts` | Terminal PTY management |
| `src/app/api/sessions/route.ts` | Session API endpoint |

## Development Workflow

### Making Changes

1. **Read docs first**: Check `docs/ARCHITECTURE.md` for context
2. **Make changes**: Edit the relevant files
3. **Test locally**: Verify in browser at localhost:3000
4. **Lint**: Run `npm run lint` to check for errors
5. **Update docs**:
   - Add entry to `docs/CHANGELOG.md` under `[Unreleased]`
   - Update other docs if architecture changed

### Adding a New API Route

1. Create `src/app/api/{route}/route.ts`
2. Export handlers: `GET`, `POST`, `PATCH`, `DELETE`, `PUT`
3. Update `docs/API.md` with endpoint documentation
4. Update `docs/CHANGELOG.md`

### Adding a New Component

1. Create `src/components/{ComponentName}.tsx`
2. Add TypeScript props interface
3. Update `docs/COMPONENTS.md` if significant
4. Update `docs/CHANGELOG.md`

### Modifying Data Models

1. Update types in `src/lib/types.ts`
2. Update Zod schemas if validating external data
3. Update `docs/DATA-MODELS.md`
4. Update `docs/CHANGELOG.md`

## Debugging

### Terminal Issues

The terminal uses xterm.js connected via WebSocket to a PTY process.

**Common issues:**

1. **Terminal won't connect**
   - Check WebSocket server is running on port 3001
   - Check browser console for WebSocket errors
   - Verify `claude` command is in PATH

2. **Terminal reloads unexpectedly**
   - Ensure using `terminalId` (not `sessionId`) as React key
   - Check `Terminal.tsx` useEffect dependencies

3. **PTY spawn fails**
   - Check `server/ws-server.ts` console output
   - Verify project path exists

### Session Discovery Issues

Sessions are read from `~/.claude/projects/`.

**Common issues:**

1. **Sessions not appearing**
   - Check encoded path decoding in `folders/route.ts`
   - Verify JSONL files exist in expected location
   - Check scope filtering mode (exact vs tree)

2. **Running indicator wrong**
   - Check file mtime threshold (30 seconds)
   - Verify `getRunningSessionIds()` in `claude-sessions.ts`

### API Issues

```bash
# Test session endpoint
curl "http://localhost:3000/api/sessions?scope=/Users/you/project"

# Test inbox endpoint
curl "http://localhost:3000/api/inbox?scope=/Users/you/project"

# Test folders endpoint
curl "http://localhost:3000/api/folders"
```

## Code Style

### TypeScript

- Use explicit types for function parameters
- Use interfaces for object shapes (not types)
- Export types from `src/lib/types.ts`

### React

- Functional components with hooks
- Use `useMemo` and `useCallback` for expensive operations
- Use refs for values that shouldn't trigger re-renders

### CSS

- Tailwind CSS 4 utility classes
- Component-specific styles in `globals.css` when needed
- Color palette: zinc (grays), emerald (active), blue (selected)

## Testing

**Currently no automated tests.** Manual testing checklist:

### Board View
- [ ] Sessions load for current scope
- [ ] Drag-drop between columns works
- [ ] Search filters correctly
- [ ] Multi-select works

### Terminal
- [ ] Terminal opens and connects
- [ ] Input is sent correctly
- [ ] Title updates from Claude
- [ ] Multiple tabs work

### Tree View
- [ ] Tree renders correctly
- [ ] Click folder navigates
- [ ] Click session opens terminal
- [ ] Heat scores affect sizing

### Scope Navigation
- [ ] Breadcrumbs show correct path
- [ ] Click segment navigates
- [ ] URL updates on navigation
- [ ] Browser back/forward works

## Performance Tips

### Large Session Counts

- SWR polling is set to 5 seconds
- `keepPreviousData: true` prevents loading flash
- Tree view uses prefix filtering (more sessions)

### Memory

- Terminal instances are created per tab
- Closing tab destroys xterm instance
- WebSocket connections are per-terminal

### Bundle Size

- MDXEditor is large (~500KB)
- Consider lazy loading for plan editor
- xterm.js is ~200KB

## Common Patterns

### SWR Data Fetching

```typescript
const { data, error, mutate } = useSWR(
  `/api/sessions?scope=${scope}`,
  fetcher,
  {
    refreshInterval: 5000,
    keepPreviousData: true,
  }
);
```

### Optimistic Updates

```typescript
const handleStatusChange = async (id: string, status: SessionStatus) => {
  // Optimistic update
  mutate(
    (current) => ({
      ...current,
      sessions: current.sessions.map((s) =>
        s.id === id ? { ...s, status } : s
      ),
    }),
    false // Don't revalidate yet
  );

  // Actual update
  await fetch("/api/sessions", {
    method: "PATCH",
    body: JSON.stringify({ sessionId: id, status }),
  });

  // Revalidate
  mutate();
};
```

### Stable Terminal Keys

```typescript
// WRONG - causes remount when ID changes
<Terminal key={session.id} sessionId={session.id} />

// CORRECT - stable across ID changes
<Terminal key={session.terminalId} sessionId={session.id} />
```

## Electron Development

Optional native app wrapper in `electron/`.

```bash
# Build Electron app
npm run electron:build

# Development mode (if script exists)
npm run electron:dev
```

## Troubleshooting

### "Module not found" errors

```bash
rm -rf node_modules
npm install
```

### Port already in use

```bash
# Find process on port 3000
lsof -i :3000

# Kill it
kill -9 <PID>
```

### WebSocket connection refused

Check that the WebSocket server is running:

```bash
# In separate terminal
npm run ws-server
```

### TypeScript errors

```bash
# Check types
npx tsc --noEmit
```

---

*Last updated: 2025-01-06*
