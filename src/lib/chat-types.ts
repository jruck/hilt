// === Connection ===

export interface GatewayConfig {
  url: string;           // ws://localhost:18789/ws
  token: string;         // Bearer auth token
  sessionKey?: string;   // x-openclaw-session-key for session continuity
  agent?: string;        // Target agent label (e.g., "engineering")
}

export type ConnectionState = "disconnected" | "connecting" | "authenticating" | "connected" | "error";

// === Messages ===

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  runId?: string;
  streaming?: boolean;     // true while assistant is still generating
  toolCalls?: ToolCall[];  // Phase 3
  injected?: boolean;      // true for voice transcript injections
}

export interface InjectMessage {
  role: "user" | "assistant";
  content: string;
  injected: true;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  status: "executing" | "success" | "error";
}

// === Events ===

export type GatewayEventMap = {
  "state-change": ConnectionState;
  "message": ChatMessage;
  "message-delta": { id: string; delta: string };  // streaming token
  "message-complete": { id: string };
  "error": { code: string; message: string };
  "run-start": { runId: string };
  "run-end": { runId: string };
};

// === Sidecar ===

export type SidecarState = "stopped" | "starting" | "running" | "error";

export interface SidecarConfig {
  pythonPath?: string;     // Default: from PATH or venv
  projectPath: string;     // Path to voice-conversation project
  port?: number;           // Default: 8765
  gatewayUrl: string;      // OpenClaw gateway URL for LLM routing
  gatewayToken: string;
  sessionKey: string;       // Shared with text chat
}

// === Agents ===

export interface Agent {
  label: string;           // e.g., "engineering"
  displayName?: string;
  status: "online" | "offline" | "busy";
  model?: string;
}
