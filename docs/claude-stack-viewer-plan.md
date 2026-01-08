# Claude Stack Viewer - Integration Plan

## Vision

Transform Claude Kanban from a session management tool into a **complete Claude Code control center** that lets you visualize, understand, and manipulate all the text layers that shape Claude's behavior.

The goal: **Make the invisible visible.** Most users have no idea that their Claude behavior is shaped by 10+ different configuration files across 4+ directories. We expose this, make it explorable, and make it editable.

## Inspiration

- **CodexSkillManager** (github.com/Dimillian/CodexSkillManager) - macOS app for browsing/managing skills across `~/.claude/skills/` and `~/.codex/skills/`. Good UI for skill discovery, SKILL.md rendering.
- **What we want to do differently**: Go beyond just skills. Show the ENTIRE configuration stack - memory files, settings, commands, agents, hooks, MCP servers, environment. Make it a true "X-ray into Claude's brain."

## The Configuration Stack (What We're Visualizing)

```
14 Configuration Layers
├── Memory Layer (CLAUDE.md files)
│   ├── ~/.claude/CLAUDE.md (global)
│   ├── ./CLAUDE.md (project, checked in)
│   ├── ./.claude/rules/*.md (organized rules)
│   └── ./CLAUDE.local.md (personal, gitignored)
│
├── Settings Layer (JSON configs)
│   ├── Enterprise managed (highest priority)
│   ├── ~/.claude/settings.json (user defaults)
│   ├── ./.claude/settings.json (project, checked in)
│   └── ./.claude/settings.local.json (personal)
│
├── Global Config
│   └── ~/.claude.json (MCP servers, theme, etc)
│
├── Commands Layer (.claude/commands/)
│   ├── ~/.claude/commands/*.md (user)
│   └── ./.claude/commands/*.md (project)
│
├── Skills Layer (.claude/skills/)
│   ├── ~/.claude/skills/*/SKILL.md (user)
│   └── ./.claude/skills/*/SKILL.md (project)
│
├── Agents Layer (.claude/agents/)
│   ├── ~/.claude/agents/*.md (user)
│   └── ./.claude/agents/*.md (project)
│
├── Hooks Layer
│   ├── Defined in settings.json (any level)
│   └── Executables in .claude/hooks/
│
├── MCP Servers
│   └── Defined in ~/.claude.json or settings.json
│
└── Environment Variables
    ├── .env files
    ├── settings.json env section
    └── Shell profile
```

## Phased Implementation

### Phase 1: Discovery & Read-Only View

**Goal**: Show users what's shaping their Claude, without editing.

#### 1.1 Backend: Configuration Discovery

New library: `src/lib/claude-config.ts`

```typescript
interface ConfigFile {
  path: string;           // Absolute path
  type: 'memory' | 'settings' | 'command' | 'skill' | 'agent' | 'hook' | 'mcp';
  layer: 'system' | 'user' | 'project' | 'local';
  exists: boolean;
  size?: number;
  mtime?: Date;
}

interface ClaudeStack {
  projectPath: string;
  layers: {
    system: ConfigFile[];
    user: ConfigFile[];
    project: ConfigFile[];
    local: ConfigFile[];
  };
  summary: {
    memoryFiles: number;
    commands: number;
    skills: number;
    agents: number;
    hooks: number;
    mcpServers: number;
  };
}

// Functions
discoverStack(projectPath: string): Promise<ClaudeStack>
getMemoryFiles(projectPath: string): Promise<MemoryFile[]>
getCommands(projectPath: string): Promise<Command[]>
getSkills(projectPath: string): Promise<Skill[]>
// etc.
```

#### 1.2 API Route

`src/app/api/claude-stack/route.ts`

```typescript
// GET /api/claude-stack?scope=/path/to/project
// Returns full ClaudeStack object
```

#### 1.3 Frontend: Stack View

New view mode in ViewToggle: "Stack"

Components:
- `src/components/stack/StackView.tsx` - Main container
- `src/components/stack/LayerPanel.tsx` - Left sidebar showing layer hierarchy
- `src/components/stack/ConfigFileList.tsx` - Files in selected layer
- `src/components/stack/ConfigPreview.tsx` - Read-only file preview

#### 1.4 UI Design

```
┌─────────────────────────────────────────────────────────────────┐
│  [Tree] [Board] [Docs] [Stack●]           /Users/x/project      │
├─────────────┬───────────────────────────────────────────────────┤
│             │                                                    │
│  STACK      │  USER LAYER                                        │
│  LAYERS     │                                                    │
│             │  ~/.claude/                                        │
│  ○ System   │  ├── CLAUDE.md           (global memory)          │
│  ● User     │  ├── settings.json       (global settings)        │
│  ○ Project  │  ├── commands/           (3 personal commands)    │
│  ○ Local    │  │   ├── my-debug.md                              │
│             │  │   ├── quick-fix.md                             │
│  ──────────│  │   └── review.md                                 │
│             │  └── skills/             (1 skill)                 │
│  SUMMARY    │      └── react-testing/                           │
│             │          └── SKILL.md                              │
│  Memory: 3  │                                                    │
│  Commands: 10│  ─────────────────────────────────────────────────│
│  Skills: 2  │                                                    │
│  Agents: 1  │  PREVIEW: ~/.claude/CLAUDE.md                      │
│  Hooks: 2   │                                                    │
│  MCP: 3     │  # Global Claude Settings                          │
│             │                                                    │
│             │  These instructions apply to ALL my projects:      │
│             │                                                    │
│             │  - Always use TypeScript                          │
│             │  - Prefer functional components                    │
│             │  - Run tests before committing                     │
│             │  ...                                               │
│             │                                                    │
└─────────────┴───────────────────────────────────────────────────┘
```

### Phase 2: Editing Capabilities

**Goal**: Let users create, edit, and delete configuration files.

#### 2.1 File Editing API

```typescript
// PUT /api/claude-stack/file
{ path: string, content: string }

// DELETE /api/claude-stack/file
{ path: string }

// POST /api/claude-stack/file
{ path: string, content: string, type: 'command' | 'skill' | 'agent' | ... }
```

#### 2.2 Editor Components

- `ConfigEditor.tsx` - Monaco/CodeMirror editor for files
- `CommandEditor.tsx` - Specialized editor for commands (frontmatter + body)
- `SkillEditor.tsx` - Specialized editor for skills
- `SettingsEditor.tsx` - JSON editor with schema validation

#### 2.3 Validation

- JSON Schema validation for settings files
- Frontmatter validation for commands/skills/agents
- Hook permission warnings

### Phase 3: Advanced Features

#### 3.1 Effective Configuration View

Show the MERGED result of all layers:

```typescript
// What Claude actually sees after merging all CLAUDE.md files
getEffectiveMemory(projectPath: string): Promise<string>

// What settings are actually in effect after layer resolution
getEffectiveSettings(projectPath: string): Promise<Settings>
```

UI: Toggle between "Layered View" and "Effective View"

#### 3.2 Diff View

Compare what's in User layer vs Project layer:
- What settings does the project override?
- What commands are project-specific vs global?

#### 3.3 Conflict Detection

- Settings that might conflict
- Commands with same name at different layers
- Missing required files (e.g., command references nonexistent hook)

#### 3.4 Templates & Scaffolding

Quick-create common configurations:
- "Create new command" → Generates template in .claude/commands/
- "Create new skill" → Scaffolds skill directory structure
- "Add hook" → Adds hook config to settings.json

#### 3.5 Import from Clawdhub / External Sources

Like CodexSkillManager's remote browsing:
- Browse skill catalogs
- One-click install to user or project layer

### Phase 4: Session-Aware Configuration

Connect configuration to sessions:

- Which sessions used which skills?
- What was the effective config when a session ran?
- "Clone this session's config to another project"

## File Structure

```
src/
├── lib/
│   ├── claude-config/
│   │   ├── discovery.ts      # Find all config files
│   │   ├── parsers.ts        # Parse different file formats
│   │   ├── validators.ts     # Validate schemas
│   │   ├── writers.ts        # Write config files
│   │   └── types.ts          # TypeScript interfaces
│   └── claude-sessions.ts    # (existing)
│
├── app/api/
│   ├── claude-stack/
│   │   ├── route.ts          # GET stack overview
│   │   ├── file/route.ts     # CRUD for individual files
│   │   ├── effective/route.ts # Merged configuration
│   │   └── validate/route.ts  # Validate file content
│   └── sessions/             # (existing)
│
├── components/
│   ├── stack/
│   │   ├── StackView.tsx         # Main container
│   │   ├── LayerPanel.tsx        # Layer navigation
│   │   ├── ConfigFileList.tsx    # Files in layer
│   │   ├── ConfigPreview.tsx     # Read-only preview
│   │   ├── ConfigEditor.tsx      # Edit mode
│   │   ├── EffectiveView.tsx     # Merged view
│   │   └── StackSummary.tsx      # Stats sidebar
│   └── Board.tsx             # (add Stack to ViewToggle)
│
└── hooks/
    └── useClaudeStack.ts     # SWR hook for stack data
```

## API Design

### GET /api/claude-stack

```typescript
// Request
GET /api/claude-stack?scope=/Users/x/project

// Response
{
  projectPath: "/Users/x/project",
  layers: {
    system: [],
    user: [
      { path: "~/.claude/CLAUDE.md", type: "memory", exists: true, size: 1024 },
      { path: "~/.claude/settings.json", type: "settings", exists: true },
      { path: "~/.claude/commands/debug.md", type: "command", exists: true },
      // ...
    ],
    project: [
      { path: "./CLAUDE.md", type: "memory", exists: true, size: 2048 },
      { path: "./.claude/settings.json", type: "settings", exists: true },
      { path: "./.claude/commands/track.md", type: "command", exists: true },
      // ...
    ],
    local: [
      { path: "./CLAUDE.local.md", type: "memory", exists: false },
      { path: "./.claude/settings.local.json", type: "settings", exists: false },
    ]
  },
  summary: {
    memoryFiles: 3,
    commands: 10,
    skills: 2,
    agents: 1,
    hooks: 2,
    mcpServers: 3
  }
}
```

### GET /api/claude-stack/file

```typescript
// Request
GET /api/claude-stack/file?path=/Users/x/project/.claude/commands/track.md

// Response
{
  path: "/Users/x/project/.claude/commands/track.md",
  type: "command",
  layer: "project",
  content: "---\ndescription: Track bugs, tasks, ideas\n---\n...",
  parsed: {
    frontmatter: { description: "...", argumentHint: "..." },
    body: "..."
  }
}
```

## Key Decisions

### Q: Should we show ~/.claude.json separately from settings.json?
**A**: Yes. It serves a different purpose (app config vs session config) and lives in a different location. Show it in User layer but visually distinguished.

### Q: How handle enterprise managed settings?
**A**: Show as read-only System layer. Most users won't have this, so it'll be empty/collapsed.

### Q: Editing permissions?
**A**:
- User layer: Always editable
- Project layer: Editable (write to .claude/)
- Local layer: Editable (write to CLAUDE.local.md etc)
- System layer: Read-only, show lock icon

### Q: What about .env files?
**A**: Show them in discovery but DON'T show contents (security). Show presence + let user know they exist. Maybe link to open in system editor.

## Success Metrics

1. **Discoverability**: Users can see ALL config affecting their Claude
2. **Understanding**: Clear visual hierarchy of precedence
3. **Editability**: Can modify configs without leaving the UI
4. **Confidence**: Know what's happening when Claude behaves unexpectedly

## Open Questions

1. Should we integrate with git to show which configs are tracked vs gitignored?
2. How to handle config files that reference other files (@import)?
3. Should we offer "export project config as zip" for sharing?
4. Integration with CodexSkillManager / Clawdhub for skill discovery?

---

*Created: 2026-01-08*
