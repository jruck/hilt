# Phase 5: MCP Server

> **Goal**: Expose Claude Kanban as a Model Context Protocol (MCP) server, allowing Claude Code sessions to query the task board, create tasks, update results, and enable autonomous task chaining.

> **Status**: Planning — Questions pending

## Problem Statement

Currently, Claude Code sessions are blind to the kanban board:
- Claude can't see what tasks are queued
- Claude can't report results back to the board
- Claude can't pick up the next task automatically
- Context from the task (files, URLs, notes) must be manually provided

With MCP integration:
- Claude can query "what tasks are waiting?"
- Claude can update task status and results
- Claude can chain tasks: complete one, start the next
- Task context is automatically available

## What We Discussed

From RESEARCH.md, we defined:

### Resources
```
kanban://tasks           — All tasks
kanban://tasks/inbox     — Queued tasks
kanban://tasks/active    — Running tasks
kanban://tasks/{id}      — Specific task details
kanban://tasks/{id}/results — Task outcomes
```

### Tools
```
kanban_create_task      — Create new task
kanban_update_task      — Update status/results
kanban_get_next_task    — Get next prioritized task
```

### Key Use Case: Autonomous Task Processing

```
User: "Work through my task queue"

Claude: *calls kanban_get_next_task()*
→ Returns: { id: "abc", title: "Fix login bug", context: { files: ["src/auth.ts"] } }

Claude: *reads src/auth.ts, fixes bug, commits*
Claude: *calls kanban_update_task({ taskId: "abc", status: "done", results: { ... } })*

Claude: *calls kanban_get_next_task()*
→ Returns: { id: "def", title: "Add rate limiting", ... }

Claude: *continues to next task...*
```

## Proposed Scope

### MCP Server Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Kanban App                         │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                  MCP Server                          │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │    │
│  │  │  Resources  │  │    Tools    │  │   Prompts   │  │    │
│  │  │             │  │             │  │  (future)   │  │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  │    │
│  └─────────────────────────────────────────────────────┘    │
│                            │                                 │
│                            ▼                                 │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Task & Results Storage                  │    │
│  │              (Phase 1 & 2 data)                      │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                            │
                    MCP Protocol
                    (stdio or HTTP)
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Claude Code Session                       │
│                                                              │
│  "What tasks do I have?"  ──────▶  kanban://tasks/inbox     │
│  "Mark this done"         ──────▶  kanban_update_task()     │
│  "What's next?"           ──────▶  kanban_get_next_task()   │
└─────────────────────────────────────────────────────────────┘
```

### MCP Resources

```typescript
// Resources expose read-only data

const resources = [
  {
    uri: "kanban://tasks",
    name: "All Tasks",
    description: "List all tasks across all statuses",
    mimeType: "application/json",
  },
  {
    uri: "kanban://tasks/inbox",
    name: "Inbox Tasks",
    description: "Tasks waiting to be started",
    mimeType: "application/json",
  },
  {
    uri: "kanban://tasks/active",
    name: "Active Tasks",
    description: "Tasks currently in progress",
    mimeType: "application/json",
  },
  {
    uri: "kanban://tasks/review",
    name: "Review Tasks",
    description: "Completed tasks awaiting review",
    mimeType: "application/json",
  },
  {
    uri: "kanban://tasks/{id}",
    name: "Task Details",
    description: "Full details for a specific task including context",
    mimeType: "application/json",
  },
  {
    uri: "kanban://tasks/{id}/runs",
    name: "Task Runs",
    description: "All runs/sessions for a task",
    mimeType: "application/json",
  },
  {
    uri: "kanban://tasks/{id}/results",
    name: "Task Results",
    description: "Results and artifacts from task runs",
    mimeType: "application/json",
  },
  {
    uri: "kanban://projects",
    name: "Projects",
    description: "List all projects with task counts",
    mimeType: "application/json",
  },
];
```

### MCP Tools

```typescript
// Tools allow Claude to take actions

const tools = [
  {
    name: "kanban_create_task",
    description: "Create a new task in the inbox",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Task title",
        },
        description: {
          type: "string",
          description: "Detailed task description",
        },
        projectPath: {
          type: "string",
          description: "Project path for this task",
        },
        context: {
          type: "object",
          properties: {
            files: { type: "array", items: { type: "string" } },
            urls: { type: "array", items: { type: "string" } },
            notes: { type: "string" },
          },
        },
        priority: {
          type: "number",
          description: "Priority (lower = higher priority)",
        },
      },
      required: ["title", "projectPath"],
    },
  },
  {
    name: "kanban_update_task",
    description: "Update a task's status, results, or metadata",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task ID to update",
        },
        status: {
          type: "string",
          enum: ["inbox", "active", "review", "done"],
          description: "New task status",
        },
        results: {
          type: "object",
          properties: {
            summary: { type: "string" },
            filesChanged: { type: "array", items: { type: "string" } },
            commits: { type: "array", items: { type: "string" } },
            artifacts: { type: "array" },
            errors: { type: "array", items: { type: "string" } },
          },
        },
        addContext: {
          type: "object",
          description: "Additional context to append",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "kanban_get_next_task",
    description: "Get the next highest-priority task from inbox",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: {
          type: "string",
          description: "Filter by project path",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Filter by tags",
        },
      },
    },
  },
  {
    name: "kanban_add_run",
    description: "Record a new run/session for a task",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        sessionId: { type: "string" },
        status: { type: "string", enum: ["running", "completed", "failed"] },
      },
      required: ["taskId"],
    },
  },
  {
    name: "kanban_search_tasks",
    description: "Search tasks by title, description, or tags",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        status: { type: "array", items: { type: "string" } },
        projectPath: { type: "string" },
      },
      required: ["query"],
    },
  },
];
```

### MCP Server Implementation

```typescript
// src/mcp/server.ts

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

class KanbanMCPServer {
  private server: Server;
  private taskDb: TaskDatabase;

  constructor(taskDb: TaskDatabase) {
    this.taskDb = taskDb;
    this.server = new Server(
      { name: "claude-kanban", version: "1.0.0" },
      { capabilities: { resources: {}, tools: {} } }
    );

    this.registerResources();
    this.registerTools();
  }

  private registerResources() {
    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: resources,
    }));

    // Read resource content
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;

      if (uri === "kanban://tasks/inbox") {
        const tasks = await this.taskDb.getTasksByStatus("inbox");
        return {
          contents: [{
            uri,
            mimeType: "application/json",
            text: JSON.stringify(tasks, null, 2),
          }],
        };
      }

      // Handle other resources...
    });
  }

  private registerTools() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: tools,
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case "kanban_create_task":
          return this.handleCreateTask(args);
        case "kanban_update_task":
          return this.handleUpdateTask(args);
        case "kanban_get_next_task":
          return this.handleGetNextTask(args);
        // etc.
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
```

### Claude Code Configuration

To use the MCP server, add to Claude Code settings:

```json
{
  "mcpServers": {
    "kanban": {
      "command": "node",
      "args": ["/path/to/claude-kanban/dist/mcp-server.js"],
      "env": {
        "KANBAN_DATA_DIR": "/path/to/claude-kanban/data"
      }
    }
  }
}
```

Or for the running app (HTTP transport):

```json
{
  "mcpServers": {
    "kanban": {
      "url": "http://localhost:3000/api/mcp",
      "transport": "http"
    }
  }
}
```

### Context Injection

When Claude starts working on a task, the task's context should be available:

```typescript
// When Claude calls kanban_get_next_task or reads kanban://tasks/{id}

{
  "id": "task-123",
  "title": "Fix authentication timeout",
  "description": "Users report session expires after 5 minutes instead of 30",
  "context": {
    "files": [
      "src/auth/session.ts",
      "src/config/auth.ts"
    ],
    "urls": [
      "https://github.com/org/repo/issues/456"
    ],
    "notes": "Check SESSION_TIMEOUT constant. May also need to update refresh logic."
  },
  "status": "inbox",
  "projectPath": "/Users/dev/myproject"
}
```

Claude can then:
1. Read the specified files
2. Fetch the linked URL for context
3. Follow the notes as guidance

## Implementation Steps (Draft)

1. **MCP SDK setup** — Add @modelcontextprotocol/sdk dependency
2. **Resource handlers** — Implement resource read logic
3. **Tool handlers** — Implement tool execution logic
4. **Server entry point** — Standalone MCP server script
5. **HTTP transport option** — MCP over HTTP for running app
6. **Auto-discovery** — Help Claude Code find the server
7. **Documentation** — How to configure Claude Code
8. **Context injection patterns** — Best practices for task context

## Test Plan (Draft)

### Unit Tests

| Test | Description |
|------|-------------|
| `list resources returns all` | Resource listing works |
| `read tasks/inbox returns inbox` | Inbox filter works |
| `read tasks/{id} returns task` | Single task retrieval |
| `create_task adds to inbox` | Task creation |
| `update_task changes status` | Status update |
| `get_next_task respects priority` | Priority ordering |
| `search_tasks finds matches` | Search functionality |

### Integration Tests

| Test | Description |
|------|-------------|
| `MCP server starts` | Server initialization |
| `stdio transport works` | Command-line usage |
| `HTTP transport works` | API-based usage |
| `tool results persist` | Database updated |

### Manual Testing

- [ ] Configure MCP server in Claude Code
- [ ] Ask Claude "what tasks do I have?"
- [ ] Claude reads kanban://tasks/inbox
- [ ] Ask Claude to create a task
- [ ] Verify task appears in kanban UI
- [ ] Ask Claude to mark task done
- [ ] Verify status updated in UI

### End-to-End: Autonomous Task Processing

- [ ] Create 3 tasks in UI
- [ ] Tell Claude "work through my task queue"
- [ ] Claude gets first task
- [ ] Claude completes work
- [ ] Claude updates task status
- [ ] Claude gets next task
- [ ] Repeat until queue empty
- [ ] Verify all tasks marked done

### Browser Testing (Claude via Chrome)

- [ ] While Claude works, view kanban in browser
- [ ] See task status change in real-time
- [ ] See results populated after completion
- [ ] Verify UI reflects Claude's updates

---

## Open Questions

### Server Architecture

**Q1: Stdio vs HTTP transport?**
- Option A: Stdio only (simpler, standard MCP approach)
- Option B: HTTP only (works with running app)
- Option C: Both (maximum flexibility)

**Q2: Standalone server or integrated?**
- Option A: Separate process (`node mcp-server.js`)
- Option B: Part of Next.js app (`/api/mcp` route)
- Option C: Both options available

### Discovery

**Q3: How does Claude Code find our MCP server?**
Options:
- Manual configuration in Claude Code settings
- Auto-configure via project's `.claude/settings.json`
- Global installation that's always available

**Q4: Per-project or global?**
Should the MCP server be:
- Option A: Global (one server, accesses all tasks)
- Option B: Per-project (server knows current project context)
- Option C: Global but project-aware (filter by cwd)

### Data Access

**Q5: Authentication?**
If MCP server exposes task data, should there be auth?
- Option A: No auth (localhost only)
- Option B: Simple token auth
- Option C: Full auth flow (overkill for local?)

**Q6: Read vs write permissions**
Should Claude have full write access or restricted?
- Option A: Full access (create, update, delete tasks)
- Option B: Read + limited write (update status/results, can't delete)
- Option C: Configurable per-tool

### Context Injection

**Q7: How much context to include?**
When returning task details:
- Option A: Just metadata (Claude reads files separately)
- Option B: Include file contents inline (convenient but large)
- Option C: Include file snippets (relevant portions)

**Q8: URL fetching**
If task has context URLs:
- Option A: Just return URLs (Claude fetches)
- Option B: Pre-fetch and cache content
- Option C: Include summary/excerpt

### Task Chaining

**Q9: Automatic vs explicit chaining?**
After completing a task:
- Option A: Claude must explicitly call get_next_task
- Option B: Auto-suggest next task in response
- Option C: Configurable auto-chaining mode

**Q10: Cross-project tasks?**
If Claude is in project A, should it see/work on project B tasks?
- Option A: Yes, if explicitly requested
- Option B: No, strict project isolation
- Option C: Configurable behavior

### Results Reporting

**Q11: What should Claude report?**
When Claude completes a task, what results format?
- Option A: Free-form summary
- Option B: Structured format (files, commits, etc.)
- Option C: Auto-detect from git (Phase 2) + Claude adds notes

**Q12: Conflict with Phase 2?**
Phase 2 captures results via git diff. MCP allows Claude to self-report. How do these interact?
- Option A: MCP results override git detection
- Option B: Git detection is authoritative, MCP adds metadata
- Option C: Merge both sources

---

## Dependencies

- **Phase 1** — Need Task data model
- **Phase 2** — Results structure for reporting
- Can be built in parallel with Phase 3/4

---

## Future: MCP Prompts

MCP also supports prompts (reusable prompt templates). Future additions:

```typescript
const prompts = [
  {
    name: "process_inbox",
    description: "Work through all queued tasks",
    arguments: [
      { name: "maxTasks", description: "Maximum tasks to process", required: false }
    ],
  },
  {
    name: "task_summary",
    description: "Summarize current task status",
    arguments: [],
  },
];
```

This is lower priority than resources/tools but worth considering.

---

*Created: January 8, 2026*
*Status: Awaiting answers to open questions*
