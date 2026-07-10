import { describe, expect, it } from "vitest";
import type { ChatTraceEvent } from "@/lib/chat/types";
import { consumeNdjsonStream, mergeTraceEvent, parseNdjsonLine } from "./stream";

function trace(overrides: Partial<ChatTraceEvent> & { id: string; label: string }): ChatTraceEvent {
  return {
    id: overrides.id,
    type: overrides.type ?? "step",
    status: overrides.status ?? "running",
    label: overrides.label,
    detail: overrides.detail ?? null,
    toolName: overrides.toolName ?? null,
    input: overrides.input ?? null,
    outputSummary: overrides.outputSummary ?? null,
    timestamp: overrides.timestamp ?? Date.now(),
    durationMs: overrides.durationMs ?? null,
  };
}

describe("parseNdjsonLine", () => {
  it("returns null for empty or unparseable lines", () => {
    expect(parseNdjsonLine("")).toBeNull();
    expect(parseNdjsonLine("   ")).toBeNull();
    expect(parseNdjsonLine("{ nope")).toBeNull();
  });
});

describe("mergeTraceEvent", () => {
  it("appends unknown ids", () => {
    const first = trace({ id: "a", label: "A" });
    const second = trace({ id: "b", label: "B" });
    expect(mergeTraceEvent([first], second)).toEqual([first, second]);
  });

  it("upgrades matching ids in place without mutating the input array", () => {
    const first = trace({ id: "a", label: "A", status: "running" });
    const second = trace({ id: "b", label: "B", status: "running" });
    const input = [first, second];
    const next = mergeTraceEvent(input, trace({
      id: "a",
      label: "A done",
      status: "complete",
      durationMs: 125,
    }));

    expect(next).not.toBe(input);
    expect(input[0]).toBe(first);
    expect(input[0].status).toBe("running");
    expect(next.map((event) => event.id)).toEqual(["a", "b"]);
    expect(next[0]).toMatchObject({ id: "a", label: "A done", status: "complete", durationMs: 125 });
    expect(next[1]).toBe(second);
  });
});

describe("consumeNdjsonStream", () => {
  it("handles split chunks, multi-line chunks, garbage lines, and final lines without newlines", async () => {
    type Event = { type: string; value?: number | string };
    const encoder = new TextEncoder();
    const chunks = [
      "{\"type\":\"one\",\"value\":",
      "1}\n",
      "{\"type\":\"two\"}\ngarbage\n{\"type\":\"three\",\"value\":\"x\"}\n",
      "{\"type\":\"four\"}",
    ];
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }));
    const events: Event[] = [];

    await consumeNdjsonStream<Event>(response, (event) => events.push(event));

    expect(events).toEqual([
      { type: "one", value: 1 },
      { type: "two" },
      { type: "three", value: "x" },
      { type: "four" },
    ]);
  });
});
