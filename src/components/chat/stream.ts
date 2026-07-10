import type { ChatTraceEvent } from "@/lib/chat/types";

export function parseNdjsonLine<T>(line: string): T | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

export async function consumeNdjsonStream<T>(
  response: Response,
  handleEvent: (event: T) => void,
): Promise<void> {
  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const event = parseNdjsonLine<T>(line);
        if (event) handleEvent(event);
      }
    }
    buffer += decoder.decode();
    const event = parseNdjsonLine<T>(buffer);
    if (event) handleEvent(event);
    return;
  }

  const responseText = await response.text();
  for (const line of responseText.split("\n")) {
    const event = parseNdjsonLine<T>(line);
    if (event) handleEvent(event);
  }
}

export function mergeTraceEvent(trace: ChatTraceEvent[], event: ChatTraceEvent): ChatTraceEvent[] {
  const index = trace.findIndex((item) => item.id === event.id);
  if (index === -1) return [...trace, event];
  const next = [...trace];
  next[index] = { ...next[index], ...event };
  return next;
}
