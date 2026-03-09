---
name: hilt
description: Control the Hilt app programmatically — navigate views, manage weekly tasks, run week reviews, read briefings, and more. Use when the user wants to interact with Hilt from a conversation, show something visually, manage their weekly workflow, or automate any Hilt feature.
---

# Hilt Skill

Control the running Hilt app from any Claude session. Hilt is a personal workspace UI (Next.js PWA) backed by a Bridge vault of markdown files.

## Connection

Hilt exposes two interfaces:

1. **WS server** — for navigation and real-time control
2. **HTTP API** — for data operations (tasks, briefings, etc.)

```bash
# WS server port (navigation, events)
WS_PORT=$(cat ~/.hilt-ws-port)

# HTTP API (Next.js)
API="http://localhost:3000"
```

If `~/.hilt-ws-port` doesn't exist, Hilt isn't running. The HTTP API runs on port 3000 by default.

## Vault location

The Bridge vault path is configured via `BRIDGE_VAULT_PATH` in Hilt's `.env`. Key subdirectories:
- `lists/now/` — weekly task lists (`YYYY-MM-DD.md`)
- `briefings/` — daily briefings (`YYYY-MM-DD.md`)
- `meetings/` — organized by date (`YYYY-MM-DD/`)
- `people/` — one `.md` file per person
- `projects/` — project folders with `index.md`
- `thoughts/` — writing/thought folders

---

## Navigation

POST to the WS server's `/navigate` endpoint to switch views and focus on specific content.

```bash
PORT=$(cat ~/.hilt-ws-port)
curl -s -X POST "http://localhost:$PORT/navigate" \
  -H "Content-Type: application/json" \
  -d '{"view":"VIEW","path":"PATH"}'
```

### Views and path formats

| View | Path format | Example |
|------|------------|---------|
| `bridge` | No path needed | (omit) |
| `briefings` | No path needed | (omit) |
| `docs` | Absolute file path | `/Users/.../meetings/2026-03-04/meeting.md` |
| `people` | Slug path: `/<name>` | `/art-vandelay` |
| `stack` | Absolute directory path | `/Users/.../project` |

### Discovery workflow

When the user asks to "show" or "open" something:

- **People**: `ls ~/work/bridge/people/` → match by filename slug → `{"view":"people","path":"/<slug>"}`
- **Meetings**: `ls -t ~/work/bridge/meetings/` → find by date/name → `{"view":"docs","path":"<abs path>"}`
- **Projects**: `ls ~/work/bridge/projects/` → `{"view":"docs","path":"<abs path to index.md>"}`
- **Files**: any vault file → `{"view":"docs","path":"<abs path>"}`
- **Views**: "show me my tasks" → `{"view":"bridge"}`, "show briefings" → `{"view":"briefings"}`

---

## Weekly Tasks

### Read the current week

```bash
curl -s "$API/api/bridge/weekly" | jq
```

Returns: `{ filename, week, needsRecycle, tasks[], accomplishments, notes, availableWeeks, latestWeek }`

Each task has: `{ id, title, done, details[], group, projectPath, projectPaths[], dueDate, rawLines[] }`

- `group` — the `### Subheading` this task lives under (e.g., "Personal", "Product"), or `null` if ungrouped
- Tasks are ordered as they appear in the file

### Read a specific past week

```bash
curl -s "$API/api/bridge/weekly?week=2026-03-02" | jq
```

### Toggle a task's done state

```bash
curl -s -X PUT "$API/api/bridge/weekly" \
  -H "Content-Type: application/json" \
  -d '{"taskId":"task-3","updates":{"done":true}}'
```

### Update a task's title or details

```bash
curl -s -X PUT "$API/api/bridge/weekly" \
  -H "Content-Type: application/json" \
  -d '{"taskId":"task-3","updates":{"title":"New title","details":["Detail line 1","Detail line 2"]}}'
```

### Add a new task

```bash
curl -s -X POST "$API/api/bridge/weekly" \
  -H "Content-Type: application/json" \
  -d '{"title":"New task","projectPath":"projects/some-project"}'
```

### Delete a task

```bash
curl -s -X DELETE "$API/api/bridge/weekly" \
  -H "Content-Type: application/json" \
  -d '{"taskId":"task-5"}'
```

### Reorder tasks

```bash
curl -s -X PATCH "$API/api/bridge/weekly" \
  -H "Content-Type: application/json" \
  -d '{"order":["task-2","task-0","task-1","task-3"]}'
```

---

## Week Review (Recycle)

End-of-week retrospective: carry tasks forward, log accomplishments, start a new week.

### When to offer

`needsRecycle: true` in the weekly API response means the CTA is active (Friday 3 PM+ or past week).

### Conversational flow

1. **Fetch current tasks**: `GET /api/bridge/weekly`
2. **Present tasks grouped by `### heading`** — show group labels, task titles, done/not-done
3. **Ask what to carry forward** — which incomplete tasks move to next week?
4. **Ask what was accomplished** — free text for the accomplishments section
5. **Ask about notes** — carry forward, edit, or drop?
6. **Execute the recycle**:

```bash
curl -s -X POST "$API/api/bridge/recycle" \
  -H "Content-Type: application/json" \
  -d '{
    "carry": ["task-1", "task-3", "task-7"],
    "newWeek": "2026-03-16",
    "notes": "Optional notes to carry forward",
    "accomplishments": "Shipped feature X, resolved bug Y"
  }'
```

- `carry` — array of task IDs to bring forward (unchecked in new file)
- `newWeek` — the Monday date for the new week (`YYYY-MM-DD`)
- `accomplishments` — saved to the *outgoing* (current) week file
- `notes` — carried into the new week's `## Notes` section

### Computing newWeek

Always use the next Monday:

```bash
# Next Monday from today
date -v+1w -v-Mon -v0H -v0M -v0S +%Y-%m-%d
```

Or in JS: find next day where `getDay() === 1`.

### Group preservation

Carried tasks retain their `### group` headings in the new file. If 3 "Personal" tasks and 2 "Product" tasks are carried, the new file gets both headings with their tasks underneath.

---

## Briefings

### List available briefings

```bash
curl -s "$API/api/bridge/briefings" | jq
```

### Read a specific briefing

```bash
curl -s "$API/api/bridge/briefings/2026-03-09" | jq
```

---

## Error handling

- `~/.hilt-ws-port` missing → Hilt isn't running
- HTTP API on wrong port → check if Hilt dev server is up (`lsof -i :3000`)
- `curl` failures → WS server may need restart
