/**
 * Claude CLI runner for Hilt chats — ported from Loft (ai-edit `runClaude`/`findClaudeBinary`/
 * `summarizeToolInput`, claudeSettings `buildClaudeSpawnEnv`, repo-chat AbortSignal→SIGTERM).
 * One `claude -p` spawn per user turn; `--resume` carries conversation context between turns.
 * Never writes to ~/.claude/projects/ — the CLI manages its own session store there.
 */
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Single source of truth for the chat tool surface and model (plan decisions 2 & 7).
// No Bash in v1; Sonnet pinned — interactive wide-window sessions burned the rate-limit
// budget before (see docs/CHANGELOG.md library cost notes).
export const CHAT_ALLOWED_TOOLS = "Read,Edit,Write,Grep,Glob,LS";
export const CHAT_MODEL = "sonnet";

/** ~/.local/bin may hold a newer CLI than /usr/local/bin; PATH is the last resort. */
export function findClaudeBinary(): string {
  const candidates = [
    path.join(os.homedir(), ".local", "bin", "claude"),
    "/usr/local/bin/claude",
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "claude"; // fall back to PATH
}

/** Env block from ~/.claude/settings.json (string values only); {} when absent/unreadable. */
function getClaudeSettingsEnv(): Record<string, string> {
  const claudeSettingsPath = path.join(os.homedir(), ".claude", "settings.json");
  if (!fs.existsSync(claudeSettingsPath)) return {};
  try {
    const settings = JSON.parse(fs.readFileSync(claudeSettingsPath, "utf-8"));
    if (!settings.env || typeof settings.env !== "object") return {};
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(settings.env)) {
      if (typeof value === "string") env[key] = value;
    }
    return env;
  } catch {
    return {};
  }
}

/**
 * Spawn env: process.env wins over ~/.claude/settings.json values; ANTHROPIC_API_KEY is
 * blanked so the CLI uses the user's configured auth/backend rather than a stray key.
 */
export function buildClaudeSpawnEnv(): NodeJS.ProcessEnv {
  const claudeEnv = getClaudeSettingsEnv();
  const env = { ...process.env };
  for (const [key, value] of Object.entries(claudeEnv)) {
    if (env[key] === undefined) env[key] = value;
  }
  env.ANTHROPIC_API_KEY = "";
  return env;
}

/**
 * Per-tool input reduction for traces — traces are persisted per session, so inputs must
 * stay small: Bash command 220ch, Read/Edit/Write path-only, MultiEdit count, Grep/Glob
 * pattern+path, generic first-4-primitive-fields at 220ch. Full inputs never leave this fn.
 */
export function summarizeToolInput(name: string, input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const truncate = (value: unknown, max = 220) => {
    if (typeof value !== "string") return value;
    return value.length > max ? `${value.slice(0, max - 3)}...` : value;
  };

  if (name === "Bash") return { command: truncate(record.command) };
  if (name === "Read") return { file_path: record.file_path };
  if (name === "Edit") return { file_path: record.file_path };
  if (name === "Write") return { file_path: record.file_path };
  if (name === "MultiEdit") {
    return {
      file_path: record.file_path,
      edits: Array.isArray(record.edits) ? record.edits.length : undefined,
    };
  }
  if (name === "Grep") return { pattern: truncate(record.pattern, 120), path: record.path };
  if (name === "Glob") return { pattern: truncate(record.pattern, 120), path: record.path };
  if (name === "LS") return { path: record.path };

  return Object.fromEntries(
    Object.entries(record)
      .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
      .slice(0, 4)
      .map(([key, value]) => [key, truncate(value)]),
  );
}

export interface ChatToolCall {
  id: string | null;
  name: string;
  /** Already summarized — safe to persist in a trace. */
  input: Record<string, unknown> | null;
  /** Raw file_path (Edit/Write/MultiEdit/Read) for filesTouched extraction; never persisted as-is. */
  filePath: string | null;
}

export interface RunClaudeOptions {
  claudeSessionId: string | null;
  prompt: string;
  cwd: string;
  signal?: AbortSignal;
  /** Fired per assistant text block as the stdout parser sees it (also accumulated). */
  onText?: (text: string) => void;
  onToolUse?: (toolCall: ChatToolCall) => void;
}

export interface RunClaudeResult {
  collectedText: string;
  claudeSessionId: string | null;
  code: number | null;
  stderr: string;
}

/**
 * Spawn the Claude CLI for one turn and collect output. Resolves (never rejects) so the
 * route's failure handling stays in one place. stdout is parsed line-buffered — the trailing
 * partial line is kept and flushed on close; unparseable lines are skipped (the CLI mixes
 * occasional non-JSON noise into the stream). session_id is captured from ANY event carrying
 * it, including the final `result` event. Abort → child SIGTERM.
 */
export function runClaude(options: RunClaudeOptions): Promise<RunClaudeResult> {
  const { claudeSessionId, prompt, cwd, signal, onText, onToolUse } = options;
  return new Promise((resolve) => {
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--model", CHAT_MODEL,
      "--allowedTools", CHAT_ALLOWED_TOOLS,
      "--permission-mode", "bypassPermissions",
    ];
    if (claudeSessionId) args.push("--resume", claudeSessionId);
    args.push(prompt);

    const child = spawn(findClaudeBinary(), args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: buildClaudeSpawnEnv(),
    });

    const abort = () => child.kill("SIGTERM");
    // An already-aborted signal never fires its event — kill immediately in that case.
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort, { once: true });

    let stdoutBuffer = "";
    let collectedText = "";
    let resolvedSessionId: string | null = null;

    const parseEventLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const parsed = JSON.parse(trimmed);

        if (parsed.type === "assistant" && parsed.message?.content) {
          for (const block of parsed.message.content) {
            if (block.type === "text" && block.text) {
              collectedText += block.text;
              onText?.(block.text);
            } else if (block.type === "tool_use" && typeof block.name === "string") {
              const rawInput = block.input && typeof block.input === "object" && !Array.isArray(block.input)
                ? (block.input as Record<string, unknown>)
                : null;
              onToolUse?.({
                id: typeof block.id === "string" ? block.id : null,
                name: block.name,
                input: summarizeToolInput(block.name, block.input),
                filePath: typeof rawInput?.file_path === "string" ? rawInput.file_path : null,
              });
            }
          }
        }

        if (parsed.session_id) {
          resolvedSessionId = parsed.session_id;
        } else if (parsed.type === "result" && parsed.session_id) {
          resolvedSessionId = parsed.session_id;
        }
      } catch {
        // Skip unparseable lines.
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) parseEventLine(line);
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (stdoutBuffer.trim()) parseEventLine(stdoutBuffer);
      resolve({ collectedText, claudeSessionId: resolvedSessionId, code, stderr });
    });

    child.on("error", (error) => {
      signal?.removeEventListener("abort", abort);
      resolve({ collectedText: "", claudeSessionId: null, code: 1, stderr: error.message });
    });
  });
}
