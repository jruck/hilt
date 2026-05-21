# Hilt Map View + Convex Work Graph Implementation Plan

Created: 2026-05-19

> Status: superseded by the local-first Map implementation. This document is retained as historical planning context for the earlier Convex-backed work graph direction; Convex is now an optional future replication layer rather than the active implementation path.

## Executive Summary

Build a new `Map` view inside Hilt that becomes the realtime air-traffic-control surface for personal agentic work. The view is backed by Convex Cloud, with Convex as the canonical operational database for the work graph, session attachments, checkpoints, machines, and attention state.

This is not a revival of the old folder/session Tree View as-is. The old Tree View was useful as a visualization pattern, but its data model was folder-centric and session-centric. The new version must be work-centric:

- Work nodes own sessions.
- Sessions attach to work nodes.
- Provider artifacts do not define the work model.
- Markdown and git remain durable knowledge/artifact layers, not the realtime source of truth.

The first production target is a single mothership machine running Hilt, Convex-connected UI, and a local collector that observes Codex and Claude session stores. Other devices connect as thin clients through Hilt/Convex and do not need their own complete local view of every session store.

## Locked Decisions

These decisions should not be reopened during v0 implementation unless the plan becomes impossible.

1. Convex Cloud is the canonical realtime store for the map/task database.
2. Hilt remains the product surface and access boundary; it does not become the agent executor.
3. The mothership collector discovers sessions across local harnesses and writes normalized metadata into Convex.
4. Session ingestion is metadata-only in v0. Do not ingest raw transcripts into Convex.
5. Unattached sessions go to a suggestion inbox. Do not auto-create work nodes for every observed session.
6. The work graph is recursively nested work nodes. Do not hard-code depth-specific concepts like phase, epic, or milestone.
7. Bridge markdown is seed/context/reference data. It is not the realtime operational source of truth after import.
8. v0 is single-user and single-mothership-first.

## Goals

### Product Goals

- Show all meaningful AI work in one map, regardless of whether the work is happening in Codex, Claude, a subagent, or a future harness.
- Make it cheap to answer: "Where did I leave off?"
- Make it cheap to answer: "What needs me?"
- Let a project/task collect multiple sessions, including peer sessions and orchestrator/worker session trees.
- Preserve the ability to drill from a work node into the underlying harness session when the user wants to continue the conversation.
- Avoid adding a new workflow tax. The collector should observe as much as possible, and the UI should turn uncertain matches into suggestions rather than requiring perfect manual bookkeeping.

### Engineering Goals

- Add Convex without destabilizing the existing Bridge, Docs, Briefings, People, and Stack views.
- Keep all write paths explicit, typed, and auditable.
- Keep provider-specific parsing behind adapter boundaries.
- Store enough metadata for realtime navigation and status without storing private transcript content.
- Make ingestion idempotent, restart-safe, and resilient to partial provider data.

## Non-Goals

- Do not build a new executor/harness in this phase.
- Do not replace Codex, Claude, Hermes, or future harnesses.
- Do not implement multi-user permissions beyond a simple single-user token boundary.
- Do not sync multiple independent local machines as equal peers in v0.
- Do not implement full transcript search.
- Do not make Bridge weekly markdown bidirectionally sync with Convex in v0.
- Do not require every session to be attached before it appears in the UI.

## Current Hilt Context

Hilt currently has a Next.js + React app with a catch-all route that maps URL prefixes to views. Existing primary views are `briefings`, `bridge`, `docs`, `people`, and `stack`. Hilt already has:

- Bridge parsers for weekly tasks and project folders.
- Docs view for markdown/file navigation.
- Local preferences and source configuration in JSON files.
- WebSocket/event server infrastructure for local filesystem-driven updates.
- An old Tree View plan under `docs/plans/tree-view-implementation-plan.md`.

No current Convex integration exists. This plan adds one.

## Conceptual Model

### Work Nodes

A work node is the durable unit of work in the map. A work node may feel like a project, subproject, task, investigation, client workstream, or personal initiative. The hierarchy is recursive and arbitrary:

```text
Personal Orchestrator
  Map view in Hilt
    Convex schema
    Session collector
    Treemap UI
  Mothership setup
    Remote control
    Thin clients
```

The implementation should allow display hints like `kind: "project" | "task"`, but must not enforce that only projects can have children or only tasks can be leaves.

### Sessions

A session is a provider-shaped execution/conversation artifact:

- Codex desktop thread
- Codex CLI rollout/thread
- Claude Code session
- Claude desktop/Claude Code local session record
- Claude subagent sidechain
- Future Hermes/acpx session
- Future raw API or custom harness run

The database should normalize these into provider-neutral session documents. The original provider id remains important, but it is not the identity of the work.

### Session Links

A session link attaches a session to a work node. This should be modeled as its own table rather than a single `attachedNodeId` field on the session. That gives v0 a simple primary-link workflow while preserving the ability to support one session spanning multiple nodes later.

### Session Relations

Parent/child session relations represent orchestrator/worker structures:

- Codex `thread_spawn_edges` maps parent thread to child thread.
- Claude subagent paths map a parent session to child subagent sessions.
- Future harnesses may provide richer task graphs.

These relations are independent from work-node hierarchy.

### Checkpoints

A checkpoint is an intentional saved state for a work node:

- What is happening?
- What changed?
- What is blocked?
- What should I do next?
- Which sessions are relevant?

Checkpoints are the main feature that solves the user's context-resume pain. Collector metadata helps locate work, but checkpoints preserve the human-level "where I left off" state.

## Architecture

```text
┌────────────────────────────────────────────────────────────────────┐
│ Thin clients                                                       │
│ - Hilt browser/Electron/PWA                                        │
│ - Laptop/phone over Tailscale or normal web access                 │
└───────────────────────────────┬────────────────────────────────────┘
                                │
                                │ Convex realtime reads
                                │ Hilt API writes
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│ Hilt app                                                           │
│ - Map view                                                         │
│ - API routes for guarded mutations                                 │
│ - Bridge import/seed action                                        │
│ - Local navigation/deep links                                      │
└───────────────────────────────┬────────────────────────────────────┘
                                │
                                │ Server-side Convex client
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│ Convex Cloud                                                       │
│ - workNodes                                                        │
│ - sessions                                                         │
│ - sessionLinks                                                     │
│ - sessionRelations                                                 │
│ - linkSuggestions                                                  │
│ - checkpoints                                                      │
│ - machines                                                         │
│ - collectorState                                                   │
└───────────────────────────────▲────────────────────────────────────┘
                                │
                                │ Batched metadata upserts
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│ Mothership collector                                               │
│ - Codex adapter                                                    │
│ - Claude adapter                                                   │
│ - Heuristic linker                                                 │
│ - Machine heartbeat                                                │
└───────────────────────────────┬────────────────────────────────────┘
                                │
                                │ Read-only local observation
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│ Local provider stores                                              │
│ - ~/.codex/state_5.sqlite                                          │
│ - ~/.codex/session_index.jsonl                                     │
│ - ~/.codex/sessions/**/*.jsonl                                     │
│ - ~/.claude/projects/**/*.jsonl                                    │
│ - ~/Library/Application Support/Claude/claude-code-sessions/**/*.json │
└────────────────────────────────────────────────────────────────────┘
```

## Dependencies

Add these dependencies when implementation begins:

```json
{
  "dependencies": {
    "convex": "latest",
    "better-sqlite3": "latest"
  },
  "devDependencies": {
    "@types/better-sqlite3": "latest"
  }
}
```

Rationale:

- `convex` provides the React client, generated API types, server-side clients, schema validators, and function runtime.
- `better-sqlite3` is used only in the mothership collector to read Codex metadata from `~/.codex/state_5.sqlite`. Do not import it in browser-facing code.

If Electron packaging later makes native sqlite dependencies painful, isolate the collector into a separate Node process that is not bundled into the renderer.

## Environment Variables

Use these environment variables:

```bash
NEXT_PUBLIC_CONVEX_URL="https://<deployment>.convex.cloud"
HILT_MAP_READ_TOKEN="<single-user-read-token>"
HILT_MAP_WRITE_TOKEN="<single-user-write-token>"
HILT_MAP_MACHINE_ID="<stable-machine-id>"
HILT_MAP_MACHINE_LABEL="Mac Studio"
HILT_MAP_COLLECTOR_ENABLED="true"
HILT_MAP_COLLECTOR_INTERVAL_MS="10000"
```

Convex should also have matching environment variables:

```bash
HILT_MAP_READ_TOKEN="<same-read-token>"
HILT_MAP_WRITE_TOKEN="<same-write-token>"
```

The browser may receive `HILT_MAP_READ_TOKEN` through a local Hilt config endpoint so it can subscribe to Convex realtime queries. The browser must not receive `HILT_MAP_WRITE_TOKEN`.

## Convex Schema

Create a `convex/` directory at repo root.

### `convex/schema.ts`

Use explicit schema validation from the start because the map data becomes the operational source of truth.

Tables:

#### `workNodes`

Fields:

- `title: string`
- `kind: "project" | "task"`
- `parentId?: Id<"workNodes">`
- `status: "active" | "paused" | "blocked" | "review" | "done" | "archived"`
- `priority: "low" | "normal" | "high"`
- `sortKey: string`
- `description?: string`
- `bridgeRefs?: BridgeRef[]`
- `repoRefs?: RepoRef[]`
- `createdAt: number`
- `updatedAt: number`
- `lastActivityAt?: number`
- `archivedAt?: number`

Indexes:

- `by_parent` on `parentId, sortKey`
- `by_status` on `status, updatedAt`
- `by_updated` on `updatedAt`
- `by_last_activity` on `lastActivityAt`

Notes:

- `parentId` may be absent for roots.
- `kind` is a display/intent hint only. Do not constrain hierarchy based on it.
- `bridgeRefs` preserve links back to markdown source material.

#### `sessions`

Fields:

- `provider: "codex" | "claude" | "hermes" | "other"`
- `harness: string`
- `externalId: string`
- `externalKey: string`
- `machineId: Id<"machines">`
- `title?: string`
- `cwd?: string`
- `repoPath?: string`
- `repoRemote?: string`
- `gitBranch?: string`
- `gitSha?: string`
- `modelProvider?: string`
- `model?: string`
- `role: "orchestrator" | "worker" | "peer" | "reference" | "unknown"`
- `observedState: "active" | "idle" | "archived" | "unknown"`
- `attentionState: "none" | "needs_review" | "blocked" | "waiting_for_user"`
- `sourcePath?: string`
- `deepLink?: string`
- `createdAt?: number`
- `lastSeenAt: number`
- `lastActivityAt?: number`
- `metadata?: Record<string, unknown>`

Indexes:

- `by_external_key` on `externalKey`
- `by_machine` on `machineId, lastSeenAt`
- `by_provider` on `provider, lastSeenAt`
- `by_activity` on `lastActivityAt`
- `by_attention` on `attentionState, lastActivityAt`
- `by_repo` on `repoRemote, gitBranch`

Notes:

- `externalKey` is `${provider}:${harness}:${externalId}`.
- Store provider ids and local pointers, not transcript content.
- `title` may come from provider metadata, but do not store full first prompts as a substitute for title unless the provider already exposes it as a title field.

#### `sessionLinks`

Fields:

- `sessionId: Id<"sessions">`
- `workNodeId: Id<"workNodes">`
- `role: "primary" | "supporting" | "reference"`
- `source: "human" | "collector" | "agent"`
- `confidence?: number`
- `createdAt: number`
- `updatedAt: number`

Indexes:

- `by_node` on `workNodeId, updatedAt`
- `by_session` on `sessionId, updatedAt`
- `by_session_node` on `sessionId, workNodeId`

Notes:

- v0 UI should encourage one primary link per session, but the schema allows many-to-many.
- The collector should create suggestions, not direct links, unless an explicit rule is added later.

#### `sessionRelations`

Fields:

- `parentSessionId: Id<"sessions">`
- `childSessionId: Id<"sessions">`
- `relation: "spawned" | "subagent" | "sidechain" | "manual"`
- `source: "codex" | "claude" | "human" | "collector"`
- `createdAt: number`
- `updatedAt: number`

Indexes:

- `by_parent` on `parentSessionId`
- `by_child` on `childSessionId`
- `by_pair` on `parentSessionId, childSessionId`

#### `linkSuggestions`

Fields:

- `sessionId: Id<"sessions">`
- `workNodeId?: Id<"workNodes">`
- `suggestedTitle?: string`
- `suggestionType: "attach_existing" | "create_child" | "create_root"`
- `score: number`
- `reasons: string[]`
- `state: "open" | "accepted" | "dismissed" | "superseded"`
- `createdAt: number`
- `updatedAt: number`

Indexes:

- `by_state` on `state, score`
- `by_session` on `sessionId, state`
- `by_node` on `workNodeId, state`

Notes:

- Use this for the unlinked session inbox.
- `suggestedTitle` supports "create child/root" suggestions without making a real work node.

#### `checkpoints`

Fields:

- `workNodeId: Id<"workNodes">`
- `author: "human" | "agent" | "collector"`
- `body: string`
- `nextAction?: string`
- `blockers?: string`
- `sessionIds: Id<"sessions">[]`
- `createdAt: number`
- `updatedAt: number`

Indexes:

- `by_node` on `workNodeId, createdAt`
- `by_created` on `createdAt`

Notes:

- Checkpoints are intentional notes and may contain substantive content.
- They are allowed even though raw transcripts are not stored.

#### `machines`

Fields:

- `machineKey: string`
- `label: string`
- `role: "mothership" | "client" | "unknown"`
- `hostname?: string`
- `platform?: string`
- `lastSeenAt: number`
- `createdAt: number`
- `updatedAt: number`

Indexes:

- `by_machine_key` on `machineKey`
- `by_last_seen` on `lastSeenAt`

#### `collectorState`

Fields:

- `machineId: Id<"machines">`
- `provider: "codex" | "claude" | "hermes" | "other"`
- `sourceKey: string`
- `watermark?: string`
- `lastScanStartedAt?: number`
- `lastScanFinishedAt?: number`
- `lastError?: string`
- `updatedAt: number`

Indexes:

- `by_machine_provider_source` on `machineId, provider, sourceKey`

## Convex Functions

Organize Convex functions by capability:

```text
convex/
  schema.ts
  auth.ts
  map.ts
  workNodes.ts
  sessions.ts
  collector.ts
  checkpoints.ts
  seed.ts
```

### Auth Helpers

`convex/auth.ts`:

- `requireReadToken(args)`
- `requireWriteToken(args)`
- `now()`

For v0, token args are acceptable because this is a single-user personal control plane. Each public query accepts `readToken`. Each mutation intended for Hilt API/collector accepts `writeToken`.

### Queries

Implement:

- `map.needsMe({ readToken })`
- `map.active({ readToken })`
- `map.recent({ readToken, since })`
- `map.graph({ readToken })`
- `workNodes.detail({ readToken, workNodeId })`
- `sessions.detail({ readToken, sessionId })`
- `sessions.unlinked({ readToken })`
- `sessions.forNode({ readToken, workNodeId })`
- `checkpoints.forNode({ readToken, workNodeId })`
- `collector.machineStatus({ readToken })`

Realtime reads should use Convex React `useQuery` in client components.

### Mutations

Implement:

- `workNodes.create({ writeToken, input })`
- `workNodes.update({ writeToken, workNodeId, patch })`
- `workNodes.move({ writeToken, workNodeId, parentId, sortKey })`
- `workNodes.archive({ writeToken, workNodeId })`
- `sessions.attach({ writeToken, sessionId, workNodeId, role })`
- `sessions.detach({ writeToken, sessionId, workNodeId })`
- `sessions.setAttentionState({ writeToken, sessionId, attentionState })`
- `sessions.acceptSuggestion({ writeToken, suggestionId })`
- `sessions.dismissSuggestion({ writeToken, suggestionId })`
- `checkpoints.create({ writeToken, input })`
- `collector.upsertMachine({ writeToken, input })`
- `collector.upsertObservedSessions({ writeToken, sessions, relations })`
- `collector.upsertSuggestions({ writeToken, suggestions })`
- `collector.recordScanResult({ writeToken, input })`
- `seed.importBridgeSnapshot({ writeToken, input })`

### Mutation Rules

- Mutations must be idempotent where collectors call them repeatedly.
- Collector mutations must batch upserts and avoid creating duplicate `sessions`, `sessionRelations`, or `linkSuggestions`.
- Human actions must mark related suggestions as `accepted`, `dismissed`, or `superseded`.
- Moving a work node must not rewrite session links.
- Archiving a work node should leave session links intact but hide the node from default views.

## Hilt Integration

### Routing

Update:

- `src/lib/url-utils.ts`
- `src/components/ViewToggle.tsx`
- `src/components/NavBar.tsx`
- `src/components/Board.tsx`

Add `map` to the known view prefixes and view mode union.

Recommended nav order:

1. Briefing
2. Bridge
3. Map
4. Docs
5. People

Add `Cmd+3` for Map and shift Docs/People shortcuts accordingly. If shortcut churn feels too disruptive, keep existing shortcuts and make Map `Cmd+5`. Prefer minimizing disruption if users already rely on existing shortcuts.

### New Components

Create:

```text
src/components/map/
  MapView.tsx
  MapToolbar.tsx
  NeedsMePanel.tsx
  WorkGraphTreemap.tsx
  WorkGraphTree.tsx
  WorkNodeDetail.tsx
  SessionList.tsx
  SessionCard.tsx
  SessionRelationTree.tsx
  LinkSuggestionInbox.tsx
  CheckpointComposer.tsx
  CheckpointTimeline.tsx
  MachineStatus.tsx
```

### New Hooks

Create:

```text
src/hooks/map/
  useMapClientConfig.ts
  useNeedsMe.ts
  useWorkGraph.ts
  useWorkNodeDetail.ts
  useSessionDetail.ts
  useLinkSuggestions.ts
  useMapMutations.ts
```

Use Convex hooks for live queries. Keep Hilt API fetches for guarded writes if using API routes as the write boundary.

### Convex Provider

Add a client provider:

```text
src/components/map/ConvexMapProvider.tsx
```

This provider should:

- Fetch `/api/map/client-config` for `convexUrl` and `readToken`.
- Create a `ConvexReactClient`.
- Wrap Map UI with `ConvexProvider`.

Do not wrap the entire app in Convex until the map is stable. Keep the dependency scoped to Map to reduce blast radius.

### Hilt API Routes

Create:

```text
src/app/api/map/client-config/route.ts
src/app/api/map/work-nodes/route.ts
src/app/api/map/sessions/attach/route.ts
src/app/api/map/sessions/detach/route.ts
src/app/api/map/suggestions/accept/route.ts
src/app/api/map/suggestions/dismiss/route.ts
src/app/api/map/checkpoints/route.ts
src/app/api/map/seed/bridge/route.ts
```

Routes should:

- Validate request bodies with Zod.
- Use server-side Convex calls.
- Inject `HILT_MAP_WRITE_TOKEN`.
- Return typed JSON responses.
- Never expose `HILT_MAP_WRITE_TOKEN`.

## Map UI Behavior

### Default View: Needs Me

The first screen should answer "what needs my attention?"

Include:

- Blocked sessions.
- Review sessions.
- Waiting-for-user sessions.
- Idle active work nodes with recent activity but no checkpoint.
- Unlinked session suggestions.
- Work nodes with open blockers.

Rows should show:

- Work node title.
- Status.
- Last activity.
- Attached session count.
- Provider badges.
- Most recent checkpoint or missing-checkpoint indicator.

### Graph View

The graph view should offer both:

- Treemap visualization for spatial overview.
- Tree/list fallback for precise navigation.

The treemap should be built from `workNodes`, not folders. Size should be based on a computed attention/activity score:

```text
score =
  6 * blocked_or_waiting_count +
  5 * review_count +
  4 * active_session_count +
  3 * open_suggestion_count +
  2 * recent_checkpoint_count +
  recency_decay(lastActivityAt)
```

Roll up scores from descendants so parent projects visually represent child activity.

Use the old Tree View only as a source of layout ideas:

- Reuse or adapt the squarified treemap utility if it is still useful.
- Do not reuse the old session/folder data model.
- Keep render levels based on rectangle size so small nodes stay readable.

### Work Node Detail

Selecting a work node opens a detail panel with:

- Title, status, priority, parent path.
- Child work nodes.
- Attached sessions grouped by role.
- Session relation tree for orchestrator/worker structures.
- Checkpoint timeline.
- "Save checkpoint" composer.
- Link suggestions relevant to the node.
- Bridge references and repo references.

### Session Detail

Selecting a session shows:

- Provider/harness.
- Title.
- Model/provider.
- CWD/repo/branch.
- Last seen/activity time.
- Machine.
- Parent/child sessions.
- Work-node links.
- Local source path.
- Deep link or "open in provider" action when available.

Do not show raw transcript text in v0.

### Suggestion Inbox

Unattached sessions appear here.

Each suggestion should support:

- Attach to suggested existing node.
- Attach to a searched node.
- Create new child node under a selected parent.
- Create new root node.
- Dismiss.

The UI should show the reasons behind a suggestion:

- Same repo.
- Same branch.
- CWD under known project path.
- Title match.
- Recent activity near a work node.

## Mothership Collector

### Location

Create:

```text
server/map-collector/
  index.ts
  config.ts
  types.ts
  convex-client.ts
  adapters/
    codex.ts
    claude.ts
  linker.ts
  machine.ts
  scheduler.ts
```

Add scripts:

```json
{
  "scripts": {
    "map-collector": "tsx server/map-collector/index.ts",
    "dev:map": "concurrently \"npm run dev\" \"npm run map-collector\""
  }
}
```

Optionally add `map-collector` to `dev:all` after it is stable.

### Collector Loop

Every scan:

1. Upsert machine heartbeat.
2. Run each enabled adapter.
3. Normalize observed sessions.
4. Upsert sessions into Convex.
5. Upsert session relations.
6. Fetch current work-node/repo index from Convex.
7. Generate or update link suggestions for unlinked sessions.
8. Record collector state and errors.

Default interval: 10 seconds.

Use `HILT_MAP_COLLECTOR_INTERVAL_MS` to override.

### Idempotency

Adapters must generate stable external keys:

```text
codex:desktop:<thread_id>
codex:cli:<thread_id>
claude:code:<session_id>
claude:desktop:<session_id>
claude:subagent:<parent_session_id>:<agent_id>
```

The Convex mutation must:

- Query by `externalKey`.
- Patch existing session if found.
- Insert if absent.
- Preserve human-set `attentionState` unless explicitly changed by a human/API route.
- Preserve manual session links.
- Upsert relations by parent/child pair.

### Codex Adapter

Read sources:

- `~/.codex/state_5.sqlite`
- `~/.codex/session_index.jsonl`
- `~/.codex/sessions/**/*.jsonl`

Primary source:

- `state_5.sqlite`, table `threads`.

Fields to map:

- `id` -> `externalId`
- `rollout_path` -> `sourcePath`
- `created_at_ms` -> `createdAt`
- `updated_at_ms` -> `lastSeenAt` and `lastActivityAt`
- `source` -> `harness` hint
- `model_provider` -> `modelProvider`
- `cwd` -> `cwd`
- `title` -> `title`
- `git_branch` -> `gitBranch`
- `git_origin_url` -> `repoRemote`
- `git_sha` -> `gitSha`
- `model` -> `model`
- `agent_role` -> possible role hint
- `agent_path` -> metadata

Read `thread_spawn_edges` to create `sessionRelations`.

Role rules:

- If a Codex thread appears as a parent in `thread_spawn_edges`, set role to `orchestrator`.
- If it appears as a child, set role to `worker`.
- Otherwise use `peer`.

State rules:

- If `archived = 1`, `observedState = "archived"`.
- If `updated_at_ms` is within 15 minutes, `observedState = "active"`.
- Otherwise `observedState = "idle"`.

Do not store `first_user_message` in Convex for v0.

### Claude Adapter

Read sources:

- `~/.claude/projects/**/*.jsonl`
- `~/Library/Application Support/Claude/claude-code-sessions/**/*.json`

For `~/.claude/projects/**/*.jsonl`:

- Group by `sessionId`.
- Ignore `skill-injections.jsonl`.
- Use metadata fields from user/assistant rows:
  - `sessionId`
  - `cwd`
  - `gitBranch`
  - `version`
  - `timestamp`
  - `isSidechain`
  - `uuid`
  - `parentUuid`
- Do not store `message.content`.
- For title, use `custom-title` or `ai-title` event types when present. Otherwise leave title blank or derive a non-content title from folder/repo.

For `claude-code-sessions/**/*.json`:

- `sessionId` -> `externalId`
- `cliSessionId` -> metadata
- `cwd` and `originCwd` -> cwd metadata
- `createdAt` -> `createdAt`
- `lastActivityAt` -> `lastActivityAt`
- `model` -> `model`
- `title` -> `title`
- `permissionMode` -> metadata
- `isArchived` -> archived state

Subagent rules:

- Files under `subagents/` become child sessions.
- Parent is the containing session directory.
- Relation type is `subagent`.
- Parent role is `orchestrator`; child role is `worker`.

State rules:

- If archived, `observedState = "archived"`.
- If last activity is within 15 minutes, `observedState = "active"`.
- Otherwise `observedState = "idle"`.

## Linker Heuristics

The collector should not auto-attach sessions in v0. It should create suggestions.

Inputs:

- Session cwd.
- Session repo remote.
- Session branch.
- Session title.
- Work-node repoRefs.
- Work-node bridgeRefs.
- Work-node title/path.
- Recent accepted links.

Scoring:

```text
+50 exact repo remote match
+25 cwd under a Bridge project folder
+20 branch name contains work-node slug
+15 title contains work-node title tokens
+15 recent accepted link from same repo/branch to same node
+10 parent session already linked to node
-20 session is archived and older than 30 days
```

Suggestion thresholds:

- Score >= 60: create `attach_existing` suggestion.
- Score 30-59: create lower-confidence `attach_existing` suggestion.
- No candidate but meaningful cwd/repo/title: create `create_root` suggestion.
- Parent session linked and child session unlinked: create `create_child` suggestion under parent node.

Suggestion records must be updated in place when possible and marked `superseded` if the session is manually linked elsewhere.

## Bridge Seeding

Add a one-time import action that seeds Convex from the current Bridge vault.

Source parsers:

- Existing project parser for project folders.
- Existing weekly parser for current weekly tasks.

Import behavior:

1. Create root work nodes for Bridge projects.
2. Preserve Bridge project metadata in `bridgeRefs`.
3. Create task-like child nodes for current undone weekly tasks.
4. If a weekly task links to one or more projects, parent it under the first linked project and store all project paths in `bridgeRefs`.
5. If a weekly task has no project link, parent it under a root `Inbox` work node.
6. Do not import completed weekly tasks by default.
7. Do not continuously sync Bridge to Convex after the seed.

Add a Map UI action:

- "Import Bridge snapshot"

This should be guarded because it creates canonical Convex records.

## Data Flow Examples

### New Codex Session Appears

1. Codex writes/updates local sqlite thread metadata.
2. Collector reads the thread row.
3. Collector upserts a `sessions` record in Convex.
4. Linker compares cwd/repo/branch/title against work nodes.
5. Linker creates one or more `linkSuggestions`.
6. Map `Needs Me` updates live through Convex.
7. User accepts a suggestion.
8. Hilt API calls Convex mutation to create `sessionLinks`.

### Orchestrator Spawns Workers

1. Codex records rows in `thread_spawn_edges`, or Claude creates `subagents/` JSONL files.
2. Collector upserts all sessions.
3. Collector upserts `sessionRelations`.
4. Parent session role becomes `orchestrator`.
5. Child session roles become `worker`.
6. Work node detail shows a session relation tree.

### User Stops Work and Saves State

1. User opens a work node.
2. User writes a checkpoint:
   - current state
   - next action
   - blockers
   - relevant sessions
3. Hilt API writes a `checkpoints` record.
4. Work node `lastActivityAt` and `updatedAt` update.
5. Later, `Needs Me` and node detail surface the checkpoint as the resume point.

## Security and Privacy

### v0 Token Boundary

This is not full auth. It is a single-user personal app boundary:

- Browser receives read token only.
- Hilt server and collector hold write token.
- Convex validates tokens on every query/mutation.
- No raw transcript content enters Convex.

### Sensitive Fields

Allowed in Convex:

- Session ids.
- Provider names.
- Model names.
- CWD.
- Repo remote.
- Branch.
- Timestamps.
- Provider title fields.
- Local source path.
- Human-written checkpoints.

Not allowed in Convex v0:

- Raw user prompts.
- Raw assistant messages.
- Tool outputs.
- File diffs.
- Full transcript JSONL rows.

### Local Paths

Local paths are acceptable for v0 because this is a personal single-user control plane, but the UI should treat them as operational metadata, not shareable public links.

## Testing Plan

### Unit Tests

Add tests for:

- Codex adapter row normalization.
- Codex `thread_spawn_edges` relation mapping.
- Claude JSONL metadata extraction without message content.
- Claude `claude-code-sessions` JSON extraction.
- Subagent parent/child relation mapping.
- Linker scoring.
- Suggestion threshold behavior.
- Work graph rollup score calculation.
- Bridge seed transformation.

Recommended fixture layout:

```text
server/map-collector/__fixtures__/
  codex/
    state_5.sqlite
    session_index.jsonl
    rollout.jsonl
  claude/
    project-session.jsonl
    subagents/
      agent-a.jsonl
    claude-code-session.json
```

Tests must assert that transcript/message content is not present in normalized records.

### Convex Function Tests

Test:

- Token rejection for missing/invalid read/write tokens.
- Idempotent session upsert.
- Manual `attentionState` preservation during collector upsert.
- Relation upsert de-duplication.
- Suggestion accept/dismiss transitions.
- Work node move/archive behavior.
- Checkpoint creation.

### UI Tests

Add Playwright coverage for:

- `/map` route renders.
- `Needs Me` shows open link suggestions.
- Accepting a suggestion attaches a session to a node.
- Work node detail shows attached sessions.
- Orchestrator session shows worker children.
- Checkpoint creation appears without page refresh.
- Treemap renders non-empty rectangles at desktop and mobile widths.

### Manual Verification

Run:

```bash
npm run lint
npm run build
npm run map-collector
npm run dev
```

Manual checks:

- Start Hilt.
- Open `/map`.
- Confirm machine heartbeat appears.
- Confirm recent Codex sessions appear without transcripts.
- Confirm recent Claude sessions appear without transcripts.
- Accept a link suggestion.
- Save a checkpoint.
- Refresh from another browser/device and confirm realtime data remains.

## Implementation Phases

### Phase 0: Convex Project Setup

Deliverables:

- Add `convex` dependency.
- Initialize `convex/`.
- Add schema.
- Add token helpers.
- Add minimal `machines` heartbeat mutation and query.
- Add `/api/map/client-config`.

Acceptance criteria:

- `npx convex dev` runs.
- Hilt can render a placeholder Map view connected to Convex.
- Invalid tokens are rejected.

### Phase 1: Work Graph Core

Deliverables:

- `workNodes` schema and functions.
- Map route/view shell.
- Tree/list display of work nodes.
- Create/update/move/archive actions through Hilt API.
- Bridge snapshot import.

Acceptance criteria:

- Bridge projects can be imported into Convex.
- Work nodes can be browsed under `/map`.
- Moving and archiving nodes updates realtime UI.

### Phase 2: Session Collector Foundation

Deliverables:

- `server/map-collector` process.
- Machine heartbeat.
- Codex adapter.
- Claude adapter.
- `sessions` and `sessionRelations` upsert functions.
- Metadata-only assertions in tests.

Acceptance criteria:

- Running `npm run map-collector` populates Convex with local Codex and Claude session metadata.
- Parent/child session relations appear for Codex spawned threads and Claude subagents.
- No raw transcript content is stored.

### Phase 3: Session Linking and Suggestions

Deliverables:

- `sessionLinks` and `linkSuggestions`.
- Linker heuristics.
- Suggestion inbox UI.
- Accept/dismiss/attach/detach actions.

Acceptance criteria:

- Unattached sessions appear in the suggestion inbox.
- Suggestions include reasons and confidence.
- Accepting a suggestion links the session and removes/supersedes the suggestion.
- Work node detail shows attached sessions.

### Phase 4: Checkpoints and Needs Me

Deliverables:

- `checkpoints` schema/functions.
- Checkpoint composer and timeline.
- Needs Me query and UI.
- Attention state controls.

Acceptance criteria:

- User can save a checkpoint against a work node.
- Needs Me shows blocked/review/waiting sessions, open suggestions, and work missing resume state.
- Checkpoints become the primary resume surface for a node.

### Phase 5: Treemap Visualization

Deliverables:

- Work graph rollup metrics.
- Treemap layout utility adapted from old Tree View ideas.
- Graph view toggle between treemap and tree/list.
- Responsive rendering and detail levels.

Acceptance criteria:

- Treemap is based on work nodes, not folders.
- Parent nodes roll up descendant activity/attention.
- Desktop and mobile layouts are readable.
- Selecting a rectangle opens the work node detail panel.

### Phase 6: Polish and Operational Hardening

Deliverables:

- Collector error reporting in Machine Status.
- Backoff and scan-state visibility.
- Empty/loading/error states.
- Basic docs in `docs/ARCHITECTURE.md` and `docs/DATA-MODELS.md`.
- Optional `dev:map` workflow documented in `docs/DEVELOPMENT.md`.

Acceptance criteria:

- Collector failures are visible but do not break the Map UI.
- Existing Hilt views continue to work.
- A future agent can understand the Map architecture from docs without reading this plan first.

## File-Level Change Plan

Expected additions:

```text
convex/schema.ts
convex/auth.ts
convex/map.ts
convex/workNodes.ts
convex/sessions.ts
convex/collector.ts
convex/checkpoints.ts
convex/seed.ts

server/map-collector/index.ts
server/map-collector/config.ts
server/map-collector/types.ts
server/map-collector/convex-client.ts
server/map-collector/adapters/codex.ts
server/map-collector/adapters/claude.ts
server/map-collector/linker.ts
server/map-collector/machine.ts
server/map-collector/scheduler.ts

src/components/map/*
src/hooks/map/*
src/app/api/map/*
src/lib/map/*
```

Expected edits:

```text
package.json
src/lib/url-utils.ts
src/components/ViewToggle.tsx
src/components/NavBar.tsx
src/components/Board.tsx
src/app/layout.tsx
docs/ARCHITECTURE.md
docs/DATA-MODELS.md
docs/DEVELOPMENT.md
```

Avoid editing unrelated Bridge/Docs/People behavior except where shared navigation requires it.

## Acceptance Criteria for v0

v0 is complete when:

1. `/map` exists as a first-class Hilt view.
2. Convex is the canonical work graph store.
3. Bridge can seed initial work nodes into Convex.
4. The mothership collector ingests Codex and Claude metadata.
5. Sessions from both providers appear in one normalized UI.
6. Orchestrator/worker relationships appear when provider metadata exposes them.
7. Unlinked sessions appear as suggestions, not auto-created tasks.
8. Sessions can be manually attached to work nodes.
9. A work node can have multiple attached sessions.
10. A session can be linked to more than one work node at the schema level.
11. Checkpoints can be created and used as the resume surface.
12. Needs Me provides a useful default triage surface.
13. No raw transcript content is stored in Convex.
14. Existing Hilt views still work.

## Risks and Mitigations

### Risk: Convex token approach is too weak for broader access

Mitigation:

- Accept for v0 single-user.
- Keep token checks centralized.
- Replace with real auth later without changing core tables.

### Risk: Provider local stores change shape

Mitigation:

- Keep adapters isolated.
- Store adapter version in collector metadata.
- Fail softly per adapter and show errors in Machine Status.

### Risk: Suggestions become noisy

Mitigation:

- Start conservative.
- Require explicit user acceptance.
- Let dismissed suggestions suppress similar future suggestions.

### Risk: The treemap hides too much detail

Mitigation:

- Ship tree/list view alongside treemap.
- Make Needs Me the default, not the treemap.

### Risk: Convex and Bridge drift conceptually

Mitigation:

- Treat Bridge as knowledge/reference after seed.
- Store Bridge refs on work nodes.
- Do not attempt bidirectional sync until the Convex model proves itself.

### Risk: Metadata-only ingestion is not enough for resume

Mitigation:

- Make checkpoints first-class.
- Add optional summaries later only after the storage/privacy line is intentionally revisited.

## Future Work

Not part of v0, but the schema should not block:

- Real auth.
- Multiple motherships.
- Local laptop collector as a secondary source.
- Agent-writeable MCP tools for creating checkpoints and attaching sessions.
- Chat interface over the work graph.
- Optional transcript summarization with explicit opt-in.
- Hermes/acpx adapters.
- Push notifications for Needs Me.
- Work graph query/export to Bridge markdown.

## References

- Personal Orchestrator project: `/Users/jruck/work/bridge/projects/personal-orchestrator/index.md`
- Personal Orchestrator architecture: `/Users/jruck/work/bridge/projects/personal-orchestrator/architecture.md`
- Old Tree View plan: `docs/plans/tree-view-implementation-plan.md`
- Old Tree View summary: `docs/plans/tree-view-summary.md`
- Convex realtime docs: https://docs.convex.dev/realtime
- Convex React/Next.js docs: https://docs.convex.dev/client/react/nextjs
- Convex schema docs: https://docs.convex.dev/database/schemas
- Convex index docs: https://docs.convex.dev/database/reading-data/indexes/
- Convex cron docs: https://docs.convex.dev/scheduling/cron-jobs
- Convex HTTP actions docs: https://docs.convex.dev/functions/http-actions
