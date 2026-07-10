import { withBasePath } from "@/lib/base-path";

/** POST /api/threads/[id]/process and drain the NDJSON stream. Resolves when the
 * stream ends cleanly; throws on a non-2xx response, an emitted {type:"error"} line,
 * or a transport failure. */
export async function runThreadProcess(threadId: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(withBasePath(`/api/threads/${threadId}/process`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
  });
  await drainProcessStream(response);
}

export interface ProcessAllProgress { index: number; total: number; threadId?: string; }

/** POST /api/threads/process-all and drain the NDJSON stream, reporting the running
 * (index/total) as thread-start events arrive. Resolves on the summary/stream end. */
export async function runProcessAll(onProgress: (p: ProcessAllProgress) => void, signal?: AbortSignal): Promise<void> {
  const response = await fetch(withBasePath("/api/threads/process-all"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "open" }),
    signal,
  });
  await drainProcessStream(response, (event) => {
    if (event.type === "thread-start" && typeof event.index === "number" && typeof event.total === "number") {
      onProgress({
        index: event.index,
        total: event.total,
        ...(typeof event.threadId === "string" ? { threadId: event.threadId } : {}),
      });
    }
  });
}

async function drainProcessStream(
  response: Response,
  onEvent?: (event: Record<string, unknown> & { type?: string }) => void,
): Promise<void> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamError: string | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let event: (Record<string, unknown> & { type?: string }) | null = null;
      try { event = JSON.parse(line); } catch { event = null; }
      if (!event) continue;
      if (event.type === "error") streamError = typeof event.error === "string" ? event.error : "Processing failed";
      onEvent?.(event);
    }
  }
  if (streamError) throw new Error(streamError);
}
