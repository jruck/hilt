// Chat v1 — content-anchored Claude CLI chats.
// See docs/plans/chat-v1-implementation-plan.md.

export type ChatContextRef =
  | { kind: "library"; id: string }
  | { kind: "doc"; path: string } // absolute path
  | { kind: "person"; slug: string }
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
  lastMessageSnippet: string | null;
}

/** NDJSON events streamed by POST /api/chat/message. */
export type ChatStreamEvent =
  | { type: "session"; chatId: string } // always first event
  | { type: "trace"; trace: ChatTraceEvent }
  | { type: "message"; content: string } // per assistant text block, as parsed
  | { type: "complete"; claudeSessionId: string | null }
  | { type: "error"; error: string };

export interface ChatMessageRequest {
  chatId?: string;
  context?: ChatContextRef;
  prompt: string;
}

/** Title from the first prompt: first 7 words, max 58 chars (Loft deterministicTitle). */
export function deterministicTitle(prompt: string): string {
  const normalized = prompt
    .replace(/[`*_#>\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "New chat";
  const words = normalized.split(" ").slice(0, 7).join(" ");
  return words.length > 58 ? `${words.slice(0, 55)}...` : words;
}
