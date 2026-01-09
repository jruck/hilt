/**
 * Session Status Derivation
 *
 * Analyzes JSONL entries to derive real-time session state.
 * Detects:
 * - working: Claude is actively processing (user just sent a prompt)
 * - waiting_for_approval: Claude used a tool and is waiting for approval
 * - waiting_for_input: Claude finished responding, waiting for user input
 * - idle: No activity for 5+ minutes
 */

import type { DerivedSessionState, DerivedStatus, PendingToolUse } from "./types";

// Idle threshold: 5 minutes of no activity
const IDLE_THRESHOLD_MS = 5 * 60 * 1000;

// Content block types we care about
interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
}

interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
}

interface TextBlock {
  type: "text";
  text: string;
}

type ContentBlock = ToolUseBlock | ToolResultBlock | TextBlock | { type: string };

// Entry types from JSONL
interface UserEntry {
  type: "user";
  timestamp?: string;
  message?: {
    content: string | ContentBlock[];
  };
}

interface AssistantEntry {
  type: "assistant";
  timestamp?: string;
  message?: {
    content?: ContentBlock[];
  };
}

interface SystemEntry {
  type: string; // "system", "turn_duration", "stop_hook_summary", etc.
  timestamp?: string;
  subtype?: string;
}

type JournalEntry = UserEntry | AssistantEntry | SystemEntry | { type: string; timestamp?: string };

/**
 * Check if an entry is a user entry
 */
function isUserEntry(entry: JournalEntry): entry is UserEntry {
  return entry.type === "user";
}

/**
 * Check if an entry is an assistant entry
 */
function isAssistantEntry(entry: JournalEntry): entry is AssistantEntry {
  return entry.type === "assistant";
}

/**
 * Check if an entry is a system entry that indicates turn end
 */
function isTurnEndEntry(entry: JournalEntry): boolean {
  return entry.type === "turn_duration" || entry.type === "stop_hook_summary";
}

/**
 * Parse timestamp from entry (ISO string or number)
 */
function parseTimestamp(entry: JournalEntry): number {
  if (!entry.timestamp) return 0;
  if (typeof entry.timestamp === "number") return entry.timestamp;
  const ts = new Date(entry.timestamp).getTime();
  return isNaN(ts) ? 0 : ts;
}

/**
 * Extract text content from a message
 */
function extractTextFromMessage(content: string | ContentBlock[] | undefined): string | null {
  if (!content) return null;

  if (typeof content === "string") {
    // Skip system-injected messages
    if (content.startsWith("Caveat: ") ||
        content.startsWith("<command-name>") ||
        content.startsWith("<local-command-stdout>") ||
        content.startsWith("<system-reminder>")) {
      return null;
    }
    return content.slice(0, 200);
  }

  if (Array.isArray(content)) {
    // Find the first text block
    for (const block of content) {
      if (block.type === "text" && "text" in block) {
        const text = (block as TextBlock).text;
        // Skip system-injected messages
        if (text.startsWith("Caveat: ") ||
            text.startsWith("<command-name>") ||
            text.startsWith("<local-command-stdout>") ||
            text.startsWith("<system-reminder>")) {
          continue;
        }
        return text.slice(0, 200);
      }
    }
  }

  return null;
}

/**
 * Derive session state from JSONL entries
 *
 * Algorithm:
 * 1. Track all tool_use blocks, remove when matching tool_result received
 * 2. Track last entry type (user, assistant, system)
 * 3. Track last activity time
 * 4. Track last message text (user or assistant)
 * 5. Derive status:
 *    - idle: No activity for 5+ minutes (takes precedence)
 *    - waiting_for_approval: Has pending tool_use blocks
 *    - waiting_for_input: Last entry was assistant or turn-end system entry
 *    - working: Last entry was user (Claude is processing)
 */
export function deriveSessionState(entries: JournalEntry[]): DerivedSessionState {
  const pendingToolUses: PendingToolUse[] = [];
  let lastActivityTime = 0;
  let lastEntryType: "user" | "assistant" | "system" | null = null;
  let lastMessage: string | null = null;

  for (const entry of entries) {
    // Track last activity time
    const timestamp = parseTimestamp(entry);
    if (timestamp > 0) {
      lastActivityTime = Math.max(lastActivityTime, timestamp);
    }

    if (isUserEntry(entry)) {
      lastEntryType = "user";

      // Extract user message text
      const text = extractTextFromMessage(entry.message?.content);
      if (text) {
        lastMessage = text;
      }

      // Check for tool_result blocks that clear pending tools
      const content = entry.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_result" && "tool_use_id" in block) {
            const idx = pendingToolUses.findIndex((t) => t.id === block.tool_use_id);
            if (idx !== -1) {
              pendingToolUses.splice(idx, 1);
            }
          }
        }
      }
    } else if (isAssistantEntry(entry)) {
      lastEntryType = "assistant";

      // Extract assistant message text
      const content = entry.message?.content;
      if (Array.isArray(content)) {
        // Find text blocks for lastMessage
        for (const block of content) {
          if (block.type === "text" && "text" in block) {
            lastMessage = (block as TextBlock).text.slice(0, 200);
            break;
          }
        }

        // Check for tool_use blocks that add to pending
        for (const block of content) {
          if (block.type === "tool_use" && "id" in block && "name" in block) {
            pendingToolUses.push({
              id: (block as ToolUseBlock).id,
              name: (block as ToolUseBlock).name,
            });
          }
        }
      }
    } else if (isTurnEndEntry(entry)) {
      lastEntryType = "system";
      // Note: We do NOT clear pendingToolUses here.
      // turn_duration marks the end of Claude's turn, but if Claude proposed
      // tool_use blocks, the user hasn't approved them yet. Only tool_result
      // entries (in user messages) should clear pending tools.
    }
  }

  // Determine status - always track the underlying state, isIdle is separate
  const now = Date.now();
  const isIdle = lastActivityTime > 0 && now - lastActivityTime > IDLE_THRESHOLD_MS;

  let status: DerivedStatus;
  if (pendingToolUses.length > 0) {
    status = "waiting_for_approval";
  } else if (lastEntryType === "assistant" || lastEntryType === "system") {
    status = "waiting_for_input";
  } else if (lastEntryType === "user") {
    status = "working";
  } else {
    // Empty or unknown state - default to idle
    status = "idle";
  }

  // isRunning is true when actively working or waiting for approval (and not idle)
  const isRunning = !isIdle && (status === "working" || status === "waiting_for_approval");

  return {
    status,
    pendingToolUses: [...pendingToolUses], // Return copy
    lastActivityTime,
    isRunning,
    isIdle,
    lastMessage,
  };
}

/**
 * Parse JSONL content into entries
 * Handles malformed lines gracefully
 */
export function parseJSONLEntries(content: string): JournalEntry[] {
  const entries: JournalEntry[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const entry = JSON.parse(trimmed);
      if (entry && typeof entry.type === "string") {
        entries.push(entry);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

/**
 * Parse JSONL content from a specific byte offset
 * Returns new entries and the new byte offset
 */
export function parseJSONLFromOffset(
  content: string,
  startOffset: number
): { entries: JournalEntry[]; newOffset: number } {
  const entries: JournalEntry[] = [];

  // Start from offset
  let pos = startOffset;

  // If starting mid-file, find the start of the next complete line
  if (pos > 0 && pos < content.length) {
    const nextNewline = content.indexOf("\n", pos);
    if (nextNewline === -1) {
      // No complete line remaining
      return { entries: [], newOffset: pos };
    }
    pos = nextNewline + 1;
  }

  // Parse remaining lines
  while (pos < content.length) {
    const lineEnd = content.indexOf("\n", pos);
    const line = lineEnd === -1 ? content.slice(pos) : content.slice(pos, lineEnd);
    const trimmed = line.trim();

    if (trimmed) {
      try {
        const entry = JSON.parse(trimmed);
        if (entry && typeof entry.type === "string") {
          entries.push(entry);
        }
      } catch {
        // Skip malformed lines
      }
    }

    pos = lineEnd === -1 ? content.length : lineEnd + 1;
  }

  return { entries, newOffset: content.length };
}

/**
 * Check if a derived status indicates the session needs urgent user attention
 * (only tool approval - waiting for input is normal end state)
 */
export function needsAttention(status: DerivedStatus): boolean {
  return status === "waiting_for_approval";
}
