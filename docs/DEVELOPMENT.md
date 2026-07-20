# Development Guide

## Prerequisites

- **Node.js 20+** - Required for Next.js 16
- **Claude Code CLI** - `claude` command must be available in PATH
- **macOS** - Some features use macOS-specific APIs (osascript, Finder)

## Quick Start

```bash
# Clone the repo
git clone https://github.com/jruck/hilt.git
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
| `dev:all` | `npm run dev:all` | **Start development** (Next.js + WebSocket + Event servers) |
| `dev:demo` | `npm run dev:demo` | Start Next.js against the checked-in demo vault with synthetic System session-map data |
| `demo:seed-map` | `npm run demo:seed-map` | Seed the demo Map SQLite database used by the System Sessions screenshot |
| `app` | `npm run app` | Build the dev-mode macOS app at `dist/Hilt.app` |
| `build` | `npm run build` | Production build |
| `start` | `npm run start` | Start production server |
| `lint` | `npm run lint` | Run ESLint |
| `test:bridge` | `npm run test:bridge` | Bridge parser tests |
| `test:library` | `npm run test:library` | Reference Library ingestion and contract tests |
| `test:system` | `npm run test:system` | System inspector tests |

> **Note**: Always use `dev:all` for development. Running servers individually is only for debugging.

## Architecture

```
┌─────────────────┐  ┌─────────────────┐
│  Next.js Dev    │  │  WebSocket      │
│  Server         │  │  Server         │
│  port 3000      │  │  port 3001      │
└─────────────────┘  └─────────────────┘
        │                    │
        │ HTTP/REST          │ WebSocket
        │                    │ (real-time events)
        ▼                    ▼
┌────────────────────────────────────────┐
│              Browser                    │
│  React App + Real-time Events           │
└────────────────────────────────────────┘
```

All servers are started together with `npm run dev:all`:
- **Next.js** handles the UI and REST API
- **WebSocket** handles real-time file change notifications (scope changes, inbox updates, bridge file changes)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Next.js server port |
| `WS_PORT` | 3001 | WebSocket server port |
| `DATA_DIR` | `./data` | Directory for persistence files |
| `LIBRARY_RECOMMENDATION_TIME_ZONE` | `America/New_York` | IANA timezone used to bound one morning attempt plus one refresh attempt per Library day |

## Directory Structure

```
hilt/
├── src/
│   ├── app/                 # Next.js App Router
│   │   ├── [[...path]]/     # Catch-all route for scopes
│   │   ├── api/             # API routes
│   │   │   ├── bridge/      # Bridge task/project endpoints
│   │   │   ├── docs/        # Documentation viewer API
│   │   │   ├── folders/     # Folder discovery
│   │   │   ├── inbox/       # Inbox drafts
│   │   │   ├── library/     # Reference Library endpoints
│   │   │   ├── local-apps/  # Local/tailnet app monitor
│   │   │   ├── plans/       # Plan management
│   │   │   ├── preferences/ # User preferences
│   │   │   ├── system/      # Sessions, Stack, Sync inspection
│   │   │   └── ...          # Other endpoints
│   │   ├── layout.tsx       # Root layout
│   │   └── globals.css      # Global styles
│   ├── components/          # React components
│   │   ├── bridge/          # Bridge view (notes, tasks, projects)
│   │   ├── briefings/       # Briefing view
│   │   ├── docs/            # Docs viewer (file tree, content pane)
│   │   ├── library/         # Reference Library surface, detail reader, health
│   │   ├── people/          # People and meeting timelines
│   │   ├── system/          # Sessions/Apps/Stack/Sync modes
│   │   ├── ui/              # Shared UI components
│   │   ├── Board.tsx        # Main container, view routing
│   │   ├── DocsView.tsx     # Docs view wrapper
│   │   └── ViewToggle.tsx   # Grouped global tab switcher
│   ├── hooks/               # Custom hooks
│   │   ├── useBridgeProjects.ts
│   │   ├── useBridgeWeekly.ts
│   │   ├── useClaudeStack.ts
│   │   ├── useDocs.ts
│   │   ├── useEventSocket.ts
│   │   ├── usePinnedFolders.ts
│   │   └── useSidebarState.ts
│   └── lib/                 # Utilities and core logic
│       ├── bridge/          # Project parser, vault, weekly parser
│       ├── claude-config/   # Config discovery, MCP, plugins
│       ├── docs/            # Wikilink resolver
│       ├── library/         # Sources, ingestion, candidates, refs
│       ├── system/          # System identity and inspectors
│       ├── db.ts            # Persistence layer
│       ├── types.ts         # TypeScript types and Zod schemas
│       └── ...              # Other utilities
├── server/
│   ├── ws-server.ts         # WebSocket server (real-time events)
│   ├── event-server.ts      # Event pub/sub system
│   └── watchers/            # File system watchers
│       ├── bridge-watcher.ts
│       ├── inbox-watcher.ts
│       └── scope-watcher.ts
├── data/                    # Persistent storage (gitignored)
│   └── preferences.json     # User preferences
├── docs/                    # Documentation
├── electron/                # Electron wrapper (optional)
└── package.json
```

## Key Files to Know

| File | Purpose |
|------|---------|
| `src/components/Board.tsx` | Main container, view routing and state management |
| `src/components/bridge/BridgeView.tsx` | Bridge view: notes, tasks, projects |
| `src/components/library/LibraryView.tsx` | Unified Library feed/list, source filter, lifecycle/ranking, and reader shell |
| `src/components/library/LibraryHealthPanel.tsx` | Scheduler/source/dead-letter health panel |
| `src/components/system/SystemView.tsx` | System inspection modes |
| `src/components/docs/DocsContentPane.tsx` | Docs viewer content rendering |
| `src/lib/types.ts` | TypeScript types and Zod schemas |
| `src/lib/bridge/project-parser.ts` | Parses project markdown frontmatter |
| `src/lib/library/runner.ts` | Shared source ingestion runner |
| `src/lib/library/recommendations.ts` | File-native For You ranker |
| `src/lib/claude-config/discovery.ts` | Claude config file discovery |
| `server/ws-server.ts` | WebSocket server for real-time file change events |
| `server/watchers/` | File system watchers (scope, inbox, bridge) |

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

### API Issues

```bash
# Test folders endpoint
curl "http://localhost:3000/api/folders"

# Test inbox endpoint
curl "http://localhost:3000/api/inbox?scope=/Users/you/project"

# Test Library health
curl "http://localhost:3000/api/library/health"

# Test For You recommendations
curl "http://localhost:3000/api/library/recommendations?limit=8"
```

### WebSocket Event Issues

The WebSocket server broadcasts real-time file change events to connected clients.

**Common issues:**

1. **Events not arriving**
   - Check WebSocket server is running on port 3001
   - Check browser console for WebSocket errors
   - Verify watchers are initialized in `server/watchers/`

2. **Stale data after file changes**
   - Check that the relevant watcher is active (bridge, inbox, scope)
   - Verify `useEventSocket` hook is subscribing to the correct channel

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

Run the smallest targeted suite that covers your change, then `npx tsc --noEmit` before shipping.

```bash
npm run test:bridge
npm run test:library
npm run test:system
npx tsc --noEmit
```

Manual UI checklist:

### Bridge View
- [ ] Notes load for current scope
- [ ] Tasks display with correct status
- [ ] Project cards render with frontmatter
- [ ] Week header shows correct date range
- [ ] Task editor opens and saves

### Docs View
- [ ] File tree renders for current scope
- [ ] Clicking a file loads content in pane
- [ ] Markdown renders correctly
- [ ] Code viewer syntax highlights
- [ ] PDF and CSV viewers work
- [ ] Wikilinks resolve correctly

### Library View
- [ ] Feed loads Recent and For You
- [ ] Sources rail shows Status and Sources filters with counts that match the current search/status slice
- [ ] Feed/List density switching preserves selection and scroll context
- [ ] List density reserves the reader slot on desktop and shows a placeholder when there is no selected item
- [ ] Source/content columns are draggable on desktop and keep the detail reader wider than the list/feed pane
- [ ] Save/Skip/Archive actions work
- [ ] Detail renders markdown, media, and cached source without raw markup
- [ ] Health panel shows scheduler/source/dead-letter state

### System View
- [ ] Sessions, Apps, Stack, and Sync modes render when enabled
- [ ] Stack config files and MCP/plugin details render
- [ ] Health/status errors are visible without blanking the view

### Scope Navigation
- [ ] Breadcrumbs show correct path
- [ ] Click segment navigates
- [ ] URL updates on navigation
- [ ] Browser back/forward works
- [ ] Pinned folders appear in sidebar

## Performance Tips

### Large File Counts

- SWR polling is set to 5 seconds
- `keepPreviousData: true` prevents loading flash
- File watchers debounce rapid changes

### Bundle Size

- Keep optional inspection surfaces lazy where practical.
- Avoid adding heavyweight editors to read-mode paths; Docs uses CodeMirror plus rendered markdown instead of a WYSIWYG markdown bundle.

## Common Patterns

### SWR Data Fetching

```typescript
const { data, error, mutate } = useSWR(
  `/api/bridge?scope=${scope}`,
  fetcher,
  {
    refreshInterval: 5000,
    keepPreviousData: true,
  }
);
```

### Optimistic Updates

```typescript
const handleUpdate = async (id: string, updates: Partial<Task>) => {
  // Optimistic update
  mutate(
    (current) => ({
      ...current,
      tasks: current.tasks.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      ),
    }),
    false // Don't revalidate yet
  );

  // Actual update
  await fetch("/api/bridge/tasks", {
    method: "PATCH",
    body: JSON.stringify({ id, ...updates }),
  });

  // Revalidate
  mutate();
};
```

### Real-time Event Subscription

```typescript
const { lastEvent } = useEventSocket(scope);

useEffect(() => {
  if (lastEvent) {
    // Revalidate data when file changes detected
    mutate();
  }
}, [lastEvent, mutate]);
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

Make sure you're using `npm run dev:all` instead of `npm run dev`. The WebSocket server must be running for real-time event updates.

### TypeScript errors

```bash
# Check types
npx tsc --noEmit
```

---

*Last updated: 2026-02-05*
