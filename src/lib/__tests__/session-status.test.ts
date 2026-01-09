/**
 * Session Status Unit Tests
 *
 * Tests for deriveSessionState and parseJSONLEntries functions.
 * To run: npm install -D vitest && npx vitest
 */

import { describe, it, expect } from "vitest";
import {
  deriveSessionState,
  parseJSONLEntries,
  parseJSONLFromOffset,
} from "../session-status";

describe("parseJSONLEntries", () => {
  it("parses valid JSONL content", () => {
    const content = `{"type":"user","timestamp":"2024-01-01T12:00:00Z"}
{"type":"assistant","timestamp":"2024-01-01T12:00:01Z"}`;

    const entries = parseJSONLEntries(content);
    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe("user");
    expect(entries[1].type).toBe("assistant");
  });

  it("handles empty lines", () => {
    const content = `{"type":"user"}

{"type":"assistant"}
`;
    const entries = parseJSONLEntries(content);
    expect(entries).toHaveLength(2);
  });

  it("skips malformed lines", () => {
    const content = `{"type":"user"}
not valid json
{"type":"assistant"}`;

    const entries = parseJSONLEntries(content);
    expect(entries).toHaveLength(2);
  });

  it("skips entries without type field", () => {
    const content = `{"type":"user"}
{"notType":"something"}
{"type":"assistant"}`;

    const entries = parseJSONLEntries(content);
    expect(entries).toHaveLength(2);
  });

  it("returns empty array for empty content", () => {
    expect(parseJSONLEntries("")).toHaveLength(0);
    expect(parseJSONLEntries("\n\n")).toHaveLength(0);
  });
});

describe("parseJSONLFromOffset", () => {
  it("parses from beginning when offset is 0", () => {
    const content = `{"type":"user"}
{"type":"assistant"}`;

    const result = parseJSONLFromOffset(content, 0);
    expect(result.entries).toHaveLength(2);
    expect(result.newOffset).toBe(content.length);
  });

  it("parses from mid-file offset", () => {
    const content = `{"type":"user"}
{"type":"assistant"}`;
    const offset = 10; // Mid-first line

    const result = parseJSONLFromOffset(content, offset);
    // Should skip to next complete line
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].type).toBe("assistant");
  });

  it("returns empty for offset at end of file", () => {
    const content = `{"type":"user"}`;
    const result = parseJSONLFromOffset(content, content.length);
    expect(result.entries).toHaveLength(0);
  });
});

describe("deriveSessionState", () => {
  const now = Date.now();
  const recentTimestamp = new Date(now - 1000).toISOString(); // 1 second ago
  const oldTimestamp = new Date(now - 10 * 60 * 1000).toISOString(); // 10 minutes ago

  describe("status: working", () => {
    it("returns working when last entry is user message", () => {
      const entries = [
        { type: "user", timestamp: recentTimestamp, message: { content: "Hello" } },
      ];

      const state = deriveSessionState(entries);
      expect(state.status).toBe("working");
      expect(state.isRunning).toBe(true);
    });

    it("returns working after user provides tool results", () => {
      const entries = [
        { type: "assistant", timestamp: recentTimestamp, message: { content: [
          { type: "tool_use", id: "tool1", name: "Read" },
        ]}},
        { type: "user", timestamp: recentTimestamp, message: { content: [
          { type: "tool_result", tool_use_id: "tool1" },
        ]}},
      ];

      const state = deriveSessionState(entries);
      expect(state.status).toBe("working");
      expect(state.pendingToolUses).toHaveLength(0);
    });
  });

  describe("status: waiting_for_approval", () => {
    it("returns waiting_for_approval when assistant has pending tool uses", () => {
      const entries = [
        { type: "user", timestamp: recentTimestamp, message: { content: "Run a command" } },
        { type: "assistant", timestamp: recentTimestamp, message: { content: [
          { type: "text", text: "Let me run that." },
          { type: "tool_use", id: "tool1", name: "Bash" },
        ]}},
      ];

      const state = deriveSessionState(entries);
      expect(state.status).toBe("waiting_for_approval");
      expect(state.pendingToolUses).toHaveLength(1);
      expect(state.pendingToolUses[0].name).toBe("Bash");
      expect(state.isRunning).toBe(true);
    });

    it("tracks multiple pending tool uses", () => {
      const entries = [
        { type: "assistant", timestamp: recentTimestamp, message: { content: [
          { type: "tool_use", id: "tool1", name: "Read" },
          { type: "tool_use", id: "tool2", name: "Write" },
        ]}},
      ];

      const state = deriveSessionState(entries);
      expect(state.status).toBe("waiting_for_approval");
      expect(state.pendingToolUses).toHaveLength(2);
    });

    it("clears tool use when result is received", () => {
      const entries = [
        { type: "assistant", timestamp: recentTimestamp, message: { content: [
          { type: "tool_use", id: "tool1", name: "Read" },
          { type: "tool_use", id: "tool2", name: "Write" },
        ]}},
        { type: "user", timestamp: recentTimestamp, message: { content: [
          { type: "tool_result", tool_use_id: "tool1" },
        ]}},
      ];

      const state = deriveSessionState(entries);
      expect(state.pendingToolUses).toHaveLength(1);
      expect(state.pendingToolUses[0].id).toBe("tool2");
    });
  });

  describe("status: waiting_for_input", () => {
    it("returns waiting_for_input when last entry is assistant without tool use", () => {
      const entries = [
        { type: "user", timestamp: recentTimestamp, message: { content: "Hello" } },
        { type: "assistant", timestamp: recentTimestamp, message: { content: [
          { type: "text", text: "Hello! How can I help?" },
        ]}},
      ];

      const state = deriveSessionState(entries);
      expect(state.status).toBe("waiting_for_input");
      expect(state.isRunning).toBe(false);
    });

    it("returns waiting_for_input after turn_duration entry", () => {
      const entries = [
        { type: "assistant", timestamp: recentTimestamp, message: { content: [
          { type: "tool_use", id: "tool1", name: "Read" },
        ]}},
        { type: "user", timestamp: recentTimestamp, message: { content: [
          { type: "tool_result", tool_use_id: "tool1" },
        ]}},
        { type: "turn_duration", timestamp: recentTimestamp },
      ];

      const state = deriveSessionState(entries);
      expect(state.status).toBe("waiting_for_input");
      // Turn end clears pending tools
      expect(state.pendingToolUses).toHaveLength(0);
    });

    it("returns waiting_for_input after stop_hook_summary entry", () => {
      const entries = [
        { type: "assistant", timestamp: recentTimestamp },
        { type: "stop_hook_summary", timestamp: recentTimestamp },
      ];

      const state = deriveSessionState(entries);
      expect(state.status).toBe("waiting_for_input");
    });
  });

  describe("status: idle", () => {
    it("returns idle when no activity for 5+ minutes", () => {
      const entries = [
        { type: "user", timestamp: oldTimestamp, message: { content: "Hello" } },
      ];

      const state = deriveSessionState(entries);
      expect(state.status).toBe("idle");
      expect(state.isRunning).toBe(false);
    });

    it("returns idle for empty entries", () => {
      const state = deriveSessionState([]);
      expect(state.status).toBe("idle");
    });

    it("idle takes precedence over other states", () => {
      const entries = [
        { type: "assistant", timestamp: oldTimestamp, message: { content: [
          { type: "tool_use", id: "tool1", name: "Bash" },
        ]}},
      ];

      // Even though there's a pending tool use, it's too old
      const state = deriveSessionState(entries);
      expect(state.status).toBe("idle");
      expect(state.isRunning).toBe(false);
    });
  });

  describe("isRunning", () => {
    it("is true for working status", () => {
      const entries = [{ type: "user", timestamp: recentTimestamp }];
      const state = deriveSessionState(entries);
      expect(state.isRunning).toBe(true);
    });

    it("is true for waiting_for_approval status", () => {
      const entries = [
        { type: "assistant", timestamp: recentTimestamp, message: { content: [
          { type: "tool_use", id: "tool1", name: "Bash" },
        ]}},
      ];
      const state = deriveSessionState(entries);
      expect(state.isRunning).toBe(true);
    });

    it("is false for waiting_for_input status", () => {
      const entries = [
        { type: "assistant", timestamp: recentTimestamp, message: { content: [
          { type: "text", text: "Done!" },
        ]}},
      ];
      const state = deriveSessionState(entries);
      expect(state.isRunning).toBe(false);
    });

    it("is false for idle status", () => {
      const entries = [{ type: "user", timestamp: oldTimestamp }];
      const state = deriveSessionState(entries);
      expect(state.isRunning).toBe(false);
    });
  });

  describe("lastActivityTime", () => {
    it("tracks the most recent timestamp", () => {
      const earlier = new Date(now - 5000).toISOString();
      const later = new Date(now - 1000).toISOString();

      const entries = [
        { type: "user", timestamp: earlier },
        { type: "assistant", timestamp: later },
      ];

      const state = deriveSessionState(entries);
      expect(state.lastActivityTime).toBeGreaterThan(new Date(earlier).getTime());
    });

    it("handles missing timestamps", () => {
      const entries = [
        { type: "user" }, // No timestamp
        { type: "assistant", timestamp: recentTimestamp },
      ];

      const state = deriveSessionState(entries);
      expect(state.lastActivityTime).toBeGreaterThan(0);
    });
  });
});
