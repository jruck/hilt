# Hilt: Claude Code Integration Analysis

*Analysis Date: January 2026*

This document analyzes Hilt's current functionality, Claude Code's architecture and features, and identifies opportunities to better surface Claude Code capabilities through the UI.

---

## Table of Contents

1. [Current Hilt Functionality](#1-current-hilt-functionality)
2. [Claude Code Architecture & Features](#2-claude-code-architecture--features)
3. [Session Management Deep Dive](#3-session-management-deep-dive)
4. [Gap Analysis: Untapped Data & Features](#4-gap-analysis-untapped-data--features)
5. [Recommended Improvements](#5-recommended-improvements)
6. [Implementation Priority Matrix](#6-implementation-priority-matrix)

---

## 1. Current Hilt Functionality

### 1.1 Data Sources We Currently Use

#### From JSONL Session Files (`~/.claude/projects/*/*.jsonl`)

| Field | Used For | Notes |
|-------|----------|-------|
| `sessionId` | Unique identifier | UUID format |
| `slug` | Human-readable name | e.g., "foamy-dreaming-fiddle" |
| `custom-title` entries | Custom session names | From `/rename` command |
| `summary` entries | Session title fallback | Most recent summary used |
| `timestamp` | Last activity time | From user/assistant messages |
| `gitBranch` | Display metadata | First occurrence only |
| `message.content` | First/last prompts | First 200 chars |
| `type: user/assistant` | Message count | Simple count |
| File modification time | Running detection | 30-second threshold |

#### From Our Own Storage

| Storage | Purpose |
|---------|---------|
| `data/session-status.json` | Kanban status (inbox/active/recent), starred, sort order |
| `{scope}/docs/Todo.md` | Draft prompts organized by section |
| `localStorage` | UI preferences (drawer width, recent scopes, homeDir cache) |

### 1.2 UI Features Implemented

**Kanban Board**
- 3 columns: To Do (drafts), In Progress (active), Recent (completed)
- Drag-and-drop between columns and within columns
- Multi-select for batch operations
- Global search across all columns
- Project scoping with breadcrumb navigation

**Session Cards**
- Title (custom > summary > first prompt)
- Last prompt preview (2 lines)
- Metadata: project, session ID (copyable), message count, last activity
- Running indicator (pulsing green dot)
- New session effect (fading green glow)
- Star/bookmark for Recent column

**Terminal Integration**
- Multi-tab terminal drawer
- Resume existing sessions
- Start new sessions from drafts
- Real-time PTY streaming via WebSocket
- Context progress percentage extraction
- Plan file viewing/editing

**Draft Management (To Do)**
- Parse `docs/Todo.md` markdown
- Section organization with collapsible headers
- Drag to reorder sections
- Create, edit, delete drafts
- Start draft as new session

### 1.3 What We DON'T Currently Surface

This is a partial list - see Section 4 for comprehensive analysis.

- Token usage / API costs
- Extended thinking content
- Tool usage details
- Subagent information
- Session branching/forking
- Prompt queue
- File change tracking
- Permission history

---

## 2. Claude Code Architecture & Features

### 2.1 JSONL Entry Types

Analysis of actual JSONL files reveals these entry types:

| Type | Description | UI Potential |
|------|-------------|--------------|
| `assistant` | Claude's responses | Content viewer |
| `user` | User messages + tool results | Prompt history |
| `summary` | Auto-generated summaries | Timeline view |
| `custom-title` | From `/rename` | Already used |
| `system` | System messages | Debug/status info |
| `file-history-snapshot` | File state for `/rewind` | Rewind UI |
| `queue-operation` | Prompt queue ops | Queue management UI |
| `tool_result` | Tool execution results | Tool usage analytics |

### 2.2 Message Entry Schema

Each message contains rich metadata we could surface:

```typescript
interface MessageEntry {
  // Identity
  uuid: string;
  parentUuid: string | null;  // For conversation threading
  sessionId: string;

  // Context
  cwd: string;
  gitBranch: string;
  version: string;  // Claude Code version
  slug: string;

  // Session type
  isSidechain: boolean;  // true = subagent
  agentId?: string;      // Subagent identifier

  // Content
  message: {
    role: "user" | "assistant";
    model?: string;  // e.g., "claude-opus-4-5-20251101"
    content: ContentBlock[];
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
    };
  };

  // Thinking
  thinkingMetadata?: {
    level: "high" | "medium" | "low";
    disabled: boolean;
    triggers: string[];
  };

  // Todos (session-scoped)
  todos?: TodoItem[];

  // Tool tracking
  toolUseResult?: {
    filenames?: string[];
    durationMs: number;
    numFiles?: number;
    truncated?: boolean;
  };
}
```

### 2.3 Configuration Files

| File | Scope | Contains |
|------|-------|----------|
| `~/.claude/settings.json` | User | Permissions, hooks, plugins |
| `.claude/settings.json` | Project (shared) | Team settings |
| `.claude/settings.local.json` | Project (local) | Personal overrides |
| `~/.claude.json` | User | OAuth, MCP servers, per-project stats |
| `.mcp.json` | Project | MCP server definitions |
| `CLAUDE.md` | Project | Instructions, context |

### 2.4 Key Features

**Hooks System**
- `SessionStart` / `SessionEnd` - Lifecycle events
- `PreToolUse` / `PostToolUse` - Tool interception
- `UserPromptSubmit` - Input transformation
- `Stop` / `SubagentStop` - Completion handling
- `Notification` - Alert customization

**MCP (Model Context Protocol)**
- External tool servers
- Resource providers
- Prompt templates
- Configured per-project or globally

**Extended Thinking**
- Triggered by keywords: "think", "think hard", "ultrathink"
- Budget levels: ~4k, ~10k, ~32k tokens
- Thinking content in `thinkingMetadata`

**Session Management**
- Resume by ID, name, or partial match
- Fork sessions with `--fork-session`
- Rewind with `/rewind` or `Esc+Esc`
- Rename with `/rename`
- 5-hour session time limit

**Context Management**
- Auto-compact at ~95% context
- Manual `/compact` with focus instructions
- Summaries stored in JSONL

---

## 3. Session Management Deep Dive

### 3.1 Session Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                        Session Lifecycle                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   claude           claude -c         claude --resume <id>        │
│      │                 │                      │                  │
│      ▼                 ▼                      ▼                  │
│  [NEW SESSION]   [MOST RECENT]         [SPECIFIC SESSION]        │
│      │                 │                      │                  │
│      └────────────────┴──────────────────────┘                  │
│                        │                                         │
│                        ▼                                         │
│              ┌─────────────────┐                                │
│              │  JSONL Created  │                                │
│              │  or Appended    │                                │
│              └────────┬────────┘                                │
│                       │                                         │
│         ┌─────────────┼─────────────┐                          │
│         ▼             ▼             ▼                          │
│   [WORKING]     [SUBAGENT]    [COMPACT]                        │
│         │             │             │                          │
│         │      agent-*.jsonl   summary entry                   │
│         │             │             │                          │
│         └─────────────┴─────────────┘                          │
│                       │                                         │
│         ┌─────────────┼─────────────┐                          │
│         ▼             ▼             ▼                          │
│    [/exit]      [Ctrl+C]      [5h limit]                       │
│         │             │             │                          │
│         └─────────────┴─────────────┘                          │
│                       │                                         │
│                       ▼                                         │
│              [SESSION ENDED]                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Message Threading (UUID Chain)

Sessions form a linked list via `parentUuid`:

```
msg-1 (parentUuid: null)
   └── msg-2 (parentUuid: msg-1)
         └── msg-3 (parentUuid: msg-2)
               └── msg-4 (parentUuid: msg-3)
                     │
                     ├── msg-5a (parentUuid: msg-4)  ← Branch A
                     │     └── msg-6a
                     │
                     └── msg-5b (parentUuid: msg-4)  ← Branch B (fork)
                           └── msg-6b
```

**Implications for UI:**
- Could visualize conversation branches
- Could allow "resume from point" (currently a feature request)
- Summaries have `leafUuid` pointing to their coverage point

### 3.3 Subagent Sessions

When the `Task` tool spawns a subagent:

```
Main Session (session-id.jsonl)
├── parentUuid chain of main conversation
└── isSidechain: false

Subagent Session (agent-a127988.jsonl)
├── Same sessionId as parent
├── agentId: "a127988"
├── isSidechain: true
└── Separate context window
```

**Current limitation:** Can't navigate into subagent transcripts from UI.

### 3.4 Prompt Queue

Users can type while Claude is working. Queue operations are tracked:

```json
{"type": "queue-operation", "operation": "enqueue", "content": "..."}
{"type": "queue-operation", "operation": "dequeue", ...}
```

**UI Opportunity:** Show/manage queued prompts.

---

## 4. Gap Analysis: Untapped Data & Features

### 4.1 Data We Could Surface But Don't

| Data | Source | Potential Use |
|------|--------|---------------|
| **Token usage** | `message.usage` | Cost tracking, context gauge |
| **Model used** | `message.model` | Show which model per message |
| **Cache efficiency** | `cache_read_input_tokens` | Performance metrics |
| **Tool durations** | `toolUseResult.durationMs` | Performance analytics |
| **Files touched** | `toolUseResult.filenames` | Activity summary |
| **Thinking level** | `thinkingMetadata.level` | Show thinking budget |
| **Claude Code version** | `version` | Compatibility tracking |
| **CWD changes** | `cwd` | Directory tracking |
| **All slugs** | Multiple per session | Name history |
| **Subagent info** | `agentId`, `isSidechain` | Subagent viewer |
| **Message UUIDs** | `uuid`, `parentUuid` | Conversation tree |
| **Queue operations** | `queue-operation` entries | Queue management |
| **File snapshots** | `file-history-snapshot` | Rewind capability |

### 4.2 Features We Could Build But Haven't

| Feature | Source Data | Complexity |
|---------|-------------|------------|
| **Conversation viewer** | Full JSONL parsing | Medium |
| **Cost dashboard** | `usage` fields | Low |
| **Token usage graph** | `usage` over time | Medium |
| **Subagent explorer** | `agent-*.jsonl` files | Medium |
| **Session branching/fork UI** | `parentUuid` chain | High |
| **Rewind interface** | `file-history-snapshot` | High |
| **Prompt queue manager** | `queue-operation` | Medium |
| **Tool analytics** | `toolUseResult` | Medium |
| **Thinking viewer** | `thinkingMetadata` | Low |
| **MCP server status** | `~/.claude.json` | Medium |
| **Hooks editor** | `settings.json` | Medium |
| **Permission manager** | `settings.json` | Medium |

### 4.3 Session Management Gaps

**Current State:**
- We detect "running" via file mtime (30s threshold)
- We resume sessions by spawning `claude --resume`
- We can't see inside the session while it's running elsewhere

**Gaps:**
1. **No session forking UI** - Can't branch from a point
2. **No rewind UI** - File snapshots exist but aren't exposed
3. **No subagent visibility** - Can't see what subagents did
4. **No resume-from-point** - Can only resume from end
5. **No concurrent session awareness** - Don't know about other running sessions
6. **No prompt queue visibility** - Can't see/manage queued prompts

### 4.4 Configuration Gaps

**We don't surface:**
- Hook configuration
- MCP server status/management
- Permission settings
- Plugin status
- Per-project settings

---

## 5. Recommended Improvements

### 5.1 High-Value, Low-Effort

#### A. Token Usage Display
Add to session cards and drawer:
- Input/output tokens per message
- Session total cost estimate
- Context usage percentage (we partially have this)

```typescript
// Already in JSONL, just need to parse:
message.usage.input_tokens
message.usage.output_tokens
message.usage.cache_read_input_tokens
```

#### B. Model Display
Show which model was used:
- Per-session in card metadata
- Per-message in conversation view (future)

#### C. Thinking Level Indicator
When extended thinking is used:
- Show thinking budget level
- Display thinking triggers

#### D. Tool Usage Summary
For each session, show:
- Files read/written
- Tools used (counts)
- Total tool duration

### 5.2 Medium-Value, Medium-Effort

#### E. Conversation Viewer
Full transcript view in drawer:
- User/assistant messages
- Tool calls with results
- Timestamps
- Expandable thinking blocks

#### F. Subagent Explorer
Navigate into subagent sessions:
- List subagents spawned
- View subagent transcripts
- Show subagent summaries

#### G. Cost Dashboard
Aggregate view:
- Cost per session
- Cost per project
- Cost over time
- Cache hit rate

#### H. Session Timeline
Visual timeline showing:
- Message timestamps
- Summary points
- Compaction events
- Session duration

### 5.3 High-Value, High-Effort

#### I. Rewind Interface
Visual rewind capability:
- Show conversation history with file states
- Select point to restore
- Create fork from point
- Preview file changes

#### J. Prompt Queue Manager
When running session externally:
- Show queued prompts
- Reorder queue
- Remove from queue
- Add to queue from UI

#### K. Session Branching Visualization
Tree view of session branches:
- Show forks from rewind
- Navigate between branches
- Compare branches

#### L. Multi-Session Orchestration
Manage concurrent sessions:
- Worktree integration
- Session isolation indicators
- Cross-session coordination

### 5.4 Configuration UIs

#### M. Hooks Editor
Visual hook configuration:
- List configured hooks
- Add/edit/remove hooks
- Test hook execution

#### N. MCP Server Manager
MCP server status and control:
- List installed servers
- Status indicators
- Enable/disable per-project

#### O. Permission Manager
View and modify permissions:
- Allowed/denied tools
- Per-project overrides
- Permission history

---

## 6. Implementation Priority Matrix

### Tier 1: Quick Wins (1-2 days each)

| Feature | Impact | Effort | Notes |
|---------|--------|--------|-------|
| Token usage display | High | Low | Data already in JSONL |
| Model indicator | Medium | Low | Single field |
| Thinking level badge | Medium | Low | Single field |
| Tool usage summary | Medium | Low | Aggregate existing data |

### Tier 2: Solid Improvements (3-5 days each)

| Feature | Impact | Effort | Notes |
|---------|--------|--------|-------|
| Conversation viewer | High | Medium | Full JSONL parsing |
| Subagent explorer | High | Medium | New file parsing |
| Cost dashboard | High | Medium | Aggregation logic |
| Session timeline | Medium | Medium | UI complexity |

### Tier 3: Major Features (1-2 weeks each)

| Feature | Impact | Effort | Notes |
|---------|--------|--------|-------|
| Rewind interface | High | High | Complex state management |
| Prompt queue manager | Medium | High | Real-time sync needed |
| Session branching | Medium | High | Tree visualization |
| Hooks editor | Medium | Medium | File editing + validation |

### Tier 4: Future Vision

| Feature | Impact | Effort | Notes |
|---------|--------|--------|-------|
| Multi-session orchestration | High | Very High | Worktree integration |
| MCP server manager | Medium | High | Server lifecycle |
| Full configuration UI | Medium | High | Multiple config files |

---

## Appendix A: JSONL Entry Type Reference

```
Entry Type Distribution (from hilt project):
────────────────────────────────────────────────────
assistant              6357   ████████████████████
tool_result            1455   █████
file-history-snapshot  1158   ████
text                   1126   ████
user                   1056   ███
summary                 266   █
system                  240   █
queue-operation         122
base64                   69
create                   38
update                    8
image/png                 9
custom-title              1
```

## Appendix B: Key File Paths

```
~/.claude/
├── projects/
│   └── -Users-{user}-{path}/     # Encoded project path
│       ├── {uuid}.jsonl          # Main sessions
│       └── agent-{id}.jsonl      # Subagent sessions
├── plans/
│   └── {slug}.md                 # Plan files by session slug
├── settings.json                 # User settings
├── commands/                     # User slash commands
│   └── {name}.md
├── CLAUDE.md                     # Global instructions
└── memory.db                     # SQLite (if MCP memory enabled)

{project}/
├── .claude/
│   ├── settings.json             # Shared project settings
│   ├── settings.local.json       # Local project settings
│   └── commands/                 # Project slash commands
├── .mcp.json                     # MCP server config
├── CLAUDE.md                     # Project instructions
└── docs/
    └── Todo.md                   # Draft prompts (our addition)
```

## Appendix C: Related Resources

- [Claude Code Documentation](https://code.claude.com/docs)
- [Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices)
- [JSONL Browser Tool](https://github.com/withLinda/claude-JSONL-browser)
- [Claude Code Data Toolkit](https://github.com/osolmaz/claude-code-data)
- [Feature Request: Subagent Navigation](https://github.com/anthropics/claude-code/issues/6007)
- [Feature Request: Resume from UUID](https://github.com/anthropics/claude-code/issues/3289)
