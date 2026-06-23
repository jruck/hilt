/**
 * HiltRef — a typed, portable reference to any object the user might want to pull into an agent
 * chat. One variant per object kind; each carries only the fields its reference format needs.
 *
 * The contract for callers: pass an ABSOLUTE filesystem path for file-backed kinds (a local agent
 * can then open it with no extra knowledge). The single formatter `buildReference` in ./build.ts
 * turns any HiltRef into the copyable string — that is the one place reference content is tuned.
 */
export type HiltRef =
  | {
      kind: "bridge-task";
      /** Absolute path to the weekly list file; null when the task isn't file-resolved (uses title). */
      absPath: string | null;
      /** 1-based line of the top-level checkbox, when known. */
      line?: number | null;
      title: string;
      dueDate?: string | null;
    }
  | { kind: "library-artifact"; absPath: string; title: string; url?: string | null }
  | { kind: "doc"; absPath: string }
  | { kind: "meeting"; absPath: string; title?: string | null }
  | { kind: "person"; absPath: string; name: string }
  | { kind: "stack-plugin"; absPath: string; title: string }
  | { kind: "stack-mcp"; absPath: string; title: string }
  | {
      kind: "session";
      sessionId: string;
      provider?: string | null;
      title?: string | null;
      cwd?: string | null;
    }
  | { kind: "briefing-item"; absPath: string; headline: string }
  | {
      kind: "calendar-event";
      id: string;
      uid?: string | null;
      title: string;
      start?: string | null;
      end?: string | null;
      sourceName?: string | null;
    };

export type HiltRefKind = HiltRef["kind"];
