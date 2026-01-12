# MCP Server & Plugin Display in Stack Tab

## Status

### Completed ✅
- MCP server discovery (user, project, plugin sources)
- MCP servers displayed in StackFileTree grouped by layer
- MCPServerDetail panel with connection info, env vars, plugin metadata
- Enable/disable toggle for plugin-based MCP servers
- Edit mode for user-defined MCP servers
- MCP filter in summary bar
- Fixed duplication bug when scope is home directory

### In Progress 🔄
- Phase 6: Plugin display (plugins as first-class entities)
- Phase 7: Auth status from credentials file

---

## Original Problem Statement

The Stack tab has UI support for MCP servers, but displays 0 servers regardless of what's actually configured. This is because:
1. MCP servers are stored in different locations than where the code looks
2. The plugin system isn't being read at all
3. Discovery is hardcoded to return 0

## Current State

### Where MCP Config Actually Lives

**1. User-level MCP servers**: `~/.claude/.mcp.json`
```json
{
  "mcpServers": {
    "codex": {
      "type": "stdio",
      "command": "codex",
      "args": ["-m", "gpt-5.2-codex", "mcp-server"]
    }
  }
}
```

**2. Plugin system**: `~/.claude/plugins/`
- `installed_plugins.json` - Registry with install paths for each plugin
- Each plugin's directory contains a `.mcp.json` with its MCP server definition
- Example: `~/.claude/plugins/cache/claude-plugins-official/github/f1be96f0fb58/.mcp.json`

**3. Plugin enablement**: `~/.claude/settings.json`
```json
{
  "enabledPlugins": {
    "github@claude-plugins-official": true,
    "context7@claude-plugins-official": true,
    ...
  }
}
```

**4. Project-level** (optional): `.claude/.mcp.json`

### MCP Server Types Found

**Stdio servers** (process-based):
```json
{
  "context7": {
    "command": "npx",
    "args": ["-y", "@upstash/context7-mcp"]
  }
}
```

**HTTP servers**:
```json
{
  "github": {
    "type": "http",
    "url": "https://api.githubcopilot.com/mcp/",
    "headers": {
      "Authorization": "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}"
    }
  }
}
```

### What Hilt Currently Does Wrong

| Issue | Location | Problem |
|-------|----------|---------|
| Hardcoded 0 | `discovery.ts:221` | `mcpServers: 0` never computed |
| Wrong location | `parsers.ts` | Looks for `mcp.servers` in settings.json |
| No plugin awareness | `discovery.ts` | Doesn't read `~/.claude/plugins/` |
| Incomplete type | `types.ts` | `MCPServerConfig` missing HTTP fields |

## Proposed Solution

### Phase 1: Data Model Updates

**Update `MCPServerConfig` in `types.ts`:**
```typescript
export type MCPServerType = "stdio" | "http";

export interface MCPServerConfig {
  name: string;
  type: MCPServerType;
  enabled: boolean;
  source: string; // Which config file defines this
  pluginId?: string; // e.g., "github@claude-plugins-official"

  // Stdio servers
  command?: string;
  args?: string[];
  env?: Record<string, string>;

  // HTTP servers
  url?: string;
  headers?: Record<string, string>;
}
```

**Add new types:**
```typescript
export interface InstalledPlugin {
  id: string; // e.g., "github@claude-plugins-official"
  name: string; // e.g., "github"
  marketplace: string; // e.g., "claude-plugins-official"
  scope: "user" | "project";
  installPath: string;
  version: string;
  enabled: boolean;
  mcpServer?: MCPServerConfig;
}

export interface PluginRegistry {
  version: number;
  plugins: Record<string, InstalledPlugin[]>;
}
```

### Phase 2: Discovery Updates

**New files to create:**
- `src/lib/claude-config/mcp-discovery.ts` - MCP-specific discovery logic

**Discovery sources:**
1. Read `~/.claude/.mcp.json` for user-level MCP servers
2. Read `~/.claude/plugins/installed_plugins.json` for plugin registry
3. For each installed plugin, read its `.mcp.json`
4. Read `~/.claude/settings.json` for `enabledPlugins`
5. Check for project-level `.claude/.mcp.json`

**Update `discovery.ts`:**
- Call `discoverMCPServers()` in `discoverStack()`
- Pass results to `computeSummary()` for actual count

### Phase 3: API Updates

**New API route**: `GET /api/claude-stack/mcp`
- Returns all discovered MCP servers with their status
- Includes plugin metadata where applicable

**Update existing**: `GET /api/claude-stack`
- Include MCP servers in the response
- Compute accurate `mcpServers` count

### Phase 4: UI Updates

MCP servers integrate into the **existing StackFileTree** - no separate list component needed.

**Layer mapping:**
| MCP Source | Layer |
|------------|-------|
| `~/.claude/.mcp.json` | User |
| Plugin MCP servers (user-installed) | User |
| `.claude/.mcp.json` (project) | Project |

**New component**: `src/components/stack/MCPServerDetail.tsx`
- Server name, description, and type (stdio/http)
- Connection details (command/args or url/headers)
- Environment variables (masked for sensitive values)
- Source info (plugin name/marketplace or "user-defined")
- Plugin metadata if applicable (author, homepage, repository)
- Enable/disable toggle
- Keywords/tags if available

**Update `StackFileTree.tsx`:**
- Render MCP servers as items within their layer (user/project)
- Use Server icon with cyan color (already defined)
- Show enabled/disabled status inline
- Clicking opens detail panel in StackContentPane

**Update `StackContentPane.tsx`:**
- Handle MCP server selection (render MCPServerDetail instead of file editor)
- For user-defined servers: show editable JSON
- For plugin servers: show read-only details with links

### Phase 5: Enable/Disable Functionality

**API**: `PUT /api/claude-stack/mcp/:serverId`
```typescript
{ enabled: boolean }
```

**Implementation**:
- For plugins: Update `enabledPlugins` in `~/.claude/settings.json`
- For user MCP: Could remove from `.mcp.json` or add to disabled list

## File Changes Summary

| File | Changes |
|------|---------|
| `src/lib/claude-config/types.ts` | Add `MCPServerType`, update `MCPServerConfig`, add plugin metadata types |
| `src/lib/claude-config/mcp-discovery.ts` | **NEW** - MCP/plugin discovery logic |
| `src/lib/claude-config/discovery.ts` | Call MCP discovery, include servers in layers, update summary |
| `src/app/api/claude-stack/route.ts` | Include MCP servers in response |
| `src/app/api/claude-stack/mcp/route.ts` | **NEW** - MCP-specific endpoints (toggle, edit) |
| `src/components/stack/MCPServerDetail.tsx` | **NEW** - Server detail panel |
| `src/components/stack/StackFileTree.tsx` | Render MCP servers within layer groups |
| `src/components/stack/StackContentPane.tsx` | Handle MCP server selection, render detail panel |

## User Experience

### Before
- User clicks MCP filter → sees "0" in count → no items appear

### After
- MCP servers appear in the tree under their respective layers (User/Project)
- User clicks MCP filter → sees actual count (e.g., "14") → tree shows only MCP servers, still grouped by layer
- Each server shows: name, enabled/disabled indicator
- Clicking a server shows detail panel with:
  - Description (from plugin metadata)
  - Type (stdio/http)
  - Connection details
  - Source (plugin or user-defined)
  - Enable/disable toggle
  - Plugin links if applicable
- User-defined servers can be edited directly
- Plugin servers show as read-only with links to docs/repo

## Visual Design

**Tree view (with MCP filter active):**
```
┌────────────────────────────────────────┐
│ ▼ User (14)                            │
│   ├── 🔌 github           ✓            │
│   ├── 🔌 context7         ✓            │
│   ├── 🔌 atlassian        ✓            │
│   ├── 🔌 asana            ○            │
│   ├── 🔌 codex            ✓            │
│   └── ...                              │
│ ▼ Project (1)                          │
│   └── 🔌 project-mcp      ✓            │
└────────────────────────────────────────┘
```

**Detail panel (when server selected):**
```
┌─────────────────────────────────────────────────────────────┐
│ github                                            [✓ Enabled]│
├─────────────────────────────────────────────────────────────┤
│ Official GitHub MCP server for repository management.       │
│ Create issues, manage pull requests, review code...         │
│                                                             │
│ Type: HTTP                                                  │
│ URL: https://api.githubcopilot.com/mcp/                     │
│ Headers: Authorization: Bearer ${GITHUB_PERSONAL_...}       │
│                                                             │
│ Source: Plugin (github@claude-plugins-official)             │
│ Author: GitHub                                              │
│ Version: f1be96f0fb58                                       │
│                                                             │
│ [View Repository]  [View Homepage]                          │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Order

1. **Types** - Update data model (quick, foundational)
2. **Discovery** - Implement MCP discovery (core logic)
3. **API** - Update/add endpoints (expose data)
4. **UI - Tree** - Show MCP servers in StackFileTree
5. **UI - Detail** - Server detail panel (full info)
6. **Enable/Disable** - Toggle functionality

## User Decisions

1. **Editing**: Yes, support editing user-defined MCP servers in Hilt
2. **Show all**: Yes, show all plugins including disabled ones, grouped by status
3. **Marketplace grouping**: No, just provide that context as metadata in detail panel
4. **Detail panel**: Show everything available - description, status, errors, actions, settings
5. **UI integration**: MCP servers appear in existing StackFileTree, grouped by layer (user/project) like all other items - no separate list component

## Additional Discovery: Plugin Metadata

Each plugin has a `.claude-plugin/plugin.json` with rich metadata:

```json
{
  "name": "github",
  "description": "Official GitHub MCP server for repository management...",
  "version": "f1be96f0fb58",
  "author": {
    "name": "GitHub",
    "email": "...",
    "url": "https://github.com/..."
  },
  "homepage": "https://...",
  "repository": "https://github.com/...",
  "license": "MIT",
  "keywords": ["github", "api", ...],
  "mcpServers": { ... }  // Some plugins define servers here instead of .mcp.json
}
```

**MCP server sources discovered:**
1. `~/.claude/.mcp.json` - User-defined servers
2. Plugin `.mcp.json` files - Standalone server config
3. Plugin `plugin.json` → `mcpServers` field - Some plugins embed servers here
4. Project `.claude/.mcp.json` - Project-specific servers (optional)

**Note:** Runtime status/errors not available from files - would need Claude Code integration

---

## Phase 6: Plugin Display (NEW)

Plugins are currently only visible through their MCP servers. This phase adds plugins as first-class entities in Stack.

### Data Sources

**`~/.claude/plugins/installed_plugins.json`** - Plugin registry:
```json
{
  "version": 2,
  "plugins": {
    "github@claude-plugins-official": [{
      "scope": "user",
      "installPath": "/Users/.../.claude/plugins/cache/.../github/f1be96f0fb58",
      "version": "f1be96f0fb58",
      "installedAt": "2026-01-07T05:55:38.562Z",
      "lastUpdated": "2026-01-12T02:31:49.107Z",
      "gitCommitSha": "b97f6eadd929..."
    }]
  }
}
```

**`~/.claude/settings.json`** - Enablement state:
```json
{
  "enabledPlugins": {
    "github@claude-plugins-official": true,
    "asana@claude-plugins-official": false
  }
}
```

**Plugin metadata** at `{installPath}/.claude-plugin/plugin.json`:
```json
{
  "name": "github",
  "description": "Official GitHub MCP server...",
  "author": { "name": "GitHub" },
  "version": "...",
  "homepage": "...",
  "repository": "...",
  "keywords": [...]
}
```

### Data Model Updates

**New type in `types.ts`:**
```typescript
export interface PluginConfig {
  id: string;              // e.g., "github@claude-plugins-official"
  name: string;            // e.g., "github"
  marketplace: string;     // e.g., "claude-plugins-official"
  scope: "user";           // Currently only user scope exists
  enabled: boolean;
  version: string;
  installPath: string;
  installedAt?: string;
  lastUpdated?: string;
  gitCommitSha?: string;

  // From plugin.json metadata
  description?: string;
  author?: { name?: string; email?: string; url?: string };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];

  // Relationships
  mcpServers: string[];    // Names of MCP servers this plugin provides
}
```

**Update `ConfigStackSummary`:**
```typescript
export interface ConfigStackSummary {
  // ... existing fields
  plugins: number;         // NEW: count of installed plugins
}
```

### Discovery Updates

**New file: `src/lib/claude-config/plugin-discovery.ts`**

```typescript
export async function discoverPlugins(homePath: string): Promise<PluginConfig[]>
```

Sources:
1. Read `~/.claude/plugins/installed_plugins.json`
2. For each plugin, read metadata from `.claude-plugin/plugin.json`
3. Cross-reference with `enabledPlugins` in settings.json
4. Link to MCP servers by matching pluginId

### UI Updates

**StackFileTree:**
- Add "Plugins" section (separate from MCP servers, or as a filter option)
- Each plugin shows: name, enabled/disabled, version
- Plugins that provide MCP servers could show a badge or expand to show them

**New component: `PluginDetail.tsx`**
- Plugin name, description, author
- Version, install date, last updated
- Enable/disable toggle
- List of MCP servers this plugin provides (clickable links)
- Homepage/repository links
- Keywords

**StackSummary:**
- Add plugins count to summary bar
- Add "Plugins" filter option

### Visual Design

**Tree view (with Plugins filter):**
```
┌────────────────────────────────────────┐
│ ▼ Plugins (13)                         │
│   ├── 🔌 github             ✓          │
│   │   └── MCP: github                  │
│   ├── 🔌 context7           ✓          │
│   │   └── MCP: context7                │
│   ├── 🔌 atlassian          ✓          │
│   │   └── MCP: atlassian               │
│   ├── 🔌 asana              ○          │
│   │   └── MCP: asana                   │
│   ├── 🔌 feature-dev        ✓          │
│   │   └── (no MCP)                     │
│   └── ...                              │
└────────────────────────────────────────┘
```

---

## Phase 7: Auth Status Display (NEW)

Surface OAuth token expiration status for MCP servers that require authentication.

### Data Source

**`~/.claude/.credentials.json`** - OAuth tokens per server:
```json
{
  "mcpOAuth": {
    "plugin:asana:asana|606ad0f6a16e323c": {
      "serverName": "plugin:asana:asana",
      "serverUrl": "https://mcp.asana.com/sse",
      "accessToken": "...",
      "expiresAt": 1767830657813,
      "refreshToken": "..."
    },
    "plugin:atlassian:atlassian|10b03db13d93ddad": {
      "serverName": "plugin:atlassian:atlassian",
      "expiresAt": 1768007270869,
      "refreshToken": "..."
    }
  }
}
```

### Auth Status Logic

```typescript
type AuthStatus =
  | "authenticated"      // Has valid token, not expired
  | "expired"            // Token exists but expiresAt < now
  | "needs-reauth"       // Token expired AND no refreshToken
  | "not-configured"     // No credentials entry for this server
  | "not-required";      // Server doesn't use OAuth (stdio, or no auth headers)
```

**Determination logic:**
1. Match server to credentials by `serverName` pattern (e.g., `plugin:github:github`)
2. If no match → `not-configured` or `not-required` (based on server type)
3. If match exists:
   - Check `expiresAt` vs current time
   - If expired and no `refreshToken` → `needs-reauth`
   - If expired but has `refreshToken` → `expired` (will auto-refresh)
   - If not expired → `authenticated`

### Data Model Updates

**Update `MCPServerConfig`:**
```typescript
export interface MCPServerConfig {
  // ... existing fields

  // Auth status (populated from credentials file)
  authStatus?: "authenticated" | "expired" | "needs-reauth" | "not-configured" | "not-required";
  authExpiresAt?: number;  // Unix timestamp
}
```

### Discovery Updates

**New file or addition to `mcp-discovery.ts`:**
```typescript
async function enrichWithAuthStatus(
  servers: MCPServerConfig[],
  homePath: string
): Promise<MCPServerConfig[]>
```

Reads `.credentials.json` and populates `authStatus` and `authExpiresAt` for each server.

### UI Updates

**StackFileTree:**
- Show auth status indicator next to server name
- Color coding:
  - Green dot: authenticated
  - Yellow dot: expired (will auto-refresh)
  - Red dot: needs-reauth
  - Gray dot: not-configured
  - No dot: not-required (stdio servers)

**MCPServerDetail:**
- Show "Authentication" section with:
  - Current status badge
  - Expiration time (relative: "expires in 2 hours" or "expired 3 days ago")
  - "Re-authenticate" button placeholder (links to Claude settings or shows instructions)

### Visual Design

**Tree view with auth status:**
```
┌────────────────────────────────────────┐
│ ▼ User (7)                             │
│   ├── 🔌 github         🟢  ✓          │
│   ├── 🔌 context7       ─   ✓          │
│   ├── 🔌 atlassian      🟢  ✓          │
│   ├── 🔌 asana          🔴  ○          │
│   ├── 🔌 codex          ─   ✓          │
│   └── ...                              │
└────────────────────────────────────────┘

Legend: 🟢 authenticated  🟡 expired  🔴 needs-reauth  ─ not-required
```

**Detail panel auth section:**
```
┌─────────────────────────────────────────────────────────────┐
│ Authentication                                              │
│ ─────────────────────────────────────────────────────────── │
│ Status: 🔴 Needs Re-authentication                          │
│ Token expired 3 days ago                                    │
│                                                             │
│ To re-authenticate, run Claude Code and use the server.     │
│ Claude will prompt you to log in again.                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Order (Updated)

### Completed
1. ✅ Types - Update data model
2. ✅ MCP Discovery - Implement MCP discovery
3. ✅ API - Update/add endpoints
4. ✅ UI - Tree - Show MCP servers in StackFileTree
5. ✅ UI - Detail - Server detail panel
6. ✅ Enable/Disable - Toggle functionality
7. ✅ User editing - Edit user-defined MCP servers

### Next Up
8. 🔄 Plugin Discovery - `plugin-discovery.ts`
9. 🔄 Plugin Detail UI - `PluginDetail.tsx`
10. 🔄 Auth Status Discovery - Read credentials file
11. 🔄 Auth Status UI - Status indicators in tree + detail panel

---

## Design Decisions

### What We're Building On (Stable)
- `installed_plugins.json` - Official plugin registry format
- `.claude-plugin/plugin.json` - Standard plugin metadata
- `settings.json` → `enabledPlugins` - Official enablement mechanism
- `.credentials.json` → `mcpOAuth` - Official OAuth token storage

### What We're NOT Building On (Ephemeral/Unstable)
- Debug logs (`~/.claude/debug/`) - Session-specific, format may change
- Runtime connection status - Only available during active Claude sessions
- Any undocumented internal state files
