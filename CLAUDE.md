# Hilt

File-native context space for Bridge planning, People memory, Briefings, Reference Library review, Docs, and System inspection. See `README.md` for the full feature list.

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

Hilt is a Next.js/Electron app over local markdown and local machine state:
- Bridge reads weekly lists, tasks, and projects from the vault.
- People combines person notes, group notes, and meeting transcripts.
- Briefing renders daily agent-written summaries.
- Library ingests external references, separates saved refs from review candidates, and surfaces source health.
- Docs provides markdown/code/media browsing and editing.
- System owns Sessions/Map, Apps, Stack, and Sync inspection.

## Key Files

| Purpose | Location |
|---------|----------|
| Main shell | `src/components/Board.tsx` |
| Bridge parsing | `src/lib/bridge/` |
| People/meetings | `src/lib/people/`, `src/components/people/` |
| Reference Library | `src/lib/library/`, `src/components/library/`, `scripts/library-*.ts` |
| Docs | `src/components/docs/`, `src/lib/docs/` |
| System inspection | `src/lib/system/`, `src/components/system/`, `src/lib/map/`, `src/lib/local-apps/` |
| WebSocket/events | `server/ws-server.ts`, `server/event-server.ts` |

## Critical Constraints

1. **Provider session files are read-only** - Never write to `~/.codex/projects/`, `~/.claude/projects/`, or other raw transcript stores.
2. **Markdown remains source of truth** - Library references, candidates, Bridge tasks, people notes, and docs must round-trip through files.
3. **Reference Library routing is policy-driven** - explicit-save sources create durable refs; discovery sources create candidates unless promoted.
4. **System inspection is monitor-first** - keep destructive process, sync, and remote-machine actions out of the default UI.

## Reference Library Data Model

```typescript
interface LibraryArtifact {
  id: string;
  state: "saved" | "candidate";
  title: string;
  url: string;
  summary: string;
  media?: { kind: "image" | "video"; url: string }[];
  cached_content?: string;
}
```

## Reference Library Pipeline (versioning + review)

The digest/connection/reweave logic is **one versioned skill**: `src/lib/library/pipeline.ts` + the
prompts it re-exports. See `docs/PIPELINE-VERSIONS.md` for the full registry and protocol.

- **Integers = published at scale** (full library backfill); **decimals = test iterations** reviewed on
  a batch in the **Updated** lane. Blessing a decimal + backfilling promotes it to the next integer.
- **Every pipeline change runs the generation cycle**: edit prompt → bump `PIPELINE_VERSION` (decimal
  for a test) → add a `PIPELINE-VERSIONS.md` entry → write `docs/review-notes/<version>.md` (the brief
  "what to review / why" card shown atop the Updated lane) → cut the batch with
  `scripts/library-reweave.ts --write --review-batch <label>` (it stamps the version and carries the
  note into the review queue).
- Items are stamped `pipeline_version`; the review queue lives in `src/lib/library/review-queue.ts`.

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

Views: `bridge`, `people`, `briefings`, `library`, `docs`, `system`
- `path` is optional — omit to just switch views
- `docs` uses absolute file paths; `people` uses slug paths (e.g. `/art-vandelay`)
- Window auto-focuses in Electron mode

## Development

```bash
npm run app       # Build the dev-mode macOS app (dist/Hilt.app)
npm run dev:all   # Or run in browser: Next.js + WebSocket servers
npm run test:library
npm run test:system
```

**Electron app**: `npm run app` compiles TypeScript and creates `dist/Hilt.app` — a dev-mode launcher with hot reload. This is the daily-driver app. Drag it to the Dock, launch from Spotlight/Raycast, etc. Re-run `npm run app` after changing `electron/main.ts`.

**"Build the Electron app"** = `npm run app` (dev mode). Production builds (`electron:dist:mac`) are only for distribution and are rarely needed.
