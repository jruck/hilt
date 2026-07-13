// Chat v1 — content-anchored Claude CLI chats.
// See docs/plans/chat-v1-implementation-plan.md. Sessions are app state under
// DATA_DIR/chat-sessions/, never vault markdown; the Claude CLI owns conversational
// memory via --resume, Hilt only persists the transcript it rendered.

export type ChatContextRef =
  | { kind: "library"; id: string }
  | { kind: "doc"; path: string } // absolute path
  | { kind: "person"; slug: string }
  | { kind: "task"; id: string } // v3 task file id (t-...)
  | { kind: "meeting"; path: string } // vault-relative meeting note path
  | { kind: "loop-item"; loop: string; itemId: string }
  | { kind: "briefing-line"; date: string; anchor: string }
  | { kind: "none" };

export type ChatContextKind = ChatContextRef["kind"];

export type ChatTraceEventType = "step" | "tool_call" | "tool_result" | "warning";
export type ChatTraceEventStatus = "running" | "complete" | "warning" | "error";

export interface ChatTraceEvent {
  id: string;
  type: ChatTraceEventType;
  status: ChatTraceEventStatus;
  label: string;
  detail?: string | null;
  toolName?: string | null;
  /** Summarized via summarizeToolInput — full tool inputs are never persisted. */
  input?: Record<string, unknown> | null;
  outputSummary?: string | null;
  timestamp: number;
  durationMs?: number | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string; // markdown
  timestamp: number;
  trace?: ChatTraceEvent[]; // on assistant messages
  filesTouched?: string[]; // vault-relative paths from Edit/Write/MultiEdit calls
}

export type ChatStatus = "idle" | "sending";

export interface ChatSession {
  id: string; // crypto.randomUUID()
  context: ChatContextRef;
  contextLabel: string; // e.g. artifact title — shown as subtitle
  title: string; // deterministic from first prompt; renamable
  claudeSessionId: string | null;
  messages: ChatMessage[];
  status: ChatStatus;
  archivedAt: number | null;
  unreadCount: number;
  createdAt: number;
  updatedAt: number;
}

/** Row shape returned by GET /api/chat/sessions. */
export interface ChatSessionSummary {
  id: string;
  context: ChatContextRef;
  contextLabel: string;
  title: string;
  status: ChatStatus;
  archivedAt: number | null;
  unreadCount: number;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  lastMessageSnippet: string | null; // ≤120 chars
}

/** NDJSON events streamed by POST /api/chat/message. */
export type ChatStreamEvent =
  | { type: "session"; chatId: string } // always first event
  | { type: "trace"; trace: ChatTraceEvent }
  | { type: "message"; content: string } // assistant text delta; clients append in order
  | { type: "complete"; claudeSessionId: string | null }
  | { type: "error"; error: string };

export interface ChatMessageRequest {
  chatId?: string;
  context?: ChatContextRef;
  prompt: string;
}

/** Title from the first prompt: first 7 words, max 58 chars (Loft deterministicTitle). */
export function deterministicTitle(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").replace(/[^\w\s/.-]/g, "").trim();
  if (!normalized) return "New chat";
  const title = normalized.split(" ").slice(0, 7).join(" ");
  return title.length > 58 ? `${title.slice(0, 55).trim()}...` : title;
}
