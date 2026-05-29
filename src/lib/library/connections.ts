import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { ConnectionJudgment } from "./types";
import { CONNECTION_PROMPT, parseConnectionJudgment } from "./connection-prompt";

// Re-export the vault folder-reading helpers (now living in kb-index.ts) so existing
// import sites that reach for them via connections.ts keep working.
export { buildKbIndex, readFolderSignals, currentTaskSignals, northStarSignal } from "./kb-index";
export type { ContextSignal } from "./kb-index";

const ABSTAIN: ConnectionJudgment = {
  connects: false,
  connections: [],
  reweave_candidates: [],
  reasoning: "",
};

const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_SOURCE_EXCERPT_CHARS = 5_000;

function resolveClaudeBin(): string {
  return process.env.CLAUDE_PATH || process.env.CLAUDE_BIN || "claude";
}

/**
 * Run the Claude CLI headlessly, piping `input` on stdin and capturing stdout. Mirrors the
 * execFile/timeout/maxBuffer plumbing used elsewhere in the library, but uses execFile's child
 * handle so we can write the reference payload to stdin (execFile options have no `input`).
 */
function runClaude(bin: string, args: string[], input: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      bin,
      args,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 8 },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}

function buildReferenceInput(
  kbIndex: string,
  artifact: { title: string; summary: string; keyPoints: string[]; sourceExcerpt: string },
): string {
  const keyPoints = artifact.keyPoints.filter(Boolean).map((point) => `- ${point}`).join("\n");
  const excerpt = (artifact.sourceExcerpt || "").slice(0, MAX_SOURCE_EXCERPT_CHARS);
  return [
    "=== INDEX OF JUSTIN'S WORK ===",
    kbIndex,
    "",
    "=== NEW REFERENCE ===",
    `Title: ${artifact.title}`,
    `Summary: ${artifact.summary}`,
    keyPoints ? `Key points:\n${keyPoints}` : "Key points:",
    `Source excerpt:\n${excerpt}`,
  ].join("\n");
}

/**
 * Parse the JSON envelope emitted by `claude -p ... --output-format json`. The model's text
 * answer lives in the `result` field; fall back to treating stdout as raw text if it is not
 * the expected envelope.
 */
function extractModelText(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as { result?: unknown; is_error?: unknown };
    if (parsed && typeof parsed === "object" && typeof parsed.result === "string") {
      return parsed.result;
    }
  } catch {
    // Not the JSON envelope; treat stdout as the model's raw text.
  }
  return trimmed;
}

/**
 * Make a single Claude-CLI judgment call to decide whether a new reference genuinely connects to
 * Justin's active work. The CONNECTION_PROMPT is written to a temp file and passed via
 * --append-system-prompt-file, and the assembled index + reference is piped on stdin.
 *
 * Abstains (returns connects:false, empty arrays) on ANY failure — CLI missing, timeout, or
 * unparseable output — and when LIBRARY_CONNECTIONS_DISABLED=1 so tests stay offline.
 */
export async function judgeConnections(
  kbIndex: string,
  artifact: { title: string; summary: string; keyPoints: string[]; sourceExcerpt: string },
  opts: { timeoutMs?: number; model?: string } = {},
): Promise<ConnectionJudgment> {
  if (process.env.LIBRARY_CONNECTIONS_DISABLED === "1") return { ...ABSTAIN };
  if (!kbIndex.trim() || !artifact.title.trim()) return { ...ABSTAIN };

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const model = opts.model || process.env.LIBRARY_CONNECTIONS_MODEL;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "hilt-library-connections-"));
  const promptPath = path.join(dir, "prompt.txt");
  const inputPath = path.join(dir, "input.md");

  try {
    await fs.promises.writeFile(promptPath, CONNECTION_PROMPT, "utf-8");
    await fs.promises.writeFile(inputPath, buildReferenceInput(kbIndex, artifact), "utf-8");

    const args = [
      "-p",
      "Read the input on stdin and follow the system instructions exactly.",
      "--append-system-prompt-file",
      promptPath,
      "--output-format",
      "json",
    ];
    if (model) args.push("--model", model);

    const input = await fs.promises.readFile(inputPath, "utf-8");
    const stdout = await runClaude(resolveClaudeBin(), args, input, timeoutMs);
    const modelText = extractModelText(stdout);
    if (!modelText) return { ...ABSTAIN };
    return parseConnectionJudgment(modelText);
  } catch {
    return { ...ABSTAIN };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
