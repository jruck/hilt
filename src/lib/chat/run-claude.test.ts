import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createClaudeStreamParser,
  type ChatToolCall,
  type ChatToolResult,
} from "./run-claude";

function event(value: unknown): string {
  return JSON.stringify(value);
}

describe("createClaudeStreamParser", () => {
  test("streams text deltas exactly once and ignores the completed assistant snapshot", () => {
    const chunks: string[] = [];
    const parser = createClaudeStreamParser({ onText: (text) => chunks.push(text) });

    parser.parseLine(event({
      type: "stream_event",
      session_id: "session-1",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hello" },
      },
    }));
    parser.parseLine(event({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: " world" },
      },
    }));
    parser.parseLine(event({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello world" }] },
    }));

    assert.deepEqual(chunks, ["Hello", " world"]);
    assert.deepEqual(parser.finish(), {
      collectedText: "Hello world",
      claudeSessionId: "session-1",
    });
  });

  test("falls back to completed assistant text only when no deltas were emitted", () => {
    const chunks: string[] = [];
    const parser = createClaudeStreamParser({ onText: (text) => chunks.push(text) });

    parser.parseLine(event({
      type: "assistant",
      message: { content: [{ type: "text", text: "Fallback response" }] },
    }));

    assert.deepEqual(chunks, []);
    assert.deepEqual(parser.finish(), {
      collectedText: "Fallback response",
      claudeSessionId: null,
    });
    assert.deepEqual(chunks, ["Fallback response"]);
  });

  test("emits one tool start and result keyed by the tool use id", () => {
    const toolCalls: ChatToolCall[] = [];
    const toolResults: ChatToolResult[] = [];
    const parser = createClaudeStreamParser({
      onToolUse: (toolCall) => toolCalls.push(toolCall),
      onToolResult: (toolResult) => toolResults.push(toolResult),
    });
    const toolUse = {
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          id: "toolu_1",
          name: "Edit",
          input: { file_path: "/tmp/example.ts", old_string: "before", new_string: "after" },
        }],
      },
    };
    const toolResult = {
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "done" }],
      },
    };

    parser.parseLine(event(toolUse));
    parser.parseLine(event(toolUse));
    parser.parseLine(event(toolResult));
    parser.parseLine(event(toolResult));
    parser.finish();

    assert.deepEqual(toolCalls, [{
      id: "toolu_1",
      name: "Edit",
      input: { file_path: "/tmp/example.ts" },
      filePath: "/tmp/example.ts",
    }]);
    assert.deepEqual(toolResults, [{ toolUseId: "toolu_1", isError: false }]);
  });

  test("reports failed tool results and ignores malformed stream lines", () => {
    const toolResults: ChatToolResult[] = [];
    const parser = createClaudeStreamParser({
      onToolResult: (toolResult) => toolResults.push(toolResult),
    });

    parser.parseLine("not json");
    parser.parseLine(event({
      type: "user",
      session_id: "session-2",
      message: {
        content: [{ type: "tool_result", tool_use_id: "toolu_2", is_error: true }],
      },
    }));

    assert.deepEqual(parser.finish(), { collectedText: "", claudeSessionId: "session-2" });
    assert.deepEqual(toolResults, [{ toolUseId: "toolu_2", isError: true }]);
  });
});
