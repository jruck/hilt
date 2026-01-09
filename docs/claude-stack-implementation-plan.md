# Claude Stack Viewer - Detailed Implementation Plan

## Overview

This document provides step-by-step implementation tasks for the Claude Stack Viewer feature. Tasks are ordered by dependency - complete earlier tasks before later ones.

---

## Phase 1: Core Infrastructure (Backend)

### Task 1.1: Define TypeScript Types

**File**: `src/lib/claude-config/types.ts`

```typescript
// Configuration file types
export type ConfigFileType =
  | 'memory'      // CLAUDE.md, CLAUDE.local.md, rules/*.md
  | 'settings'    // settings.json, settings.local.json, ~/.claude.json
  | 'command'     // .claude/commands/*.md
  | 'skill'       // .claude/skills/*/SKILL.md
  | 'agent'       // .claude/agents/*.md
  | 'hook'        // .claude/hooks/*
  | 'mcp'         // MCP servers (embedded in settings)
  | 'env';        // .env files (presence only, not contents)

export type ConfigLayer = 'system' | 'user' | 'project' | 'local';

export interface ConfigFile {
  path: string;              // Absolute path
  relativePath: string;      // Path relative to layer root (for display)
  type: ConfigFileType;
  layer: ConfigLayer;
  exists: boolean;
  size?: number;             // bytes
  mtime?: number;            // Unix timestamp ms
  name: string;              // Display name (filename or skill name)
  description?: string;      // From frontmatter if available
}

export interface ConfigFileContent extends ConfigFile {
  content: string | null;    // null if binary or sensitive
  parsed?: {
    frontmatter?: Record<string, unknown>;
    body?: string;
  };
  isSensitive?: boolean;     // true for .env files
  isEditable: boolean;       // false for system layer
}

export interface ClaudeStack {
  projectPath: string;
  homePath: string;          // For resolving ~
  layers: {
    system: ConfigFile[];
    user: ConfigFile[];
    project: ConfigFile[];
    local: ConfigFile[];
  };
  summary: {
    memoryFiles: number;
    settingsFiles: number;
    commands: number;
    skills: number;
    agents: number;
    hooks: number;
    mcpServers: number;
    envFiles: number;
  };
}

// Parsed config types
export interface CommandConfig {
  name: string;              // Derived from filename
  path: string;
  layer: ConfigLayer;
  description?: string;
  argumentHint?: string;
  allowedTools?: string[];
  model?: string;
  body: string;
}

export interface SkillConfig {
  name: string;
  path: string;
  layer: ConfigLayer;
  description?: string;
  allowedTools?: string[];
  references?: string[];     // Additional files in skill directory
}

export interface AgentConfig {
  name: string;
  path: string;
  layer: ConfigLayer;
  description?: string;
  model?: string;
  tools?: string[];
}

export interface HookConfig {
  type: 'PreToolUse' | 'PostToolUse' | 'Stop';
  matcher: string;
  command: string;
  source: string;            // Which settings file defines this
}

export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  source: string;            // Which config file defines this
}

export interface SettingsConfig {
  permissions?: {
    defaultMode?: string;
    allow?: string[];
    deny?: string[];
    additionalDirectories?: string[];
  };
  env?: Record<string, string>;
  hooks?: Record<string, unknown>;
  model?: string;
  mcp?: {
    servers?: Record<string, unknown>;
  };
}

// API response types
export interface ClaudeStackResponse {
  stack: ClaudeStack;
  error?: string;
}

export interface ConfigFileResponse {
  file: ConfigFileContent;
  error?: string;
}

export interface ConfigFileSaveRequest {
  path: string;
  content: string;
  createDirectories?: boolean;
}

export interface ConfigFileSaveResponse {
  success: boolean;
  mtime?: number;
  error?: string;
}
```

**Acceptance criteria**:
- [ ] All types compile without errors
- [ ] Types cover all configuration categories
- [ ] Types match Claude Code's actual file formats

---

### Task 1.2: Implement File Discovery

**File**: `src/lib/claude-config/discovery.ts`

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { ConfigFile, ConfigFileType, ConfigLayer, ClaudeStack } from './types';

// Platform-specific paths
const SYSTEM_PATHS = {
  darwin: '/Library/Application Support/ClaudeCode/managed-settings.json',
  linux: '/etc/claude-code/managed-settings.json',
  win32: 'C:\\ProgramData\\ClaudeCode\\managed-settings.json',
};

export async function discoverStack(projectPath: string): Promise<ClaudeStack> {
  const homePath = homedir();

  const [system, user, project, local] = await Promise.all([
    discoverSystemLayer(),
    discoverUserLayer(homePath),
    discoverProjectLayer(projectPath),
    discoverLocalLayer(projectPath),
  ]);

  return {
    projectPath,
    homePath,
    layers: { system, user, project, local },
    summary: computeSummary({ system, user, project, local }),
  };
}

async function discoverSystemLayer(): Promise<ConfigFile[]> {
  const files: ConfigFile[] = [];
  const systemPath = SYSTEM_PATHS[process.platform as keyof typeof SYSTEM_PATHS];

  if (systemPath) {
    files.push(await probeFile(systemPath, 'settings', 'system'));
  }

  return files.filter(f => f.exists);
}

async function discoverUserLayer(homePath: string): Promise<ConfigFile[]> {
  const claudeDir = path.join(homePath, '.claude');
  const files: ConfigFile[] = [];

  // Memory files
  files.push(await probeFile(path.join(claudeDir, 'CLAUDE.md'), 'memory', 'user'));

  // Settings files
  files.push(await probeFile(path.join(homePath, '.claude.json'), 'settings', 'user'));
  files.push(await probeFile(path.join(claudeDir, 'settings.json'), 'settings', 'user'));

  // Commands
  const userCommands = await discoverDirectory(
    path.join(claudeDir, 'commands'),
    'command',
    'user',
    '.md'
  );
  files.push(...userCommands);

  // Skills
  const userSkills = await discoverSkills(path.join(claudeDir, 'skills'), 'user');
  files.push(...userSkills);

  // Agents
  const userAgents = await discoverDirectory(
    path.join(claudeDir, 'agents'),
    'agent',
    'user',
    '.md'
  );
  files.push(...userAgents);

  return files.filter(f => f.exists);
}

async function discoverProjectLayer(projectPath: string): Promise<ConfigFile[]> {
  const claudeDir = path.join(projectPath, '.claude');
  const files: ConfigFile[] = [];

  // Memory files
  files.push(await probeFile(path.join(projectPath, 'CLAUDE.md'), 'memory', 'project'));

  // Rules directory
  const rules = await discoverDirectory(
    path.join(claudeDir, 'rules'),
    'memory',
    'project',
    '.md'
  );
  files.push(...rules);

  // Settings
  files.push(await probeFile(path.join(claudeDir, 'settings.json'), 'settings', 'project'));

  // Commands
  const commands = await discoverDirectory(
    path.join(claudeDir, 'commands'),
    'command',
    'project',
    '.md'
  );
  files.push(...commands);

  // Skills
  const skills = await discoverSkills(path.join(claudeDir, 'skills'), 'project');
  files.push(...skills);

  // Agents
  const agents = await discoverDirectory(
    path.join(claudeDir, 'agents'),
    'agent',
    'project',
    '.md'
  );
  files.push(...agents);

  // Hooks (executables)
  const hooks = await discoverDirectory(
    path.join(claudeDir, 'hooks'),
    'hook',
    'project'
  );
  files.push(...hooks);

  // Environment files (presence only)
  files.push(await probeFile(path.join(projectPath, '.env'), 'env', 'project'));
  files.push(await probeFile(path.join(projectPath, '.env.local'), 'env', 'project'));

  return files.filter(f => f.exists);
}

async function discoverLocalLayer(projectPath: string): Promise<ConfigFile[]> {
  const claudeDir = path.join(projectPath, '.claude');
  const files: ConfigFile[] = [];

  // Local memory
  files.push(await probeFile(path.join(projectPath, 'CLAUDE.local.md'), 'memory', 'local'));

  // Local settings
  files.push(await probeFile(path.join(claudeDir, 'settings.local.json'), 'settings', 'local'));

  return files; // Include non-existent for "create" affordance
}

async function probeFile(
  filePath: string,
  type: ConfigFileType,
  layer: ConfigLayer
): Promise<ConfigFile> {
  try {
    const stats = await fs.stat(filePath);
    return {
      path: filePath,
      relativePath: filePath.replace(homedir(), '~'),
      type,
      layer,
      exists: true,
      size: stats.size,
      mtime: stats.mtimeMs,
      name: path.basename(filePath),
    };
  } catch {
    return {
      path: filePath,
      relativePath: filePath.replace(homedir(), '~'),
      type,
      layer,
      exists: false,
      name: path.basename(filePath),
    };
  }
}

async function discoverDirectory(
  dirPath: string,
  type: ConfigFileType,
  layer: ConfigLayer,
  extension?: string
): Promise<ConfigFile[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files: ConfigFile[] = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (extension && !entry.name.endsWith(extension)) continue;

      const filePath = path.join(dirPath, entry.name);
      files.push(await probeFile(filePath, type, layer));
    }

    return files;
  } catch {
    return [];
  }
}

async function discoverSkills(
  skillsDir: string,
  layer: ConfigLayer
): Promise<ConfigFile[]> {
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    const files: ConfigFile[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
      const file = await probeFile(skillMdPath, 'skill', layer);
      if (file.exists) {
        file.name = entry.name; // Use directory name as skill name
        files.push(file);
      }
    }

    return files;
  } catch {
    return [];
  }
}

function computeSummary(layers: ClaudeStack['layers']): ClaudeStack['summary'] {
  const all = [...layers.system, ...layers.user, ...layers.project, ...layers.local];

  return {
    memoryFiles: all.filter(f => f.type === 'memory').length,
    settingsFiles: all.filter(f => f.type === 'settings').length,
    commands: all.filter(f => f.type === 'command').length,
    skills: all.filter(f => f.type === 'skill').length,
    agents: all.filter(f => f.type === 'agent').length,
    hooks: all.filter(f => f.type === 'hook').length,
    mcpServers: 0, // Computed from parsed settings
    envFiles: all.filter(f => f.type === 'env').length,
  };
}
```

**Acceptance criteria**:
- [ ] Discovers all file types at all layers
- [ ] Handles missing directories gracefully
- [ ] Returns file metadata (size, mtime)
- [ ] Properly resolves ~ paths
- [ ] Works on macOS and Linux

---

### Task 1.3: Implement File Parsers

**File**: `src/lib/claude-config/parsers.ts`

```typescript
import * as fs from 'fs/promises';
import * as yaml from 'yaml';
import {
  ConfigFile,
  ConfigFileContent,
  CommandConfig,
  SkillConfig,
  SettingsConfig,
  HookConfig,
  MCPServerConfig
} from './types';

// Parse frontmatter from markdown files
function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  try {
    const frontmatter = yaml.parse(match[1]) || {};
    return { frontmatter, body: match[2].trim() };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

export async function readConfigFile(file: ConfigFile): Promise<ConfigFileContent> {
  // Don't read sensitive files
  if (file.type === 'env') {
    return {
      ...file,
      content: null,
      isSensitive: true,
      isEditable: false,
    };
  }

  try {
    const content = await fs.readFile(file.path, 'utf-8');
    const isEditable = file.layer !== 'system';

    // Parse based on file type
    if (file.type === 'settings' || file.path.endsWith('.json')) {
      return {
        ...file,
        content,
        parsed: { frontmatter: JSON.parse(content) },
        isEditable,
      };
    }

    if (file.path.endsWith('.md')) {
      const { frontmatter, body } = parseFrontmatter(content);
      return {
        ...file,
        content,
        parsed: { frontmatter, body },
        description: frontmatter.description as string | undefined,
        isEditable,
      };
    }

    // Hook scripts - just return content
    return {
      ...file,
      content,
      isEditable,
    };
  } catch (error) {
    return {
      ...file,
      content: null,
      isEditable: false,
    };
  }
}

export function parseCommand(file: ConfigFileContent): CommandConfig | null {
  if (!file.content || file.type !== 'command') return null;

  const { frontmatter, body } = parseFrontmatter(file.content);
  const name = file.name.replace(/\.md$/, '');

  return {
    name,
    path: file.path,
    layer: file.layer,
    description: frontmatter.description as string | undefined,
    argumentHint: frontmatter['argument-hint'] as string | undefined,
    allowedTools: frontmatter['allowed-tools'] as string[] | undefined,
    model: frontmatter.model as string | undefined,
    body: body || '',
  };
}

export function parseSkill(file: ConfigFileContent): SkillConfig | null {
  if (!file.content || file.type !== 'skill') return null;

  const { frontmatter } = parseFrontmatter(file.content);

  return {
    name: frontmatter.name as string || file.name,
    path: file.path,
    layer: file.layer,
    description: frontmatter.description as string | undefined,
    allowedTools: frontmatter['allowed-tools'] as string[] | undefined,
  };
}

export function parseSettings(file: ConfigFileContent): SettingsConfig | null {
  if (!file.content || file.type !== 'settings') return null;

  try {
    return JSON.parse(file.content) as SettingsConfig;
  } catch {
    return null;
  }
}

export function extractHooks(settings: SettingsConfig, source: string): HookConfig[] {
  const hooks: HookConfig[] = [];
  const rawHooks = settings.hooks as Record<string, Array<{ matcher: string; hooks: Array<{ command: string }> }>> | undefined;

  if (!rawHooks) return hooks;

  for (const [type, configs] of Object.entries(rawHooks)) {
    for (const config of configs) {
      for (const hook of config.hooks || []) {
        hooks.push({
          type: type as HookConfig['type'],
          matcher: config.matcher || '',
          command: hook.command,
          source,
        });
      }
    }
  }

  return hooks;
}

export function extractMCPServers(settings: SettingsConfig, source: string): MCPServerConfig[] {
  const servers: MCPServerConfig[] = [];
  const rawServers = settings.mcp?.servers as Record<string, { command: string; args?: string[]; env?: Record<string, string> }> | undefined;

  if (!rawServers) return servers;

  for (const [name, config] of Object.entries(rawServers)) {
    servers.push({
      name,
      command: config.command,
      args: config.args,
      env: config.env,
      source,
    });
  }

  return servers;
}
```

**Acceptance criteria**:
- [ ] Parses YAML frontmatter from markdown files
- [ ] Parses JSON settings files
- [ ] Extracts hooks from settings
- [ ] Extracts MCP servers from settings
- [ ] Handles malformed files gracefully

---

### Task 1.4: Implement File Writers

**File**: `src/lib/claude-config/writers.ts`

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import { ConfigFileSaveRequest, ConfigFileSaveResponse } from './types';

export async function saveConfigFile(
  request: ConfigFileSaveRequest
): Promise<ConfigFileSaveResponse> {
  try {
    // Security check: don't allow writing outside expected paths
    const normalizedPath = path.normalize(request.path);

    // Must be in ~/.claude/ or project .claude/ or be a CLAUDE.md file
    const isValidPath =
      normalizedPath.includes('.claude') ||
      normalizedPath.endsWith('CLAUDE.md') ||
      normalizedPath.endsWith('CLAUDE.local.md');

    if (!isValidPath) {
      return {
        success: false,
        error: 'Invalid path: must be a Claude configuration file',
      };
    }

    // Don't allow writing to system layer
    if (normalizedPath.includes('/Library/Application Support/ClaudeCode') ||
        normalizedPath.includes('/etc/claude-code') ||
        normalizedPath.includes('ProgramData\\ClaudeCode')) {
      return {
        success: false,
        error: 'Cannot write to system configuration',
      };
    }

    // Create parent directories if needed
    if (request.createDirectories) {
      await fs.mkdir(path.dirname(request.path), { recursive: true });
    }

    // Write the file
    await fs.writeFile(request.path, request.content, 'utf-8');

    // Get new mtime
    const stats = await fs.stat(request.path);

    return {
      success: true,
      mtime: stats.mtimeMs,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function deleteConfigFile(filePath: string): Promise<ConfigFileSaveResponse> {
  try {
    // Security checks similar to save
    const normalizedPath = path.normalize(filePath);

    const isValidPath =
      normalizedPath.includes('.claude') ||
      normalizedPath.endsWith('CLAUDE.md') ||
      normalizedPath.endsWith('CLAUDE.local.md');

    if (!isValidPath) {
      return {
        success: false,
        error: 'Invalid path: must be a Claude configuration file',
      };
    }

    await fs.unlink(filePath);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function createSkillDirectory(
  skillsDir: string,
  skillName: string,
  initialContent: string
): Promise<ConfigFileSaveResponse> {
  try {
    const skillDir = path.join(skillsDir, skillName);
    const skillMdPath = path.join(skillDir, 'SKILL.md');

    // Create directory
    await fs.mkdir(skillDir, { recursive: true });

    // Create SKILL.md
    await fs.writeFile(skillMdPath, initialContent, 'utf-8');

    const stats = await fs.stat(skillMdPath);

    return {
      success: true,
      mtime: stats.mtimeMs,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
```

**Acceptance criteria**:
- [ ] Writes files with proper encoding
- [ ] Creates parent directories when needed
- [ ] Validates paths for security
- [ ] Refuses to write to system layer
- [ ] Returns updated mtime

---

### Task 1.5: Create API Routes

**File**: `src/app/api/claude-stack/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { discoverStack } from '@/lib/claude-config/discovery';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get('scope');

  if (!scope) {
    return NextResponse.json(
      { error: 'scope parameter required' },
      { status: 400 }
    );
  }

  try {
    const stack = await discoverStack(scope);
    return NextResponse.json({ stack });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
```

**File**: `src/app/api/claude-stack/file/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { readConfigFile } from '@/lib/claude-config/parsers';
import { saveConfigFile, deleteConfigFile } from '@/lib/claude-config/writers';
import { discoverStack } from '@/lib/claude-config/discovery';

// GET - Read a specific file
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get('path');
  const scope = searchParams.get('scope');

  if (!filePath) {
    return NextResponse.json({ error: 'path parameter required' }, { status: 400 });
  }

  try {
    // Find the file in the stack to get its metadata
    const stack = scope ? await discoverStack(scope) : null;
    const allFiles = stack
      ? [...stack.layers.system, ...stack.layers.user, ...stack.layers.project, ...stack.layers.local]
      : [];

    const fileInfo = allFiles.find(f => f.path === filePath);

    if (!fileInfo) {
      // File not in stack, try to read it anyway if it's a valid claude file
      const { ConfigFile } = await import('@/lib/claude-config/types');
      const mockFile: typeof ConfigFile = {
        path: filePath,
        relativePath: filePath,
        type: 'memory',
        layer: 'project',
        exists: true,
        name: filePath.split('/').pop() || '',
      };
      const content = await readConfigFile(mockFile as any);
      return NextResponse.json({ file: content });
    }

    const content = await readConfigFile(fileInfo);
    return NextResponse.json({ file: content });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// PUT - Save a file
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { path, content, createDirectories } = body;

    if (!path || content === undefined) {
      return NextResponse.json(
        { error: 'path and content required' },
        { status: 400 }
      );
    }

    const result = await saveConfigFile({ path, content, createDirectories });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// DELETE - Delete a file
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get('path');

  if (!filePath) {
    return NextResponse.json({ error: 'path parameter required' }, { status: 400 });
  }

  try {
    const result = await deleteConfigFile(filePath);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
```

**Acceptance criteria**:
- [ ] GET /api/claude-stack returns full stack
- [ ] GET /api/claude-stack/file returns file content
- [ ] PUT /api/claude-stack/file saves file
- [ ] DELETE /api/claude-stack/file removes file
- [ ] Proper error handling and status codes

---

## Phase 2: Frontend Components

### Task 2.1: Create SWR Hook

**File**: `src/hooks/useClaudeStack.ts`

```typescript
"use client";

import useSWR from 'swr';
import { ClaudeStack, ConfigFile, ConfigFileContent } from '@/lib/claude-config/types';

const fetcher = (url: string) => fetch(url).then(res => res.json());

export function useClaudeStack(scopePath?: string) {
  const scopeParam = scopePath ? `?scope=${encodeURIComponent(scopePath)}` : '';

  const { data, error, isLoading, mutate } = useSWR<{ stack: ClaudeStack }>(
    scopePath ? `/api/claude-stack${scopeParam}` : null,
    fetcher,
    {
      refreshInterval: 10000, // Refresh every 10s
      revalidateOnFocus: true,
    }
  );

  return {
    stack: data?.stack ?? null,
    isLoading,
    isError: error,
    mutate,
  };
}

export function useConfigFile(filePath?: string, scopePath?: string) {
  const params = new URLSearchParams();
  if (filePath) params.set('path', filePath);
  if (scopePath) params.set('scope', scopePath);

  const { data, error, isLoading, mutate } = useSWR<{ file: ConfigFileContent }>(
    filePath ? `/api/claude-stack/file?${params}` : null,
    fetcher
  );

  const saveFile = async (content: string, createDirectories = false) => {
    if (!filePath) return { success: false, error: 'No file path' };

    const response = await fetch('/api/claude-stack/file', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content, createDirectories }),
    });

    const result = await response.json();
    if (result.success) {
      mutate();
    }
    return result;
  };

  const deleteFile = async () => {
    if (!filePath) return { success: false, error: 'No file path' };

    const response = await fetch(`/api/claude-stack/file?path=${encodeURIComponent(filePath)}`, {
      method: 'DELETE',
    });

    return response.json();
  };

  return {
    file: data?.file ?? null,
    isLoading,
    isError: error,
    mutate,
    saveFile,
    deleteFile,
  };
}
```

**Acceptance criteria**:
- [ ] Hook fetches stack data
- [ ] Hook supports file read/write
- [ ] Proper loading and error states
- [ ] Automatic revalidation

---

### Task 2.2: Add Stack to ViewToggle

**File**: Update `src/components/ViewToggle.tsx`

```typescript
"use client";

import { LayoutGrid, Network, FileText, Layers } from "lucide-react";

export type ViewMode = "tree" | "board" | "docs" | "stack";

interface ViewToggleProps {
  view: ViewMode;
  onChange: (view: ViewMode) => void;
}

export function ViewToggle({ view, onChange }: ViewToggleProps) {
  const views = [
    { id: "tree" as const, label: "Tree", icon: Network, title: "Tree view (folders as treemap)" },
    { id: "board" as const, label: "Board", icon: LayoutGrid, title: "Kanban board view" },
    { id: "docs" as const, label: "Docs", icon: FileText, title: "Documentation" },
    { id: "stack" as const, label: "Stack", icon: Layers, title: "Claude configuration stack" },
  ];

  return (
    <div className="flex items-center bg-[var(--bg-tertiary)] rounded-lg p-0.5">
      {views.map(({ id, label, icon: Icon, title }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`
            flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
            transition-colors
            ${
              view === id
                ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }
          `}
          title={title}
        >
          <Icon className="w-4 h-4" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
```

**Acceptance criteria**:
- [ ] Stack option appears in toggle
- [ ] Uses Layers icon
- [ ] Maintains existing view behavior

---

### Task 2.3: Create StackView Component

**File**: `src/components/stack/StackView.tsx`

```typescript
"use client";

import { useState } from "react";
import { useClaudeStack } from "@/hooks/useClaudeStack";
import { LayerPanel } from "./LayerPanel";
import { ConfigFileList } from "./ConfigFileList";
import { ConfigPreview } from "./ConfigPreview";
import { StackSummary } from "./StackSummary";
import type { ConfigLayer, ConfigFile } from "@/lib/claude-config/types";

interface StackViewProps {
  scopePath: string;
}

export function StackView({ scopePath }: StackViewProps) {
  const { stack, isLoading, isError } = useClaudeStack(scopePath);
  const [selectedLayer, setSelectedLayer] = useState<ConfigLayer>("project");
  const [selectedFile, setSelectedFile] = useState<ConfigFile | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[var(--text-secondary)]">Loading configuration...</div>
      </div>
    );
  }

  if (isError || !stack) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-500">Failed to load configuration</div>
      </div>
    );
  }

  const layerFiles = stack.layers[selectedLayer];

  return (
    <div className="flex h-full">
      {/* Left sidebar - Layer navigation + Summary */}
      <div className="w-48 border-r border-[var(--border-primary)] flex flex-col">
        <LayerPanel
          layers={stack.layers}
          selectedLayer={selectedLayer}
          onSelectLayer={(layer) => {
            setSelectedLayer(layer);
            setSelectedFile(null);
          }}
        />
        <div className="border-t border-[var(--border-primary)]">
          <StackSummary summary={stack.summary} />
        </div>
      </div>

      {/* Middle - File list */}
      <div className="w-64 border-r border-[var(--border-primary)] overflow-y-auto">
        <ConfigFileList
          files={layerFiles}
          layer={selectedLayer}
          selectedFile={selectedFile}
          onSelectFile={setSelectedFile}
          projectPath={stack.projectPath}
          homePath={stack.homePath}
        />
      </div>

      {/* Right - Preview/Editor */}
      <div className="flex-1 overflow-y-auto">
        {selectedFile ? (
          <ConfigPreview
            file={selectedFile}
            scopePath={scopePath}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-[var(--text-secondary)]">
            Select a file to preview
          </div>
        )}
      </div>
    </div>
  );
}
```

**Acceptance criteria**:
- [ ] Three-panel layout (layers, files, preview)
- [ ] Layer selection updates file list
- [ ] File selection shows preview
- [ ] Loading and error states

---

### Task 2.4: Create LayerPanel Component

**File**: `src/components/stack/LayerPanel.tsx`

```typescript
"use client";

import { Lock, User, Folder, FileEdit } from "lucide-react";
import type { ConfigFile, ConfigLayer, ClaudeStack } from "@/lib/claude-config/types";

interface LayerPanelProps {
  layers: ClaudeStack["layers"];
  selectedLayer: ConfigLayer;
  onSelectLayer: (layer: ConfigLayer) => void;
}

const LAYER_CONFIG = {
  system: { label: "System", icon: Lock, description: "Enterprise managed" },
  user: { label: "User", icon: User, description: "~/.claude/" },
  project: { label: "Project", icon: Folder, description: ".claude/" },
  local: { label: "Local", icon: FileEdit, description: "Personal overrides" },
} as const;

export function LayerPanel({ layers, selectedLayer, onSelectLayer }: LayerPanelProps) {
  return (
    <div className="p-3">
      <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
        Stack Layers
      </div>
      <div className="space-y-1">
        {(Object.keys(LAYER_CONFIG) as ConfigLayer[]).map((layer) => {
          const config = LAYER_CONFIG[layer];
          const Icon = config.icon;
          const fileCount = layers[layer].length;
          const existingCount = layers[layer].filter(f => f.exists).length;

          return (
            <button
              key={layer}
              onClick={() => onSelectLayer(layer)}
              className={`
                w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm
                transition-colors text-left
                ${
                  selectedLayer === layer
                    ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                }
              `}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium">{config.label}</div>
                <div className="text-xs text-[var(--text-tertiary)] truncate">
                  {config.description}
                </div>
              </div>
              {existingCount > 0 && (
                <span className="text-xs bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded">
                  {existingCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

---

### Task 2.5: Create ConfigFileList Component

**File**: `src/components/stack/ConfigFileList.tsx`

```typescript
"use client";

import {
  FileText, Settings, Terminal, Sparkles, Bot, Webhook, Server, Key,
  Plus, ChevronRight
} from "lucide-react";
import type { ConfigFile, ConfigFileType, ConfigLayer } from "@/lib/claude-config/types";

interface ConfigFileListProps {
  files: ConfigFile[];
  layer: ConfigLayer;
  selectedFile: ConfigFile | null;
  onSelectFile: (file: ConfigFile) => void;
  projectPath: string;
  homePath: string;
}

const TYPE_CONFIG: Record<ConfigFileType, { icon: typeof FileText; label: string; color: string }> = {
  memory: { icon: FileText, label: "Memory", color: "text-blue-500" },
  settings: { icon: Settings, label: "Settings", color: "text-purple-500" },
  command: { icon: Terminal, label: "Commands", color: "text-green-500" },
  skill: { icon: Sparkles, label: "Skills", color: "text-yellow-500" },
  agent: { icon: Bot, label: "Agents", color: "text-orange-500" },
  hook: { icon: Webhook, label: "Hooks", color: "text-red-500" },
  mcp: { icon: Server, label: "MCP", color: "text-cyan-500" },
  env: { icon: Key, label: "Environment", color: "text-gray-500" },
};

export function ConfigFileList({
  files,
  layer,
  selectedFile,
  onSelectFile,
  projectPath,
  homePath,
}: ConfigFileListProps) {
  // Group files by type
  const grouped = files.reduce((acc, file) => {
    if (!acc[file.type]) acc[file.type] = [];
    acc[file.type].push(file);
    return acc;
  }, {} as Record<ConfigFileType, ConfigFile[]>);

  const isEmpty = files.filter(f => f.exists).length === 0;

  if (isEmpty && layer !== 'local') {
    return (
      <div className="p-4 text-center text-[var(--text-secondary)] text-sm">
        No configuration files found in this layer
      </div>
    );
  }

  return (
    <div className="p-2">
      {(Object.keys(TYPE_CONFIG) as ConfigFileType[]).map((type) => {
        const typeFiles = grouped[type] || [];
        const existingFiles = typeFiles.filter(f => f.exists);
        const config = TYPE_CONFIG[type];
        const Icon = config.icon;

        // For local layer, show placeholders for missing files
        const showPlaceholders = layer === 'local' && typeFiles.some(f => !f.exists);

        if (existingFiles.length === 0 && !showPlaceholders) return null;

        return (
          <div key={type} className="mb-3">
            <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-[var(--text-secondary)] uppercase">
              <Icon className={`w-3.5 h-3.5 ${config.color}`} />
              {config.label}
            </div>
            <div className="space-y-0.5">
              {typeFiles.map((file) => (
                <button
                  key={file.path}
                  onClick={() => file.exists && onSelectFile(file)}
                  disabled={!file.exists}
                  className={`
                    w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left
                    transition-colors
                    ${!file.exists
                      ? "opacity-50 cursor-default"
                      : selectedFile?.path === file.path
                        ? "bg-[var(--accent-primary)] text-white"
                        : "hover:bg-[var(--bg-secondary)]"
                    }
                  `}
                >
                  <ChevronRight className="w-3 h-3 flex-shrink-0 opacity-50" />
                  <span className="truncate flex-1">{file.name}</span>
                  {!file.exists && (
                    <Plus className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                  )}
                  {file.size && (
                    <span className="text-xs text-[var(--text-tertiary)]">
                      {formatSize(file.size)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}
```

---

### Task 2.6: Create ConfigPreview Component

**File**: `src/components/stack/ConfigPreview.tsx`

```typescript
"use client";

import { useState } from "react";
import { useConfigFile } from "@/hooks/useClaudeStack";
import { Edit2, Save, X, Copy, Check } from "lucide-react";
import type { ConfigFile } from "@/lib/claude-config/types";

interface ConfigPreviewProps {
  file: ConfigFile;
  scopePath: string;
}

export function ConfigPreview({ file, scopePath }: ConfigPreviewProps) {
  const { file: fileContent, isLoading, saveFile } = useConfigFile(file.path, scopePath);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleEdit = () => {
    setEditContent(fileContent?.content || "");
    setIsEditing(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    const result = await saveFile(editContent);
    setIsSaving(false);
    if (result.success) {
      setIsEditing(false);
    }
  };

  const handleCopy = async () => {
    if (fileContent?.content) {
      await navigator.clipboard.writeText(fileContent.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[var(--text-secondary)]">Loading...</div>
      </div>
    );
  }

  if (!fileContent) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[var(--text-secondary)]">Failed to load file</div>
      </div>
    );
  }

  if (fileContent.isSensitive) {
    return (
      <div className="p-4">
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
          <div className="font-medium text-yellow-600">Sensitive File</div>
          <div className="text-sm text-[var(--text-secondary)] mt-1">
            This file may contain secrets and is not displayed for security.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-primary)]">
        <div>
          <div className="font-medium text-sm">{file.name}</div>
          <div className="text-xs text-[var(--text-secondary)]">{file.relativePath}</div>
        </div>
        <div className="flex items-center gap-2">
          {!isEditing && (
            <>
              <button
                onClick={handleCopy}
                className="p-1.5 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
                title="Copy content"
              >
                {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </button>
              {fileContent.isEditable && (
                <button
                  onClick={handleEdit}
                  className="flex items-center gap-1.5 px-2 py-1 rounded bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] text-sm"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  Edit
                </button>
              )}
            </>
          )}
          {isEditing && (
            <>
              <button
                onClick={() => setIsEditing(false)}
                className="p-1.5 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
              >
                <X className="w-4 h-4" />
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-1.5 px-2 py-1 rounded bg-[var(--accent-primary)] text-white text-sm disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {isSaving ? "Saving..." : "Save"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {isEditing ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full h-full font-mono text-sm bg-[var(--bg-secondary)] rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
            spellCheck={false}
          />
        ) : (
          <pre className="font-mono text-sm whitespace-pre-wrap break-words">
            {fileContent.content}
          </pre>
        )}
      </div>

      {/* Parsed info (for commands/skills) */}
      {fileContent.parsed?.frontmatter && !isEditing && (
        <div className="border-t border-[var(--border-primary)] p-4">
          <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase mb-2">
            Frontmatter
          </div>
          <div className="text-sm font-mono bg-[var(--bg-secondary)] rounded p-2">
            {JSON.stringify(fileContent.parsed.frontmatter, null, 2)}
          </div>
        </div>
      )}
    </div>
  );
}
```

---

### Task 2.7: Create StackSummary Component

**File**: `src/components/stack/StackSummary.tsx`

```typescript
"use client";

import { FileText, Terminal, Sparkles, Bot, Webhook, Server } from "lucide-react";
import type { ClaudeStack } from "@/lib/claude-config/types";

interface StackSummaryProps {
  summary: ClaudeStack["summary"];
}

export function StackSummary({ summary }: StackSummaryProps) {
  const items = [
    { icon: FileText, label: "Memory", count: summary.memoryFiles, color: "text-blue-500" },
    { icon: Terminal, label: "Commands", count: summary.commands, color: "text-green-500" },
    { icon: Sparkles, label: "Skills", count: summary.skills, color: "text-yellow-500" },
    { icon: Bot, label: "Agents", count: summary.agents, color: "text-orange-500" },
    { icon: Webhook, label: "Hooks", count: summary.hooks, color: "text-red-500" },
    { icon: Server, label: "MCP", count: summary.mcpServers, color: "text-cyan-500" },
  ];

  return (
    <div className="p-3">
      <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
        Summary
      </div>
      <div className="space-y-1">
        {items.map(({ icon: Icon, label, count, color }) => (
          <div key={label} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Icon className={`w-3.5 h-3.5 ${color}`} />
              <span className="text-[var(--text-secondary)]">{label}</span>
            </div>
            <span className="font-mono">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

### Task 2.8: Integrate StackView into Board

**File**: Update `src/components/Board.tsx`

Add conditional rendering for stack view alongside tree, board, and docs:

```typescript
// In Board.tsx, add import
import { StackView } from "./stack/StackView";

// In the main content rendering section, add:
{viewMode === "stack" && (
  <StackView scopePath={scopePath} />
)}
```

**Acceptance criteria**:
- [ ] Stack view renders when selected
- [ ] Passes scopePath correctly
- [ ] Maintains existing view switching behavior

---

## Phase 3: Polish & Testing

### Task 3.1: Add Create File Capability

For local layer, allow creating missing files (CLAUDE.local.md, settings.local.json).

### Task 3.2: Add Frontmatter-Aware Editor

For commands/skills, show structured editor for frontmatter + markdown body.

### Task 3.3: Add Validation

Validate JSON settings before save. Warn about invalid frontmatter.

### Task 3.4: Add Effective View

Show merged configuration from all layers (what Claude actually sees).

### Task 3.5: Write Tests

- Unit tests for discovery functions
- Unit tests for parsers
- Integration tests for API routes
- E2E tests for StackView

---

## File Checklist

### New Files to Create

```
src/lib/claude-config/
├── types.ts              # Task 1.1
├── discovery.ts          # Task 1.2
├── parsers.ts            # Task 1.3
├── writers.ts            # Task 1.4
└── index.ts              # Re-exports

src/app/api/claude-stack/
├── route.ts              # Task 1.5
└── file/
    └── route.ts          # Task 1.5

src/hooks/
└── useClaudeStack.ts     # Task 2.1

src/components/stack/
├── StackView.tsx         # Task 2.3
├── LayerPanel.tsx        # Task 2.4
├── ConfigFileList.tsx    # Task 2.5
├── ConfigPreview.tsx     # Task 2.6
├── StackSummary.tsx      # Task 2.7
└── index.ts              # Re-exports
```

### Files to Modify

```
src/components/ViewToggle.tsx    # Task 2.2 - Add "stack" option
src/components/Board.tsx         # Task 2.8 - Render StackView
src/lib/types.ts                 # Add claude-config type exports
```

---

## Dependencies

Install if not present:
```bash
npm install yaml  # For parsing YAML frontmatter
```

---

## Estimated Effort

| Phase | Tasks | Complexity |
|-------|-------|------------|
| Phase 1 | 1.1-1.5 | Medium - Core backend work |
| Phase 2 | 2.1-2.8 | Medium - UI components |
| Phase 3 | 3.1-3.5 | Low-Medium - Polish |

Total: ~20-30 focused implementation tasks across all phases.

---

*Created: 2026-01-09*
