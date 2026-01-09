# Command Feature: Implementation Plan

This document outlines the architecture and implementation plan for the **Command** feature - an AI-powered chat interface embedded in the sidebar that controls Hilt through natural language.

---

## Executive Summary

**Goal**: Add an always-visible command interface in the sidebar that uses Claude models to interpret natural language and execute actions in the app instantly.

**Key Characteristics**:
- **Location**: Dedicated section in sidebar, always visible (not a toggle)
- **Primary mode**: Input-driven (user dictates, AI executes)
- **Output**: Actions in the app (navigation, opening files, creating items) - NOT long text responses
- **Speed-first**: Defaults to Sonnet for low latency, with model selector for testing
- **Cross-scope**: Commands can affect any scope, not just current one

---

## User Experience Vision

```
┌──────────────────────────────────────────────────────────────┐
│  [Sidebar]                                                    │
│  ┌────────────────────┐                                       │
│  │  📌 Pinned         │                                       │
│  │  ├── hilt │                                       │
│  │  └── obsidian-plug │                                       │
│  └────────────────────┘                                       │
│                                                               │
│  ┌────────────────────┐                                       │
│  │  💬 Command        │                                       │
│  │  ┌──────────────┐  │                                       │
│  │  │ "open the    │  │  ← Input area (auto-expands)          │
│  │  │  session..." │  │                                       │
│  │  └──────────────┘  │                                       │
│  │  [⚡ Sonnet ▼]     │  ← Model selector (compact)           │
│  │                    │                                       │
│  │  ┌──────────────┐  │                                       │
│  │  │ Opened       │  │  ← Response area (collapsible)        │
│  │  │ session in   │  │                                       │
│  │  │ Terminal     │  │                                       │
│  │  └──────────────┘  │                                       │
│  └────────────────────┘                                       │
│                                                               │
│  [🌙] [◀]              │  ← Footer (theme + collapse)          │
└──────────────────────────────────────────────────────────────┘
```

### Interaction Flow

1. User speaks/types into Command input
2. AI parses intent, identifies action(s)
3. App executes action immediately (scope change, open session, create todo, etc.)
4. Brief confirmation appears in response area
5. Response area auto-collapses after 3 seconds (unless user interacts)

---

## Architecture

### 1. System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  CommandSection (Sidebar)                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  CommandInput                                              │  │
│  │  - Textarea with auto-resize                              │  │
│  │  - Submit on Enter (Shift+Enter for newline)              │  │
│  │  - Loading state indicator                                │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  ModelSelector                                             │  │
│  │  - Dropdown: Opus / Sonnet / Haiku                        │  │
│  │  - Persisted to preferences                               │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  CommandResponse                                           │  │
│  │  - Shows AI response (confirmation/clarification)         │  │
│  │  - Auto-collapse after timeout                            │  │
│  │  - Streaming text display                                 │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP POST /api/command
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  API Route: /api/command                                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  1. Build context (current scope, open sessions, etc.)    │  │
│  │  2. Build system prompt with available actions            │  │
│  │  3. Call Anthropic API with tool definitions              │  │
│  │  4. Stream response back to client                        │  │
│  │  5. Return structured action(s) to execute                │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Response: { actions: [...], message: "..." }
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  useCommand Hook (in Board.tsx)                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Receives action objects, dispatches to Board handlers:   │  │
│  │  - navigate → setScopePath()                              │  │
│  │  - openSession → handleOpenSession()                      │  │
│  │  - createInbox → handleCreateInboxItem()                  │  │
│  │  - toggleView → setViewMode()                             │  │
│  │  - toggleDrawer → setIsDrawerOpen()                       │  │
│  │  - ...etc                                                 │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Action Schema

The AI will respond with structured actions using tool calls. Each action maps directly to existing Board.tsx handlers.

```typescript
// src/lib/command-actions.ts

type CommandAction =
  | { type: "navigate"; path: string }
  | { type: "openSession"; sessionId: string }
  | { type: "closeSession"; sessionId: string }
  | { type: "createInbox"; prompt: string; scope?: string }
  | { type: "startInbox"; itemId: string }
  | { type: "deleteInbox"; itemId: string }
  | { type: "refineInbox"; itemId: string }
  | { type: "toggleView"; view: "board" | "tree" | "docs" }
  | { type: "toggleDrawer"; open: boolean }
  | { type: "toggleSidebar"; collapsed: boolean }
  | { type: "search"; query: string }
  | { type: "updateSessionStatus"; sessionId: string; status: "inbox" | "active" | "recent" }
  | { type: "starSession"; sessionId: string; starred: boolean }
  | { type: "archiveSession"; sessionId: string }
  | { type: "pinFolder"; path: string }
  | { type: "unpinFolder"; path: string }
  | { type: "setTheme"; theme: "dark" | "light" | "system" }
  | { type: "noop"; message: string }; // For clarifications/errors

interface CommandResponse {
  actions: CommandAction[];
  message?: string; // Brief confirmation or clarification
}
```

### 3. Tool Definitions for Claude

```typescript
// The AI receives these tool definitions in the system prompt

const commandTools = [
  {
    name: "navigate",
    description: "Navigate to a project folder (change scope)",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Full path to navigate to. Use fuzzy matching from available paths."
        }
      },
      required: ["path"]
    }
  },
  {
    name: "open_session",
    description: "Open a Claude session in the terminal drawer",
    input_schema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session UUID" },
        session_query: { type: "string", description: "Search query to find session by title/content" }
      }
    }
  },
  {
    name: "create_todo",
    description: "Add a new item to the To Do column (inbox)",
    input_schema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The todo item text" },
        scope: { type: "string", description: "Optional: project path (defaults to current scope)" }
      },
      required: ["prompt"]
    }
  },
  {
    name: "run_todo",
    description: "Start a Claude session from a todo item",
    input_schema: {
      type: "object",
      properties: {
        item_id: { type: "string" },
        item_query: { type: "string", description: "Search to find item by text" }
      }
    }
  },
  {
    name: "switch_view",
    description: "Switch between Board, Tree, and Docs views",
    input_schema: {
      type: "object",
      properties: {
        view: { type: "string", enum: ["board", "tree", "docs"] }
      },
      required: ["view"]
    }
  },
  {
    name: "toggle_terminal",
    description: "Show or hide the terminal drawer on the right",
    input_schema: {
      type: "object",
      properties: {
        open: { type: "boolean" }
      },
      required: ["open"]
    }
  },
  {
    name: "search_sessions",
    description: "Search for sessions across all projects",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" }
      },
      required: ["query"]
    }
  },
  {
    name: "move_session",
    description: "Move a session to a different column (status)",
    input_schema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        status: { type: "string", enum: ["inbox", "active", "recent"] }
      },
      required: ["session_id", "status"]
    }
  }
];
```

---

## Implementation Phases

### Phase 1: Infrastructure (Foundation)

**Goal**: Create the action dispatch system that any mechanism can use.

#### 1.1 Action Types & Executor

```typescript
// src/lib/command-actions.ts

import { z } from "zod";

export const CommandActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), path: z.string() }),
  z.object({ type: z.literal("openSession"), sessionId: z.string() }),
  z.object({ type: z.literal("closeSession"), sessionId: z.string() }),
  z.object({ type: z.literal("createInbox"), prompt: z.string(), scope: z.string().optional() }),
  z.object({ type: z.literal("startInbox"), itemId: z.string() }),
  z.object({ type: z.literal("deleteInbox"), itemId: z.string() }),
  z.object({ type: z.literal("toggleView"), view: z.enum(["board", "tree", "docs"]) }),
  z.object({ type: z.literal("toggleDrawer"), open: z.boolean() }),
  z.object({ type: z.literal("toggleSidebar"), collapsed: z.boolean() }),
  z.object({ type: z.literal("search"), query: z.string() }),
  z.object({ type: z.literal("updateSessionStatus"), sessionId: z.string(), status: z.enum(["inbox", "active", "recent"]) }),
  z.object({ type: z.literal("starSession"), sessionId: z.string(), starred: z.boolean() }),
  z.object({ type: z.literal("pinFolder"), path: z.string() }),
  z.object({ type: z.literal("unpinFolder"), path: z.string() }),
  z.object({ type: z.literal("setTheme"), theme: z.enum(["dark", "light", "system"]) }),
  z.object({ type: z.literal("noop"), message: z.string() }),
]);

export type CommandAction = z.infer<typeof CommandActionSchema>;
```

#### 1.2 Board Context Provider

Expose Board handlers via React Context so Command can dispatch actions from anywhere:

```typescript
// src/contexts/BoardActionsContext.tsx

interface BoardActionsContextValue {
  // Navigation
  setScopePath: (path: string) => void;
  setViewMode: (mode: "board" | "tree" | "docs") => void;
  setSearchQuery: (query: string) => void;

  // Sessions
  openSession: (session: Session) => void;
  closeSession: (sessionId: string) => void;
  updateSessionStatus: (sessionId: string, status: string) => void;
  toggleStarred: (sessionId: string) => void;
  archiveSession: (sessionId: string) => void;

  // Inbox
  createInboxItem: (prompt: string, scope?: string) => void;
  startInboxItem: (item: InboxItem) => void;
  deleteInboxItem: (itemId: string) => void;

  // UI State
  setIsDrawerOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setTheme: (theme: "dark" | "light" | "system") => void;

  // Read state (for AI context)
  getCurrentState: () => BoardState;
}
```

#### 1.3 Action Executor Hook

```typescript
// src/hooks/useCommandExecutor.ts

export function useCommandExecutor() {
  const boardActions = useBoardActions();
  const { sessions } = useSessions();
  const { items: inboxItems } = useInboxItems();

  const executeAction = useCallback(async (action: CommandAction): Promise<string> => {
    switch (action.type) {
      case "navigate":
        boardActions.setScopePath(action.path);
        return `Navigated to ${action.path}`;

      case "openSession":
        const session = sessions.find(s => s.id === action.sessionId);
        if (session) {
          boardActions.openSession(session);
          return `Opened session: ${session.title}`;
        }
        return `Session not found: ${action.sessionId}`;

      case "createInbox":
        boardActions.createInboxItem(action.prompt, action.scope);
        return `Created todo: "${action.prompt.slice(0, 50)}..."`;

      // ... other cases
    }
  }, [boardActions, sessions, inboxItems]);

  const executeActions = useCallback(async (actions: CommandAction[]): Promise<string[]> => {
    return Promise.all(actions.map(executeAction));
  }, [executeAction]);

  return { executeAction, executeActions };
}
```

### Phase 2: API Route & Claude Integration

#### 2.1 Command API Route

```typescript
// src/app/api/command/route.ts

import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

const anthropic = new Anthropic();

const MODEL_MAP = {
  opus: "claude-opus-4-5-20251101",
  sonnet: "claude-sonnet-4-5-20250929",
  haiku: "claude-haiku-3-5-20250929",
} as const;

export async function POST(request: NextRequest) {
  const { message, model = "sonnet", context } = await request.json();

  const systemPrompt = buildSystemPrompt(context);
  const tools = buildToolDefinitions();

  // Use streaming for responsive UX
  const stream = anthropic.messages.stream({
    model: MODEL_MAP[model as keyof typeof MODEL_MAP],
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: message }],
    tools,
  });

  // Return streaming response
  return new Response(
    new ReadableStream({
      async start(controller) {
        for await (const event of stream) {
          controller.enqueue(JSON.stringify(event) + "\n");
        }
        controller.close();
      }
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    }
  );
}

function buildSystemPrompt(context: BoardState): string {
  return `You are a command interface for Hilt, a project management app.

Your job is to interpret user commands and execute actions in the app.
Be fast and direct. Don't explain what you're doing - just do it.

## Current App State
- Current scope: ${context.scopePath}
- Current view: ${context.viewMode}
- Terminal drawer: ${context.isDrawerOpen ? "open" : "closed"}
- Open sessions: ${context.openSessions.map(s => s.title).join(", ") || "none"}

## Available Sessions (in current scope)
${context.sessions.map(s => `- [${s.id}] "${s.title}" (${s.status})`).join("\n")}

## Available Projects (pinned)
${context.pinnedFolders.map(f => `- ${f.path}`).join("\n")}

## Instructions
1. Parse the user's intent
2. Use the appropriate tool(s) to execute the action
3. If unclear, ask for clarification
4. Respond with a brief confirmation (1-2 sentences max)

Be aggressive about matching fuzzy queries. If user says "open the kanban session",
find the best match among available sessions.`;
}
```

#### 2.2 Environment Setup

```env
# .env.local
ANTHROPIC_API_KEY=sk-ant-...
```

### Phase 3: UI Components

#### 3.1 CommandSection Component

```typescript
// src/components/sidebar/CommandSection.tsx

"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { MessageSquare, Loader2 } from "lucide-react";
import { SidebarSection } from "./SidebarSection";
import { CommandInput } from "./CommandInput";
import { CommandResponse } from "./CommandResponse";
import { ModelSelector } from "./ModelSelector";
import { useCommand } from "@/hooks/useCommand";

interface CommandSectionProps {
  isCollapsed: boolean;
}

export function CommandSection({ isCollapsed }: CommandSectionProps) {
  const {
    sendCommand,
    isLoading,
    response,
    clearResponse,
    model,
    setModel
  } = useCommand();

  const handleSubmit = useCallback(async (message: string) => {
    if (!message.trim()) return;
    await sendCommand(message);
  }, [sendCommand]);

  // Auto-clear response after 5 seconds of inactivity
  useEffect(() => {
    if (response && !isLoading) {
      const timer = setTimeout(clearResponse, 5000);
      return () => clearTimeout(timer);
    }
  }, [response, isLoading, clearResponse]);

  if (isCollapsed) {
    return (
      <button
        className="w-full p-3 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
        title="Command"
      >
        <MessageSquare size={18} />
      </button>
    );
  }

  return (
    <SidebarSection
      title="Command"
      icon={MessageSquare}
      defaultExpanded={true}
      isCollapsed={isCollapsed}
    >
      <div className="px-2 space-y-2">
        <CommandInput
          onSubmit={handleSubmit}
          isLoading={isLoading}
          placeholder="Ask or command..."
        />

        <div className="flex items-center justify-between">
          <ModelSelector
            value={model}
            onChange={setModel}
            disabled={isLoading}
          />
          {isLoading && (
            <Loader2 size={14} className="animate-spin text-[var(--text-tertiary)]" />
          )}
        </div>

        {response && (
          <CommandResponse
            message={response}
            onDismiss={clearResponse}
          />
        )}
      </div>
    </SidebarSection>
  );
}
```

#### 3.2 CommandInput Component

```typescript
// src/components/sidebar/CommandInput.tsx

"use client";

import { useState, useRef, KeyboardEvent } from "react";
import { Send } from "lucide-react";

interface CommandInputProps {
  onSubmit: (message: string) => void;
  isLoading: boolean;
  placeholder?: string;
}

export function CommandInput({ onSubmit, isLoading, placeholder }: CommandInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !isLoading) {
        onSubmit(value);
        setValue("");
      }
    }
  };

  // Auto-resize textarea
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  };

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={isLoading}
        rows={1}
        className="w-full px-3 py-2 pr-9 text-sm bg-[var(--bg-primary)] border border-[var(--border-default)] rounded-md resize-none
                   text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]
                   focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)]
                   disabled:opacity-50 disabled:cursor-not-allowed"
      />
      <button
        onClick={() => {
          if (value.trim() && !isLoading) {
            onSubmit(value);
            setValue("");
          }
        }}
        disabled={!value.trim() || isLoading}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--text-tertiary)]
                   hover:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Send size={14} />
      </button>
    </div>
  );
}
```

#### 3.3 ModelSelector Component

```typescript
// src/components/sidebar/ModelSelector.tsx

"use client";

import { Zap, Brain, Sparkles } from "lucide-react";

type Model = "opus" | "sonnet" | "haiku";

interface ModelSelectorProps {
  value: Model;
  onChange: (model: Model) => void;
  disabled?: boolean;
}

const MODELS = [
  { id: "haiku" as const, label: "Haiku", icon: Zap, description: "Fastest" },
  { id: "sonnet" as const, label: "Sonnet", icon: Sparkles, description: "Balanced" },
  { id: "opus" as const, label: "Opus", icon: Brain, description: "Smartest" },
];

export function ModelSelector({ value, onChange, disabled }: ModelSelectorProps) {
  const currentModel = MODELS.find(m => m.id === value) || MODELS[1];
  const Icon = currentModel.icon;

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Model)}
      disabled={disabled}
      className="text-xs bg-transparent border border-[var(--border-subtle)] rounded px-2 py-1
                 text-[var(--text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)]
                 disabled:opacity-50"
    >
      {MODELS.map(model => (
        <option key={model.id} value={model.id}>
          {model.label}
        </option>
      ))}
    </select>
  );
}
```

#### 3.4 CommandResponse Component

```typescript
// src/components/sidebar/CommandResponse.tsx

"use client";

import { X, CheckCircle, AlertCircle } from "lucide-react";

interface CommandResponseProps {
  message: string;
  isError?: boolean;
  onDismiss: () => void;
}

export function CommandResponse({ message, isError, onDismiss }: CommandResponseProps) {
  const Icon = isError ? AlertCircle : CheckCircle;
  const colorClass = isError
    ? "text-red-400 bg-red-500/10 border-red-500/20"
    : "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";

  return (
    <div className={`relative p-2 text-xs rounded border ${colorClass}`}>
      <div className="flex items-start gap-2">
        <Icon size={14} className="flex-shrink-0 mt-0.5" />
        <p className="text-[var(--text-secondary)] flex-1">{message}</p>
        <button
          onClick={onDismiss}
          className="flex-shrink-0 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
```

### Phase 4: Hook & State Management

#### 4.1 useCommand Hook

```typescript
// src/hooks/useCommand.ts

"use client";

import { useState, useCallback } from "react";
import useSWR from "swr";
import { useCommandExecutor } from "./useCommandExecutor";
import { useBoardActions } from "@/contexts/BoardActionsContext";
import { CommandAction } from "@/lib/command-actions";

type Model = "opus" | "sonnet" | "haiku";

interface UseCommandReturn {
  sendCommand: (message: string) => Promise<void>;
  isLoading: boolean;
  response: string | null;
  clearResponse: () => void;
  model: Model;
  setModel: (model: Model) => void;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}

export function useCommand(): UseCommandReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);

  // Persist model preference
  const { data: modelData, mutate: setModelData } = useSWR<{ value: Model }>(
    "/api/preferences?key=commandModel",
    (url) => fetch(url).then(r => r.json()).catch(() => ({ value: "sonnet" })),
    { fallbackData: { value: "sonnet" } }
  );
  const model = modelData?.value ?? "sonnet";

  const setModel = useCallback((newModel: Model) => {
    setModelData({ value: newModel }, false);
    fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "commandModel", value: newModel }),
    });
  }, [setModelData]);

  const { executeActions } = useCommandExecutor();
  const boardActions = useBoardActions();

  const sendCommand = useCallback(async (message: string) => {
    setIsLoading(true);
    setResponse(null);

    try {
      // Build context for the AI
      const context = boardActions.getCurrentState();

      const res = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, model, context }),
      });

      if (!res.ok) throw new Error("Command failed");

      // Parse streaming response
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let actions: CommandAction[] = [];
      let responseMessage = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter(Boolean);

        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            // Handle different event types from Claude API
            if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
              responseMessage += event.delta.text;
            }
            if (event.type === "content_block_delta" && event.delta?.type === "tool_use") {
              // Collect tool calls as actions
              actions.push(parseToolCall(event.delta));
            }
          } catch {
            // Skip malformed lines
          }
        }
      }

      // Execute all actions
      if (actions.length > 0) {
        const results = await executeActions(actions);
        setResponse(results.join(". "));
      } else if (responseMessage) {
        setResponse(responseMessage);
      }

      // Update history
      setHistory(prev => [
        ...prev,
        { role: "user", content: message },
        { role: "assistant", content: responseMessage || actions.map(a => a.type).join(", ") },
      ]);

    } catch (error) {
      setResponse(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsLoading(false);
    }
  }, [model, boardActions, executeActions]);

  const clearResponse = useCallback(() => setResponse(null), []);

  return {
    sendCommand,
    isLoading,
    response,
    clearResponse,
    model,
    setModel,
    history,
  };
}
```

---

## File Structure

```
src/
├── app/
│   └── api/
│       └── command/
│           └── route.ts          # Claude API integration
├── components/
│   └── sidebar/
│       ├── Sidebar.tsx           # Update to include CommandSection
│       ├── CommandSection.tsx    # Main command UI container
│       ├── CommandInput.tsx      # Input textarea
│       ├── CommandResponse.tsx   # Response display
│       └── ModelSelector.tsx     # Model dropdown
├── contexts/
│   └── BoardActionsContext.tsx   # Expose Board handlers
├── hooks/
│   ├── useCommand.ts             # Command state & API calls
│   └── useCommandExecutor.ts     # Action dispatcher
└── lib/
    └── command-actions.ts        # Action types & schemas
```

---

## Preferences Storage

Add new preference keys to the existing preferences system:

```typescript
// In db.ts, add:

export async function getCommandModel(): Promise<"opus" | "sonnet" | "haiku"> {
  const prefs = await loadPreferences();
  return prefs.commandModel ?? "sonnet";
}

export async function setCommandModel(model: "opus" | "sonnet" | "haiku"): Promise<void> {
  const prefs = await loadPreferences();
  prefs.commandModel = model;
  await savePreferences(prefs);
}

// In preferences/route.ts, add cases:
case "commandModel":
  return NextResponse.json({ value: await getCommandModel() });

// In PATCH handler:
case "commandModel":
  await setCommandModel(value);
  return NextResponse.json({ success: true });
```

---

## Security Considerations

1. **API Key**: Store `ANTHROPIC_API_KEY` in `.env.local`, never commit
2. **Rate Limiting**: Consider adding rate limiting to `/api/command`
3. **Input Validation**: Validate all action parameters with Zod before execution
4. **Scope Restrictions**: Actions should only affect user-accessible paths

---

## Testing Plan

### Unit Tests
- [ ] CommandAction schema validation
- [ ] Action executor for each action type
- [ ] Model selector persistence

### Integration Tests
- [ ] Full command flow: input → API → action execution
- [ ] Streaming response handling
- [ ] Error handling for API failures

### Manual Testing
- [ ] Navigate to different scopes via voice command
- [ ] Open sessions by title search
- [ ] Create todos via dictation
- [ ] Switch views
- [ ] Test all three models for latency comparison

---

## Open Questions

1. **Conversation History**: Should commands have context from previous commands in the same session? (Current plan: Yes, but limited window)

2. **Keyboard Shortcut**: Should there be a global shortcut to focus the command input? (Suggestion: Cmd+K)

3. **Audio Input**: Future feature - direct microphone input with Whisper transcription?

4. **Offline Mode**: What happens when Anthropic API is unavailable? (Suggestion: Show error, disable input)

---

## Dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0"
  }
}
```

---

## Estimated Effort

| Phase | Description | Complexity |
|-------|-------------|------------|
| 1 | Infrastructure (actions, context, executor) | Medium |
| 2 | API Route & Claude Integration | Medium |
| 3 | UI Components | Low |
| 4 | Hooks & State | Medium |
| **Total** | | ~4-6 hours |

---

*Document created: 2025-01-07*
