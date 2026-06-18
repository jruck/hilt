# Chat v1 — Content-anchored Claude chats in Hilt

Created: 2026-06-10
Implementer: Claude Fable (this plan is written to be executed by an agent — every porting
reference includes a concrete source path; every decision is already made, do not re-open them).

## What this is

A chat feature for Hilt: from a piece of content (Library artifact first; Docs/People later),
open a chat panel that runs a Claude Code CLI session with **read and write access to the
vault**. The chat streams tool-call traces live, persists transcripts under `DATA_DIR`, resumes
across restarts via `--resume`, and every chat — wherever it was started — appears in a new
**System → Chats** subview (a log of Hilt-initiated chats, parallel to System → Sessions but
scoped to chats Hilt spawned).

The design is a port of Loft's chat system (`/Users/jruck/work/engineering/gq/factory/loft`),
which solved most of the hard edge cases already. This plan tells you exactly what to port,
what to skip, and what to adapt to Hilt idioms.

## Current state

- Hilt has **no** chat UI, no streaming endpoints, no CLI spawning for interactive use.
- Hilt **does** have: NDJSON-capable Next API routes (app router), a panel/drawer idiom
  (`src/components/library/LibraryArtifactDetailPane.tsx`), file watchers that broadcast vault
  changes over WS (so agent edits will appear live in the UI for free), and a System view with
  a segmented-mode switcher (`src/components/system/SystemView.tsx:36-112`). Note: `MapView`'s
  `SessionRow` exists but is **explicitly not the design bar** for Chats — the user considers
  it basic/MVP. Loft's `AIEditWorkspace` is the design reference for the Chats subview.
- All UI deps needed are already installed: tailwind 4, `lucide-react`, `react-markdown` +
  `remark-gfm` + `rehype-highlight`, `@tanstack/react-virtual`, `swr`. **Install nothing.**
  (Loft uses `marked` + `prismjs`; use Hilt's react-markdown stack instead.)

## Design decisions (settled — do not re-litigate)

1. **Per-message CLI spawn with `--resume`**, exactly like Loft. No PTY, no persistent child,
   no Agent SDK. Each user message = one `claude -p` run; the CLI's own session store carries
   conversation context.
2. **No approval gates.** This is the big divergence from Loft. Single-user, own data: spawn
   with `--permission-mode bypassPermissions` and `--allowedTools 'Read,Edit,Write,Grep,Glob,LS'`
   (constant `CHAT_ALLOWED_TOOLS` in one place; no Bash in v1). `cwd` = vault root. **No temp
   sandbox, no snapshot/revert, no scope-request planning pass, no rename proposals.** Edits go
   straight to disk; the existing watchers update the UI. Skip Loft's `ScopeRequestCard`,
   `RenameRequestCard`, `ApproveRevertBar`, snapshot/pendingFileUpdates machinery entirely.
3. **Tool-call transparency replaces approval.** Port Loft's trace system fully: live-streaming
   trace events merged by id, `summarizeToolInput`, collapsed trace panel per assistant message,
   plus a "files touched" line with click-to-open-in-Docs.
4. **Server-side persistence** (divergence from Loft, which persists from the client with
   debounce). The streaming route appends the user message, trace events, and assistant message
   to the session file as the run progresses. Client only renders. This kills Loft's
   last-write-wins client race and survives panel closes mid-stream.
5. **One JSON file per chat** under `DATA_DIR/chat-sessions/<chatId>.json` (not Loft's
   one-map-per-workspace file). Atomic temp+rename writes. List = readdir + parse headers.
6. **Central log = System → Chats subview.** Not a new top-level view. Chats started from a
   Library drawer and chats opened from System → Chats are the same `ChatPanel` component and
   the same session files. The subview is a **full port of Loft's `AIEditWorkspace` list
   design** — rich rows, filter tabs, context menus, persisted split pane — re-tokened to
   Hilt's palette, not a minimal list. Do not model it on `MapView`'s `SessionRow`; the chat
   client must not feel neutered relative to Loft.
7. **Model pinned to Sonnet by default** (`--model sonnet`, constant `CHAT_MODEL`) — interactive
   1M-window sessions are what burned the Claude rate-limit budget before (see
   docs/CHANGELOG.md library cost notes). Per-chat override is future work.
8. **Markdown stays source of truth; transcripts are app state.** Chat sessions live in
   `DATA_DIR`, never in the vault. Never write to `~/.claude/projects/` (the CLI manages its own
   session store there; Hilt only passes `--resume` ids). Note: because `cwd` is the vault,
   these CLI sessions will also naturally show up in System → Sessions — that's fine and wanted.

## Loft source map — what to port

All paths under `/Users/jruck/work/engineering/gq/factory/loft`. Line numbers approximate;
read the referenced regions before porting.

| Loft source | What it is | Verdict |
|---|---|---|
| `src/app/api/ai-edit/route.ts` ~164-257 (`runClaude`) | spawn + NDJSON stdout parse + session_id extraction | **Port** → `src/lib/chat/run-claude.ts` |
| `src/app/api/ai-edit/route.ts` ~12-21 (`findClaudeBinary`) | binary discovery (`~/.local/bin/claude`, `/usr/local/bin/claude`, PATH) | **Port** verbatim |
| `src/lib/claudeSettings.ts` (`buildClaudeSpawnEnv`) | overlay `~/.claude/settings.json` env, blank `ANTHROPIC_API_KEY` | **Port** verbatim |
| `src/app/api/ai-edit/route.ts` ~132-159 (`summarizeToolInput`) | per-tool input truncation for traces | **Port** (Bash 220ch, Read/Edit path-only, Grep pattern+path, MultiEdit count, generic first-4-primitive-fields) |
| `src/app/api/ai-edit/route.ts` ~101-130 (`createAIEditStream`) | NDJSON `ReadableStream` HTTP response | **Port** → shape of `POST /api/chat/message` |
| `src/app/api/ai-edit/route.ts` ~590-604 | retry-without-resume (`code !== 0 && !collectedText && sessionId`) | **Port** — emit a warning trace, rerun with `sessionId: null` |
| `src/app/api/repo-chat/route.ts` ~83-110 | `AbortSignal` → child `SIGTERM` | **Port** — wire `request.signal` through |
| `src/lib/repoChatTypes.ts` ~95-116 (`RepoChatTraceEvent`) | trace event shape (id, type, status, label, detail, toolName, input, outputSummary, timestamp, durationMs) | **Port** → `ChatTraceEvent` |
| `src/components/ai-edit/useAIEdit.ts` ~1049-1055 (`mergeRepoTraceEvent`) | merge trace by id (running → complete updates in place) | **Port** |
| `src/components/ai-edit/useAIEdit.ts` ~1072-1102 (`consumeNdjsonStream`) | client line-buffered stream reader with final-buffer flush | **Port** verbatim |
| `src/components/ai-edit/useAIEdit.ts` ~613, ~631 | block concurrent sends when `status==='sending'`; optimistic user message insert | **Port** |
| `src/app/api/repo-chat/route.ts` ~169 (`deterministicTitle`) | title = first 7 words of prompt, max 58 chars | **Port** |
| `src/components/ai-edit/AIEditWorkspace.tsx` ~43-55 (filter tabs), ~92-99 (split persistence), ~101-142 (row metadata), ~160-354 (rows, grouping, context menu, archived group) | the whole session-list workspace: kind filter tabs, rich rows (time-ago, unread 9+, preview, status label+icon, kind badge), attention-first grouping, archived collapsible group paginated at 20, row context menu, resizable split pane persisted to localStorage clamped [0.28, 0.72] | **Port behavior AND design** — this is the reference implementation for `ChatsView`; adapt only color tokens/typography to Hilt's palette |
| `src/components/ai-edit/MessageList.tsx` ~72-128 (`TracePanel`) | collapsed-by-default trace panel: status icons (CheckCircle2/Clock3/AlertTriangle), label+detail, input/output summaries, duration, warning count in header | **Port the design**, render with Hilt components |
| `src/lib/agentSessionStore.ts` (atomic temp+rename write, field normalization on read) | store I/O hygiene | **Port the techniques** into `src/lib/chat/store.ts` |
| `AIEditWorkspace.tsx` ~664 (autoscroll), `AIEditPanel.tsx` ~79-86 (Enter=send) | scroll-to-bottom on message/status change; Enter sends, Shift+Enter newline | **Port** |
| Two-phase plan/approve, `ScopeRequestCard`, `RenameRequestCard`, `ApproveRevertBar`, snapshot/`pendingFileUpdates`/`pendingContentUpdate`, temp sandbox (`getSessionTempDir`), repo-chat widget `parts`, attachments, sync-chat decision heuristics | the approval + sandbox machinery and repo-chat extras | **Skip** for v1 |

## Data model

```typescript
// src/lib/chat/types.ts
export type ChatContextRef =
  | { kind: "library"; id: string }
  | { kind: "doc"; path: string }     // absolute path
  | { kind: "person"; slug: string }
  | { kind: "none" };

export interface ChatTraceEvent {
  id: string;
  type: "step" | "tool_call" | "tool_result" | "warning";
  status: "running" | "complete" | "warning" | "error";
  label: string;
  detail?: string | null;
  toolName?: string | null;
  input?: Record<string, unknown> | null;
  outputSummary?: string | null;
  timestamp: number;
  durationMs?: number | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;          // markdown
  timestamp: number;
  trace?: ChatTraceEvent[]; // on assistant messages
  filesTouched?: string[];  // vault-relative paths extracted from Edit/Write tool calls
}

export interface ChatSession {
  id: string;               // crypto.randomUUID()
  context: ChatContextRef;
  contextLabel: string;     // e.g. artifact title — shown as subtitle
  title: string;            // deterministicTitle(first prompt); renamable later
  claudeSessionId: string | null;
  messages: ChatMessage[];
  status: "idle" | "sending";   // no 'pending' — no approval state in Hilt
  archivedAt: number | null;
  unreadCount: number;
  createdAt: number;
  updatedAt: number;
}
```

Stream protocol (`POST /api/chat/message`, `Content-Type: application/x-ndjson` response):

```typescript
export type ChatStreamEvent =
  | { type: "session"; chatId: string }                       // always first event
  | { type: "trace"; trace: ChatTraceEvent }
  | { type: "message"; content: string }                      // per assistant text block, as parsed
  | { type: "complete"; claudeSessionId: string | null }
  | { type: "error"; error: string };
```

Note on `message`: Loft buffers all text and emits once at run end; we improve slightly by
emitting each assistant text block as the stdout parser sees it (the parse is already
line-by-line — just forward instead of only accumulating). Traces still provide the live
"working…" feedback between text blocks. Client concatenates `message` events into the draft
assistant message.

## Workstream 1 — Chat lib + streaming route (backend)

New files:

- `src/lib/chat/types.ts` — types above.
- `src/lib/chat/run-claude.ts` — ported `runClaude` + `findClaudeBinary` + `buildClaudeSpawnEnv`
  + `summarizeToolInput`. Signature:
  `runClaude({ claudeSessionId, prompt, cwd, signal, onText, onToolUse }) → { collectedText, claudeSessionId, code, stderr }`.
  Spawn args: `-p <prompt> --output-format stream-json --verbose --model sonnet
  --allowedTools <CHAT_ALLOWED_TOOLS> --permission-mode bypassPermissions
  [--resume <claudeSessionId>]`. stdio `['ignore','pipe','pipe']`. Parse stdout line-buffered
  (keep trailing partial line; flush remainder on close). Extract `session_id` from any event
  and from `type:'result'`. SIGTERM on `signal.abort`.
- `src/lib/chat/store.ts` — `DATA_DIR/chat-sessions/`. Resolve `DATA_DIR` the same way the
  library read-state / review-queue code does (grep `src/lib/library/` for the existing helper —
  live server uses `~/.hilt/data`; do not hardcode). API: `createChat(context, contextLabel)`,
  `readChat(id)`, `listChats()` (readdir, parse, sort `updatedAt` desc), `appendMessage(id, msg)`,
  `updateChat(id, patch)`. Atomic temp+rename writes; normalize fields on read (Loft
  `normalizeSession` pattern — coerce bad/missing fields to defaults, never throw on old files).
- `src/lib/chat/context.ts` — `buildFirstTurnPrompt(context: ChatContextRef): Promise<{ prompt: string; contextLabel: string }>`.
  For `library`: load via the existing artifact detail logic (`src/lib/library/library.ts`
  `getArtifactDetail`) and compose: artifact title, url, vault-relative path, summary, and
  `cached_source` content truncated to ~12k chars. Plus standing instructions: *"You are
  chatting inside Hilt, the user's personal knowledge app. cwd is the vault root. You may read
  and edit vault files with your tools. Markdown files are the source of truth — keep edits
  minimal and surgical, preserve frontmatter keys. Be concise."* For `doc`/`person`: stub now
  (path/slug + same standing instructions); wired in Workstream 4.

Route: `src/app/api/chat/message/route.ts` (POST). Body:
`{ chatId?: string; context?: ChatContextRef; prompt: string }`.

Flow:
1. `chatId` absent → `buildFirstTurnPrompt(context)`, `createChat`, emit `{type:'session', chatId}`.
   The CLI prompt for turn 1 = context block + user prompt; the *stored* user message content =
   just the user's prompt (don't pollute the transcript with the context dump).
2. Append user message; set `status:'sending'`, `title` via `deterministicTitle` if first turn.
3. `runClaude` with `cwd` = vault root (resolve the same way library code resolves the vault),
   `signal` = `request.signal`. `onToolUse` → build `ChatTraceEvent`
   (`type:'tool_call'`, `status:'complete'`, label `Used <tool>`, input via `summarizeToolInput`)
   → emit + accumulate. `onText` → emit `{type:'message', content}` + accumulate.
4. Collect `filesTouched` from Edit/Write/MultiEdit tool inputs (file_path, made vault-relative).
5. Retry-without-resume per Loft rule; emit a `warning` trace ("Claude session resume failed —
   started fresh") when it fires.
6. On close: append assistant message `{content: collectedText, trace, filesTouched}`, update
   `claudeSessionId`, `status:'idle'`, `updatedAt`; emit `complete`. Non-zero exit with no text →
   emit `error` with stderr tail (last ~500 chars), still persist what was collected, status
   `'idle'`. Abort → SIGTERM child, persist partial assistant message + traces, no `error` event.

Session routes:
- `GET /api/chat/sessions` → list summaries (id, title, contextLabel, context, status,
  unreadCount, archivedAt, updatedAt, messageCount, last-message snippet ≤120 chars).
- `GET /api/chat/sessions/[id]` → full session.
- `PATCH /api/chat/sessions/[id]` → `{ archivedAt?, unreadCount?, title? }` (archive/unarchive,
  mark read, rename).

Unread semantics (simplified from Loft): the message route bumps `unreadCount` when a turn
completes; `ChatPanel` calls PATCH `{unreadCount: 0}` on open and on turn-complete-while-open.

## Workstream 2 — ChatPanel UI + Library entry point

New: `src/components/chat/` — `ChatPanel.tsx`, `ChatMessageList.tsx`, `ChatTracePanel.tsx`,
`ChatComposer.tsx`, `useChat.ts`.

- `useChat(chatId | {context, contextLabel})`: holds `ChatSession` state; `send(prompt)` does
  optimistic user-message insert, blocks if `status==='sending'`, fetches the stream with an
  `AbortController` (kept in a ref), consumes via ported `consumeNdjsonStream`, merges traces by
  id into the in-progress assistant draft, captures `chatId` from the `session` event,
  refetches the full session on `complete` (server is source of truth). `stop()` aborts.
- `ChatMessageList`: render markdown with `react-markdown` + `remark-gfm` + `rehype-highlight`
  (match how Docs/Briefings render markdown — reuse any existing shared markdown component if
  one exists; grep `react-markdown` usages first). Autoscroll via `bottomRef.scrollIntoView`
  on messages/status change.
- `ChatTracePanel` (per assistant message): collapsed header "N steps · M files touched
  [· K warnings]"; expanded rows with lucide icons (`CheckCircle2` complete, `Clock3` running
  + pulse, `AlertTriangle` warning/error), label, condensed input/output, duration. During
  streaming, render the live trace array above the draft text. `filesTouched` chips below the
  message — click opens the file in Docs via `navigateTo("docs", absolutePath)`.
- `ChatComposer`: textarea, Enter sends / Shift+Enter newline, send icon button; while sending,
  swap to Stop (square icon) wired to `stop()`.
- `ChatPanel`: header (title, contextLabel subtitle, close X), message list, composer.
  **Style per `docs/DESIGN-PHILOSOPHY.md` (read it first — house rule):** dense, zinc-tinted
  surfaces, no pure white/black, user messages blue-tinted (`blue-500/5` + `border-blue-500/20`
  style), assistant on content-surface, emerald pulse for the running state, hover-reveal copy
  action on messages, `transition-colors` only, no modals, no entrance animations.

Library entry point: in `LibraryArtifactDetailPane.tsx`, add a "Chat" action (lucide
`MessageSquare`) alongside the existing actions. It opens `ChatPanel` as a drawer/overlay
adjacent to (or over) the detail pane — follow the pane's own overlay idiom; keep the artifact
visible where layout allows. If a non-archived chat with `context.id === artifact.id` already
exists (check via the list endpoint), open the most recent one instead of creating a new chat;
offer "New chat" inside the panel header.

## Workstream 3 — System → Chats subview

This is a **design-level port of Loft's `AIEditWorkspace`** (the central chat workspace), not a
minimal list. Before building, read `AIEditWorkspace.tsx` end to end. Adapt color tokens,
spacing, and typography to Hilt's palette (zinc surfaces, blue/emerald/amber tints per
DESIGN-PHILOSOPHY) — but keep Loft's information density, row richness, and interaction model.

- Add `"chats"` to `SystemMode` (`src/lib/system/navigation.ts`) and to `BASE_MODES` in
  `SystemView.tsx` (icon `MessageSquare`, title "Hilt-initiated Claude chats"), conditional
  render branch like the others, receiving `modeSwitcher`.
- `src/components/system/ChatsView.tsx`: a **resizable split workspace** (Loft
  `AIEditWorkspace.tsx` ~92-99) — chat list left, open `ChatPanel` right; split ratio persisted
  to localStorage (`hilt-chats-split`), clamped to [0.28, 0.72], consistent with how other Hilt
  views persist pane widths.
- **List header — filter tabs by context kind** (Loft ~43-55): All / Library / Docs / People.
  Kinds with zero chats may hide their tab; "All" is default.
- **Rows** (Loft `SessionRow`, ~160-260) — each row carries the full Loft metadata set:
  - context-kind icon (Library/Docs/People lucide icons) as the kind badge;
  - title (deterministic, renamable) + contextLabel subtitle (e.g. the artifact title);
  - preview line: last-message snippet, or status-specific text while running;
  - status label + icon: **Running** (emerald, pulsing), **Unread** (blue tint + unread badge,
    count capped at "9+"), **Open**, **Archived**;
  - compact time-ago (`Now/5m/2h/1d`);
  - selected-row state per Hilt card conventions (blue border/background tint).
- **Row context menu** (Loft ~229-250): archive/unarchive, mark read, **mark unread**, rename
  title. Closes on Escape and on pointer-down outside. Port Loft's unread-suppression nuance:
  a chat the user manually marked unread stays unread until explicitly read — opening it via
  other code paths must not auto-clear it (Loft's `suppressAutoReadPathRef`, ~line 528).
- **Grouping** (Loft ~555-570): attention-first — chats that are sending, have a pending state,
  or unreadCount > 0 sort to the top; then open chats by `updatedAt` desc; then an **Archived**
  collapsible group, paginated 20 per page (Loft ~298-355).
- Clicking a row opens the chat in the right pane with full history; sending resumes via the
  stored `claudeSessionId`. Data via SWR on `GET /api/chat/sessions`, refetch on focus and
  after any mutation.
- Deep link: support `/system` scopePath of the form `/chats/<id>` the same way Graph handles
  its scope path, so other surfaces can `navigateTo("system", "/chats/<id>")`. Follow the
  existing Graph deep-link pattern in `Board.tsx`/`SystemView.tsx`; if it doesn't generalize
  cleanly, an internal selected-id state + a `navigate` WS event is acceptable for v1.

## Workstream 4 — Polish + additional entry points

- Docs entry point: "Chat" button in the Docs file toolbar → `{kind:'doc', path}` (first-turn
  context: path + file content head ~12k chars).
- People entry point: same pattern with `{kind:'person', slug}` (person note content).
- Optional (only if list staleness annoys): broadcast a `chat` WS channel event on session
  writes so `ChatsView` updates without refetch. Not required for v1 acceptance.

## Edge-case ledger (hard-won in Loft — verify each one survives the port)

- [ ] NDJSON line buffering on **both** hops (CLI stdout parse in `run-claude.ts`; HTTP stream
      in `consumeNdjsonStream`) keeps the trailing partial line and flushes it at end.
- [ ] Unparseable stdout lines are skipped silently (the CLI mixes non-JSON noise on stderr and
      occasionally odd lines on stdout).
- [ ] `session_id` captured from any event carrying it *and* from the `result` event.
- [ ] Retry-without-resume: `code !== 0 && !collectedText && claudeSessionId` → warn-trace +
      fresh run. (Happens when the CLI's session file was pruned/expired.)
- [ ] Abort: client `AbortController` → `request.signal` → child SIGTERM; partial transcript
      persisted; status returns to `idle`; no spurious error toast on user-initiated stop.
- [ ] Concurrent-send guard client-side (`status === 'sending'` → ignore). Server has no lock;
      one in-flight turn per chat is a client invariant.
- [ ] `summarizeToolInput` keeps stored traces small (Bash 220ch, MultiEdit count-only, generic
      first-4-primitive-fields at 220ch) — full tool inputs must never be persisted.
- [ ] Trace merge by `id` so a `running` event upgrades in place to `complete` + `durationMs`.
- [ ] Empty-output success (exit 0, no text): show fallback "Claude returned no text" assistant
      message rather than a blank bubble.
- [ ] stderr accumulated and surfaced (tail) on failure.
- [ ] Atomic temp+rename on every session write; field normalization on read so schema drift
      never crashes the list.
- [ ] Deterministic titles (7 words / 58 chars) so the Chats list is scannable without an LLM
      titling call.
- [ ] Unread only increments when the panel isn't open on that chat; mark-read on open —
      except manually-marked-unread chats, which stay unread until explicitly opened/read
      (Loft's suppression behavior).
- [ ] Chats split ratio persisted and clamped [0.28, 0.72]; row context menu closes on Escape
      and outside pointer-down.
- [ ] `buildClaudeSpawnEnv` overlays `~/.claude/settings.json` env and blanks
      `ANTHROPIC_API_KEY` so the CLI uses the user's configured auth/backend.
- [ ] Binary discovery checks `~/.local/bin/claude`, `/usr/local/bin/claude`, then PATH.
- [ ] No timeout on the spawn — long turns are legitimate; Stop is the escape hatch. Verify the
      Next route doesn't impose one (Loft relied on default behavior; if the dev server kills
      long responses, set the route's `maxDuration`/keep-alive accordingly).

## Sequencing

1. **Phase A:** Workstream 1. Gate: curl test below passes; second message with returned
   `chatId` resumes (CLI remembers turn-1 context); session JSON files well-formed.
2. **Phase B:** Workstream 2. Gate: full chat loop from a Library artifact in the running app,
   including a write ("fix the typo in this reference's summary") visibly landing in the vault
   file and in the artifact pane via watchers; traces render live; Stop works.
3. **Phase C:** Workstream 3. Gate: chat started from Library appears in System → Chats; reopen
   + resume works after an app restart; archive/unread behave.
4. **Phase D:** Workstream 4 as capacity allows.

Commit per phase. **Before each commit:** update `docs/CHANGELOG.md`; add the chat types to
`docs/DATA-MODELS.md`; add routes to `docs/API.md`; note the chat panel patterns in
`docs/DESIGN-PHILOSOPHY.md` Evolution Log; ARCHITECTURE.md gains a Chat section in Phase A.

## Verification checklist

```bash
# Phase A — streaming + resume + persistence
curl -sN -X POST http://localhost:3000/api/chat/message \
  -H 'Content-Type: application/json' \
  -d '{"context":{"kind":"library","id":"<real-artifact-id>"},"prompt":"Summarize this reference in two sentences."}'
# expect: {"type":"session",...} then trace/message events then {"type":"complete",...}
# then resume with the returned chatId and a follow-up that requires turn-1 context:
curl -sN -X POST http://localhost:3000/api/chat/message \
  -H 'Content-Type: application/json' -d '{"chatId":"<id>","prompt":"Now shorten that to one sentence."}'
ls ~/.hilt/data/chat-sessions/   # one JSON per chat; valid JSON; claudeSessionId set
curl -s http://localhost:3000/api/chat/sessions | head

npm run test:library   # unchanged — chat code must not touch library paths
```

Manual (Phases B/C): write-tool turn edits a vault file and the Library pane reflects it live;
Stop mid-turn leaves a partial assistant message and an idle composer; kill/restart the app and
resume the same chat; corrupt a session JSON by hand → list still renders (normalization);
delete the CLI's session (`~/.claude/projects/...`) → next send triggers the
retry-without-resume warning trace and still answers.

## Constraints

- Never write under `~/.claude/projects/` or other provider stores (read-only, house rule).
- Chat transcripts live in `DATA_DIR`, never in the vault.
- No new npm dependencies in v1.
- No auto-anything: chats are only created by explicit user action.
- Keep `CHAT_ALLOWED_TOOLS` and `CHAT_MODEL` as single exported constants in `run-claude.ts`.

## Future work (explicitly out of v1)

Bash tool opt-in per chat; per-turn undo (pre-images captured before Edit/Write); model picker;
WS `chat` channel; attachments and selection-context injection (Loft has both — port later from
`AIEditWorkspace.tsx` drag-drop and `useAIEdit.ts` `selectionContext`); LLM-generated titles;
repo-chat-style structured widget `parts`.
