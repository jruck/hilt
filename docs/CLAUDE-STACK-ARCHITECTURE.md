# Claude Code Configuration Stack Architecture

This document maps the complete hierarchy of text files that influence Claude Code's behavior, designed to inform the implementation of a "Claude Stack Visualizer" feature in Claude Kanban.

## Overview

Claude Code's behavior is shaped by **14 distinct configuration layers**, all text-based and editable. These layers form a stack with clear precedence rules, where more specific configurations override general ones.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CLAUDE CODE CONFIGURATION STACK                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  SYSTEM LAYER (Enterprise-only, highest precedence)                    │  │
│  │  /Library/Application Support/ClaudeCode/managed-settings.json         │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    ▼                                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  USER LAYER (Global preferences)                                       │  │
│  │  ~/.claude/                                                            │  │
│  │  ├── CLAUDE.md              (Global memory/instructions)              │  │
│  │  ├── settings.json          (Global settings)                         │  │
│  │  ├── commands/              (Personal slash commands)                 │  │
│  │  ├── agents/                (Personal subagents)                      │  │
│  │  └── skills/                (Personal skills)                         │  │
│  │  ~/.claude.json             (Global config: MCP, theme, onboarding)   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    ▼                                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  PROJECT LAYER (Team-shared, version controlled)                       │  │
│  │  ./                                                                    │  │
│  │  ├── CLAUDE.md              (Project memory - checked in)             │  │
│  │  └── .claude/                                                         │  │
│  │      ├── settings.json      (Team settings - checked in)              │  │
│  │      ├── rules/             (Additional instruction files)            │  │
│  │      ├── commands/          (Project slash commands)                  │  │
│  │      ├── agents/            (Project subagents)                       │  │
│  │      ├── skills/            (Project skills)                          │  │
│  │      └── hooks/             (Hook executables)                        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    ▼                                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  LOCAL LAYER (Personal overrides, gitignored)                          │  │
│  │  ./                                                                    │  │
│  │  ├── CLAUDE.local.md        (Personal project notes)                  │  │
│  │  └── .claude/                                                         │  │
│  │      └── settings.local.json (Personal project settings)              │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Configuration Categories

### 1. Memory Files (CLAUDE.md)

**Purpose**: Persistent instructions that shape Claude's understanding and behavior for a project or globally.

| Location | Scope | Checked In | Priority |
|----------|-------|------------|----------|
| `~/.claude/CLAUDE.md` | Global | No | Lowest |
| `./CLAUDE.md` | Project | Yes | Medium |
| `./.claude/rules/*.md` | Project | Yes | Medium |
| `./CLAUDE.local.md` | Personal | No | Highest |
| `./subdir/CLAUDE.md` | Subdirectory | Optional | On-demand |

**Key Features**:
- Supports `@import` syntax for referencing other files
- Loaded hierarchically (all files merged, not overwritten)
- Rules directory allows organization into multiple files
- Symlinks supported for cross-project sharing

### 2. Settings Files (settings.json)

**Purpose**: Structured configuration for permissions, hooks, environment, and model selection.

| Location | Scope | Checked In | Priority |
|----------|-------|------------|----------|
| Enterprise managed | System | No | Highest |
| `~/.claude/settings.json` | User | No | High |
| `./.claude/settings.json` | Project | Yes | Medium |
| `./.claude/settings.local.json` | Personal | No | Low |

**Schema**:
```json
{
  "permissions": {
    "defaultMode": "default|acceptEdits|plan|bypassPermissions",
    "allow": ["Bash(npm run test:*)", "Read(~/.zshrc)"],
    "deny": ["Bash(curl:*)", "Read(./.env)"],
    "additionalDirectories": ["/path/to/context"]
  },
  "env": {
    "ANTHROPIC_API_KEY": "...",
    "API_TIMEOUT_MS": "3000000"
  },
  "hooks": { /* See Hooks section */ },
  "model": "claude-opus-4-5",
  "context": { "maxTokens": 200000 }
}
```

### 3. Global Config (~/.claude.json)

**Purpose**: Application-level settings, MCP servers, onboarding state.

```json
{
  "shiftEnterKeyBindingInstalled": true,
  "hasCompletedOnboarding": true,
  "theme": "dark",
  "mcp": {
    "servers": {
      "github": {
        "command": "npx",
        "args": ["@anthropics/mcp-github"],
        "env": { "GITHUB_TOKEN": "..." }
      }
    }
  }
}
```

### 4. Slash Commands (.claude/commands/)

**Purpose**: Custom commands invokable via `/command-name`.

| Location | Scope |
|----------|-------|
| `~/.claude/commands/*.md` | User (all projects) |
| `./.claude/commands/*.md` | Project |

**Format**:
```markdown
---
description: "What this command does"
argument-hint: "{{arg1}} {{arg2}}"
allowed-tools: [Read, Edit, Bash]
model: "claude-opus-4-5"
---

# Command Implementation

Instructions for Claude when this command is invoked.
Use {{arg1}} and {{arg2}} for arguments.
```

### 5. Skills (.claude/skills/)

**Purpose**: Specialized knowledge/procedures that Claude can invoke on-demand.

| Location | Scope |
|----------|-------|
| `~/.claude/skills/*/SKILL.md` | User |
| `./.claude/skills/*/SKILL.md` | Project |

**Structure**:
```
skill-name/
├── SKILL.md           # Required: metadata + instructions
├── REFERENCE.md       # Optional: supplemental info
├── examples.ts        # Optional: code examples
└── api-docs.md        # Optional: additional resources
```

**SKILL.md Format**:
```markdown
---
name: skill-name
description: "What this skill teaches Claude"
allowed-tools: [Read, Edit, Bash]
---

# Skill Content

Progressive disclosure: metadata loaded at startup (~100 tokens),
full content loaded on activation (~5k tokens).
```

### 6. Subagents (.claude/agents/)

**Purpose**: Specialized agent configurations for different task types.

| Location | Scope |
|----------|-------|
| `~/.claude/agents/*.md` | User |
| `./.claude/agents/*.md` | Project |

**Format**:
```markdown
---
name: "Agent Display Name"
description: "Specialization"
model: "claude-sonnet-4-5"
tools: [Read, Edit, Bash, Task]
hooks:
  - type: PreToolUse
    matcher: "Bash"
    command: "./.claude/hooks/validate.sh"
---

# Agent Instructions

Specialized behavior for this agent.
```

### 7. Hooks (.claude/hooks/ + settings.json)

**Purpose**: Execute custom scripts at specific lifecycle points.

**Hook Types**:
| Type | Trigger | Blocks | Use Case |
|------|---------|--------|----------|
| `PreToolUse` | Before tool execution | Yes (exit ≠ 0) | Validation, prevention |
| `PostToolUse` | After tool execution | No | Reminders, logging |
| `Stop` | When session stops | No | Cleanup, git checks |

**Configuration** (in settings.json):
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{
          "type": "command",
          "command": "./.claude/hooks/docs-reminder.sh"
        }]
      }
    ]
  }
}
```

### 8. MCP Servers

**Purpose**: External tool integrations via Model Context Protocol.

**Configuration in ~/.claude.json**:
```json
{
  "mcp": {
    "servers": {
      "server-name": {
        "command": "npx",
        "args": ["@package/server"],
        "env": { "TOKEN": "..." }
      }
    }
  }
}
```

**CLI Management**:
```bash
claude mcp add [name] --scope user
claude mcp list
claude mcp remove [name]
```

### 9. Plugins (Future/Beta)

**Purpose**: Bundled packages of commands, agents, skills, and MCP servers.

**Structure**:
```
~/.claude/plugins/
└── plugin-name/
    ├── plugin.json      # Manifest
    ├── commands/
    ├── agents/
    ├── skills/
    └── hooks/
```

### 10. Environment Variables

**Purpose**: Runtime configuration, API keys, feature flags.

**Sources** (priority order):
1. Command line: `VARIABLE=value claude`
2. settings.json `env` section
3. Project `.env` file
4. Shell profile (`~/.bashrc`, `~/.zshrc`)

**Key Variables**:
```bash
ANTHROPIC_API_KEY=sk-...
ANTHROPIC_BASE_URL=https://api...
CLAUDE_CODE_USE_BEDROCK=1
API_TIMEOUT_MS=3000000
CLAUDE_CODE_MAX_TOKENS=200000
ANTHROPIC_MODEL=claude-opus-4-5
```

## Loading Behavior

### Memory (CLAUDE.md) - Additive
All matching files are loaded and merged. Lower files don't replace higher ones; they add to the context.

```
~/.claude/CLAUDE.md          ← Loaded first
./CLAUDE.md                  ← Added
./.claude/rules/*.md         ← Added
./CLAUDE.local.md            ← Added last
```

### Settings - Override
More specific settings override general ones for matching keys.

```
Enterprise managed           ← Highest priority (can't override)
~/.claude/settings.json      ← User defaults
./.claude/settings.json      ← Project overrides
./.claude/settings.local.json ← Personal overrides (lowest)
```

### Commands/Skills/Agents - Merge with Priority
Project-level items take precedence over user-level items with the same name.

## Visualization Requirements

For the Claude Stack Visualizer feature, we need to:

1. **Discover** all configuration files at each layer
2. **Parse** and validate each file format
3. **Display** the hierarchy visually
4. **Enable editing** with proper format validation
5. **Show effective values** (merged/resolved state)

### File Discovery Map

| Category | Pattern | Parser |
|----------|---------|--------|
| Memory | `**/CLAUDE*.md`, `.claude/rules/*.md` | Markdown + frontmatter |
| Settings | `**/settings*.json`, `~/.claude.json` | JSON |
| Commands | `.claude/commands/*.md` | Markdown + YAML frontmatter |
| Skills | `.claude/skills/*/SKILL.md` | Markdown + YAML frontmatter |
| Agents | `.claude/agents/*.md` | Markdown + YAML frontmatter |
| Hooks | `.claude/hooks/*` | Executable scripts |
| MCP | Embedded in settings/config | JSON |

### UI Components Needed

1. **Stack Overview** - Visual representation of all layers
2. **Layer Browser** - Drill into each layer's files
3. **File Editor** - Edit individual configuration files
4. **Effective View** - Show merged/resolved configuration
5. **Validation Panel** - Show format errors, conflicts
6. **Diff View** - Compare layers, see what overrides what

## Integration with Claude Kanban

### New Data Sources

```typescript
interface ClaudeConfig {
  // Discovery
  discoverConfigFiles(projectPath: string): Promise<ConfigFile[]>;

  // Memory layer
  getMemoryFiles(projectPath: string): Promise<MemoryFile[]>;
  getEffectiveMemory(projectPath: string): Promise<string>;

  // Settings layer
  getSettingsFiles(projectPath: string): Promise<SettingsFile[]>;
  getEffectiveSettings(projectPath: string): Promise<Settings>;

  // Commands
  getCommands(projectPath: string): Promise<Command[]>;

  // Skills
  getSkills(projectPath: string): Promise<Skill[]>;

  // Agents
  getAgents(projectPath: string): Promise<Agent[]>;

  // Hooks
  getHooks(projectPath: string): Promise<Hook[]>;

  // MCP
  getMCPServers(): Promise<MCPServer[]>;
}
```

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/claude-config/stack` | GET | Get full stack overview for scope |
| `/api/claude-config/memory` | GET | List memory files |
| `/api/claude-config/memory` | PUT | Update memory file |
| `/api/claude-config/settings` | GET | Get settings (raw or effective) |
| `/api/claude-config/settings` | PUT | Update settings file |
| `/api/claude-config/commands` | GET | List commands |
| `/api/claude-config/commands/[name]` | GET/PUT/DELETE | Manage command |
| `/api/claude-config/skills` | GET | List skills |
| `/api/claude-config/skills/[name]` | GET/PUT/DELETE | Manage skill |
| `/api/claude-config/agents` | GET | List agents |
| `/api/claude-config/agents/[name]` | GET/PUT/DELETE | Manage agent |
| `/api/claude-config/hooks` | GET | List hooks |
| `/api/claude-config/mcp` | GET | List MCP servers |

### View Modes

Extend existing ViewToggle to include:
- **Board** - Kanban sessions (existing)
- **Tree** - Treemap sessions (existing)
- **Docs** - Project documentation (existing)
- **Stack** - Claude configuration stack (new)

### Stack View Layout

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Stack View                                                    [Edit Mode] │
├───────────┬────────────────────────────────────────────────────────────────┤
│           │                                                                 │
│  LAYERS   │  LAYER DETAIL                                                   │
│           │                                                                 │
│  ┌──────┐ │  ┌─────────────────────────────────────────────────────────┐   │
│  │System│ │  │  Project Memory (CLAUDE.md)                              │   │
│  └──────┘ │  │                                                          │   │
│     ↓     │  │  # Claude Kanban                                         │   │
│  ┌──────┐ │  │                                                          │   │
│  │ User │ │  │  Kanban UI for managing Claude Code sessions.            │   │
│  └──────┘ │  │                                                          │   │
│     ↓     │  │  ## Documentation                                        │   │
│  ┌──────┐ │  │  **Before making changes**, read:                        │   │
│  │Project│◀│  │  - `docs/ARCHITECTURE.md` - System design...            │   │
│  └──────┘ │  │  ...                                                     │   │
│     ↓     │  │                                                          │   │
│  ┌──────┐ │  └─────────────────────────────────────────────────────────┘   │
│  │Local │ │                                                                 │
│  └──────┘ │  FILES IN THIS LAYER:                                          │
│           │  ├── CLAUDE.md (289 lines)                                     │
│  ─────────│  ├── .claude/settings.json                                     │
│           │  ├── .claude/commands/ (7 files)                               │
│  ELEMENTS │  ├── .claude/hooks/ (1 file)                                   │
│           │  └── .claude/rules/ (empty)                                    │
│  Commands │                                                                 │
│  (7)      │                                                                 │
│           │                                                                 │
│  Skills   │                                                                 │
│  (0)      │                                                                 │
│           │                                                                 │
│  Agents   │                                                                 │
│  (0)      │                                                                 │
│           │                                                                 │
│  Hooks    │                                                                 │
│  (2)      │                                                                 │
│           │                                                                 │
│  MCP      │                                                                 │
│  (0)      │                                                                 │
│           │                                                                 │
└───────────┴────────────────────────────────────────────────────────────────┘
```

## References

- [Claude Code Memory Docs](https://code.claude.com/docs/en/memory)
- [Claude Code Settings Docs](https://code.claude.com/docs/en/settings)
- [Claude Code Skills Docs](https://code.claude.com/docs/en/skills)
- [Claude Code Subagents Docs](https://code.claude.com/docs/en/sub-agents)
- [Claude Code Slash Commands Docs](https://code.claude.com/docs/en/slash-commands)
- [Claude Code MCP Docs](https://code.claude.com/docs/en/mcp)
- [CodexSkillManager](https://github.com/Dimillian/CodexSkillManager) - Inspiration for skills UI

---

*Created: 2026-01-08*
