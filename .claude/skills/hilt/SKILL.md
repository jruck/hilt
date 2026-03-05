---
name: hilt
description: Navigate to files, meetings, people, projects, or views in the Hilt app. Use when the user wants to show, open, pull up, or navigate to something in Hilt — or when context implies they want to see something visually (e.g., "show me my meeting with X", "open the project", "pull up Amrit").
---

# Hilt Navigation

Open files, people, meetings, projects, or views in the running Hilt app from any Claude session.

## How it works

Hilt's WS server exposes a `/navigate` POST endpoint. Read the port from `~/.hilt-ws-port` and POST a JSON payload with `view` and optional `path`.

```bash
PORT=$(cat ~/.hilt-ws-port)
curl -s -X POST "http://localhost:$PORT/navigate" \
  -H "Content-Type: application/json" \
  -d '{"view":"VIEW","path":"PATH"}'
```

## Views and path formats

| View | Path format | Example |
|------|------------|---------|
| `docs` | Absolute file path | `/Users/jruck/work/bridge/meetings/2026-03-04/meeting.md` |
| `stack` | Absolute directory path | `/Users/jruck/work/project` |
| `people` | Slug path: `/<name>` | `/amrit` |
| `bridge` | No path needed | (omit) |
| `briefings` | No path needed | (omit) |

## Discovery workflow

When the user asks to "show" or "open" something, figure out what they mean:

### People
- "show me Amrit", "pull up Sarah's page" → `{"view":"people","path":"/<slug>"}`
- Find the slug: `ls ~/work/bridge/people/` and match by name (filename without `.md`)

### Meetings
- "open my last meeting", "show the meeting with X" → `{"view":"docs","path":"<absolute path>"}`
- Find meetings: `ls -t ~/work/bridge/meetings/` for recent dates, then list files in the date folder
- Match by participant name, date, or meeting title in the filename

### Projects
- "open project X" → `{"view":"docs","path":"<absolute path>"}`
- Find projects: `ls ~/work/bridge/projects/`

### Files / Docs
- "show me this file in Hilt" → `{"view":"docs","path":"<absolute path to file>"}`
- Can be any file the user references — use the absolute path

### Views (no specific target)
- "open Hilt to bridge", "show me my tasks" → `{"view":"bridge"}`
- "show briefings" → `{"view":"briefings"}`

## Vault location

The bridge vault is at `~/work/bridge/`. Key subdirectories:
- `meetings/` — organized by date (`YYYY-MM-DD/`)
- `people/` — one `.md` file per person
- `projects/` — project files
- `thoughts/` — thought logs
- `lists/now/` — weekly task lists
- `briefings/` — daily briefings

## Error handling

- If `~/.hilt-ws-port` doesn't exist, Hilt isn't running. Tell the user to start it.
- If curl fails or returns non-200, the WS server may need restarting.
