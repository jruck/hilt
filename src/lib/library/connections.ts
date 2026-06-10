import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { ConnectionJudgment, ReweaveResult } from "./types";
import { CONNECTION_PROMPT, parseConnectionJudgment } from "./connection-prompt";
import { REWEAVE_PROMPT, parseReweaveOutput } from "./reweave-prompt";

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

// Comprehensive exploration takes longer than a one-shot call: the judge/reweave greps the whole
// vault and reads many notes before deciding. Long, idea-dense "hub" sources need generous headroom
// or they time out and get skipped — so default high and allow an env override for backfills.
const DEFAULT_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.LIBRARY_REWEAVE_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 600_000;
})();
const MAX_SOURCE_EXCERPT_CHARS = 5_000;
// The reweave digest reads the source more deeply than the judge, so it gets a larger excerpt.
const MAX_REWEAVE_EXCERPT_CHARS = 8_000;

export function resolveClaudeBin(): string {
  return process.env.CLAUDE_PATH || process.env.CLAUDE_BIN || "claude";
}

/**
 * Thrown by reweaveArtifact (only when `rethrowRateLimit` is set) when the Claude CLI signals a
 * subscription/usage limit, so a backfill orchestrator can pause + back off instead of treating it
 * as a content failure. `resetAt` is the parsed reset time when the CLI provides one.
 */
export class RateLimitError extends Error {
  resetAt: string | null;
  constructor(message: string, resetAt: string | null = null) {
    super(message);
    this.name = "RateLimitError";
    this.resetAt = resetAt;
  }
}

const RATE_LIMIT_RE = /usage limit|rate.?limit|rate.?limited|429|too many requests|over_?loaded|quota|limit (?:reached|exceeded|will reset)|resets? at|try again (?:later|in)/i;

/**
 * Sniff CLI ERROR text for a usage-limit signal. Returns whether it looks rate-limited and, when
 * present, an ISO reset time parsed from common phrasings ("resets at 3pm", an epoch, an ISO).
 * Only ever feed this error surfaces (stderr, error messages, is_error envelopes) — model CONTENT
 * routinely discusses rate limits (a "rate-limit-aware" crawler reference) and must not be sniffed.
 */
export function detectRateLimit(...texts: Array<string | undefined>): { limited: boolean; resetAt: string | null } {
  const blob = texts.filter(Boolean).join("\n");
  if (!blob || !RATE_LIMIT_RE.test(blob)) return { limited: false, resetAt: null };
  let resetAt: string | null = null;
  const iso = blob.match(/\b(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\b/);
  if (iso) resetAt = iso[1];
  else {
    const epoch = blob.match(/reset[^0-9]{0,20}(\d{10,13})/i);
    if (epoch) {
      const n = Number(epoch[1]);
      resetAt = new Date(n < 1e12 ? n * 1000 : n).toISOString();
    }
  }
  return { limited: true, resetAt };
}

/**
 * Limit detection for a COMPLETED CLI call (exit 0). The model's digest lives in the envelope's
 * `result` field and is NEVER sniffed on success — a reference ABOUT rate limits reads as a false
 * positive otherwise, and a deterministic queue order turns it into a poison pill that halts every
 * drain/backfill. Only an `is_error: true` envelope carries CLI error text worth sniffing.
 * Non-envelope stdout under --output-format json is itself an error surface, so sniff it raw.
 */
export function detectRateLimitInEnvelope(stdout: string): { limited: boolean; resetAt: string | null } {
  const trimmed = stdout.trim();
  if (!trimmed) return { limited: false, resetAt: null };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    // Only trust is_error on something that actually looks like the result envelope. Other JSON on
    // stdout (an API error blob like {"type":"error","error":{"type":"rate_limit_error"}}, an array)
    // is an error surface and falls through to the raw sniff below.
    if (
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
      && ("is_error" in parsed || (parsed as { type?: unknown }).type === "result")
    ) {
      const envelope = parsed as { is_error?: unknown; result?: unknown; subtype?: unknown };
      if (envelope.is_error !== true) return { limited: false, resetAt: null };
      return detectRateLimit(
        typeof envelope.result === "string" ? envelope.result : "",
        typeof envelope.subtype === "string" ? envelope.subtype : "",
      );
    }
  } catch {
    // Not JSON — sniff the raw text.
  }
  return detectRateLimit(trimmed);
}

/**
 * Run the Claude CLI headlessly and capture stdout. Mirrors the execFile/timeout/maxBuffer
 * plumbing used elsewhere in the library. We close stdin immediately (the whole task is passed
 * via -p) so the CLI does not wait on stdin. `cwd` points the run at the vault so the judge's
 * read tools resolve against Justin's notes.
 */
export function runClaude(bin: string, args: string[], timeoutMs: number, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      bin,
      args,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 8, cwd: cwd || undefined },
      (error, stdout, stderr) => {
        if (error) {
          // Attach the captured streams: callback-style execFile errors don't carry them, and the
          // catch-path limit detection needs REAL error surfaces. error.message must never be
          // sniffed — execFile builds it from the full command line, which embeds the -p task
          // (KB index + source excerpt), i.e. content that can legitimately discuss rate limits.
          const carrier = error as Error & { stdout?: string; stderr?: string };
          carrier.stdout = stdout;
          carrier.stderr = stderr;
          reject(carrier);
        } else resolve(stdout);
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end("");
  });
}

/**
 * The -p task: the judge is dropped INTO the vault (cwd) and told to actually explore it —
 * grep/glob/read the genuinely related notes — rather than judging from the index alone. The
 * index is a starting map, not the whole world; this is what lets it surface ties to specific
 * prior references (e.g. a moats-strand reference cluster) the compact index can't enumerate.
 */
function buildExploreTask(
  kbIndex: string,
  artifact: { title: string; summary: string; keyPoints: string[]; sourceExcerpt: string },
): string {
  const keyPoints = artifact.keyPoints.filter(Boolean).map((point) => `- ${point}`).join("\n");
  const excerpt = (artifact.sourceExcerpt || "").slice(0, MAX_SOURCE_EXCERPT_CHARS);
  return [
    "You are inside Justin's knowledge-base vault (the current working directory). Below is an INDEX",
    "of his active work as a starting map, then a NEW reference to judge.",
    "",
    "Before deciding, EXPLORE the vault COMPREHENSIVELY with your read tools (Grep/Glob/Read):",
    "1. Pull out the reference's core concepts, claims, and vocabulary (e.g. for a moats/strategy",
    "   piece: 'moat', 'defensibility', 'value capture', 'switching cost', 'monopoly', 'lock-in').",
    "2. Grep the WHOLE vault for those terms and their synonyms — across projects/, references/,",
    "   references/process/, thoughts/, libraries/ (incl. libraries/*/strategy and */references),",
    "   areas/, and people/. Do not limit yourself to the index; it cannot enumerate every note.",
    "3. Open every note that looks genuinely related and read enough to judge the relationship.",
    "Be exhaustive: a substantive reference can genuinely connect to many notes (8-12+). Surface ALL",
    "real ties — do not stop at an arbitrary few — while still abstaining entirely when nothing",
    "genuinely connects. Then follow the system instructions exactly and return ONLY the required JSON.",
    "",
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
export function extractModelText(stdout: string): string {
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
 * Make a Claude Code judgment call to decide whether a new reference genuinely connects to
 * Justin's active work. The judge runs headlessly INSIDE the vault (cwd) with read-only tools
 * (Read/Grep/Glob) so it can explore the actual notes — reproducing the deep reweave that a
 * static index cannot. The CONNECTION_PROMPT is the system prompt (via
 * --append-system-prompt-file); the index + reference + an "explore the vault" instruction are
 * passed as the -p task.
 *
 * Abstains (returns connects:false, empty arrays) on ANY failure — CLI missing, timeout, or
 * unparseable output — and when LIBRARY_CONNECTIONS_DISABLED=1 so tests stay offline. Without a
 * vaultPath it also abstains, since there is nothing to explore.
 */
export async function judgeConnections(
  kbIndex: string,
  artifact: { title: string; summary: string; keyPoints: string[]; sourceExcerpt: string },
  opts: { timeoutMs?: number; model?: string; vaultPath?: string } = {},
): Promise<ConnectionJudgment> {
  if (process.env.LIBRARY_CONNECTIONS_DISABLED === "1") return { ...ABSTAIN };
  if (!kbIndex.trim() || !artifact.title.trim()) return { ...ABSTAIN };

  const vaultPath = opts.vaultPath || process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER;
  if (!vaultPath) return { ...ABSTAIN };

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const model = opts.model || process.env.LIBRARY_CONNECTIONS_MODEL;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "hilt-library-connections-"));
  const promptPath = path.join(dir, "prompt.txt");

  try {
    await fs.promises.writeFile(promptPath, CONNECTION_PROMPT, "utf-8");

    const args = [
      "-p",
      buildExploreTask(kbIndex, artifact),
      "--append-system-prompt-file",
      promptPath,
      "--allowed-tools",
      "Read",
      "Grep",
      "Glob",
      "--permission-mode",
      "default",
      "--add-dir",
      vaultPath,
      "--output-format",
      "json",
    ];
    if (model) args.push("--model", model);

    const stdout = await runClaude(resolveClaudeBin(), args, timeoutMs, vaultPath);
    const modelText = extractModelText(stdout);
    if (!modelText) return { ...ABSTAIN };
    return parseConnectionJudgment(modelText);
  } catch {
    return { ...ABSTAIN };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * The -p task for the reweave pass: the model is dropped INTO the vault (cwd) with the KB index
 * as a starting map and the new reference (title + a capped source excerpt). It is told to
 * explore the vault and return the reweave JSON described by REWEAVE_PROMPT. The deeper digest
 * gets a larger excerpt than the judge.
 */
function buildReweaveTask(
  kbIndex: string,
  artifact: { title: string; sourceContent: string; intent?: string },
): string {
  const excerpt = (artifact.sourceContent || "").slice(0, MAX_REWEAVE_EXCERPT_CHARS);
  return [
    "You are inside Justin's knowledge-base vault (the current working directory). Below is an INDEX",
    "of his active work as a starting map, then a NEW reference to weave in.",
    "",
    "EXPLORE the vault with your read tools (Grep/Glob/Read) to write the digest and find genuine",
    "connections, then follow the system instructions exactly and return ONLY the required JSON.",
    "",
    "=== INDEX OF JUSTIN'S WORK ===",
    kbIndex,
    "",
    "=== NEW REFERENCE ===",
    // Save context (format/url/tags) is the intent signal: use it to decide the treatment mode
    // (idea vs. product vs. aesthetic vs. failed capture) per the system instructions.
    artifact.intent ? `Save context: ${artifact.intent}` : "",
    `Title: ${artifact.title}`,
    `Source excerpt:\n${excerpt}`,
  ].filter(Boolean).join("\n");
}

/**
 * Run the single-pass reweave for a DURABLE save: one headless Claude Code call INSIDE the vault
 * (cwd) with read-only tools (Read/Grep/Glob) that produces a free-form digest body, a frontmatter
 * description, a proposed title, and disciplined first-party/library connections. Mirrors
 * judgeConnections' plumbing but uses REWEAVE_PROMPT as the system prompt.
 *
 * Returns null on ANY failure — CLI missing, timeout, unparseable output — and when
 * LIBRARY_CONNECTIONS_DISABLED=1 so tests stay offline. Without a vaultPath it also returns null,
 * since there is nothing to explore; the caller then falls back to the split candidate path.
 */
export async function reweaveArtifact(
  kbIndex: string,
  artifact: { title: string; sourceContent: string; intent?: string },
  opts: { timeoutMs?: number; model?: string; vaultPath?: string; rethrowRateLimit?: boolean } = {},
): Promise<ReweaveResult | null> {
  if (process.env.LIBRARY_CONNECTIONS_DISABLED === "1") return null;
  if (!kbIndex.trim() || !artifact.title.trim()) return null;

  const vaultPath = opts.vaultPath || process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER;
  if (!vaultPath) return null;

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const model = opts.model || process.env.LIBRARY_CONNECTIONS_MODEL;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "hilt-library-reweave-"));
  const promptPath = path.join(dir, "prompt.txt");

  try {
    await fs.promises.writeFile(promptPath, REWEAVE_PROMPT, "utf-8");

    const args = [
      "-p",
      buildReweaveTask(kbIndex, artifact),
      "--append-system-prompt-file",
      promptPath,
      "--allowed-tools",
      "Read",
      "Grep",
      "Glob",
      "--permission-mode",
      "default",
      "--add-dir",
      vaultPath,
      "--output-format",
      "json",
    ];
    if (model) args.push("--model", model);

    const stdout = await runClaude(resolveClaudeBin(), args, timeoutMs, vaultPath);
    // Exit 0 can still carry a usage-limit message in the JSON envelope (is_error + result text) —
    // but a SUCCESSFUL result is model content and must not be sniffed (see detectRateLimitInEnvelope).
    if (opts.rethrowRateLimit) {
      const hit = detectRateLimitInEnvelope(stdout);
      if (hit.limited) throw new RateLimitError("Claude usage limit reached during reweave", hit.resetAt);
    }
    const modelText = extractModelText(stdout);
    if (!modelText) return null;
    return parseReweaveOutput(modelText);
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    // Non-zero exit / timeout: inspect the streams runClaude attached. NEVER sniff error.message —
    // execFile builds it from the full command line (the -p task: KB index + source excerpt), so it
    // contains content that legitimately discusses rate limits. stderr is a true error surface
    // (sniff raw); stdout may carry an error envelope or raw limit text (envelope-aware check).
    if (opts.rethrowRateLimit) {
      const e = error as { stderr?: string; stdout?: string };
      const hit = detectRateLimit(e?.stderr);
      const stdoutHit = hit.limited ? hit : detectRateLimitInEnvelope(e?.stdout || "");
      if (hit.limited || stdoutHit.limited) {
        throw new RateLimitError("Claude usage limit reached during reweave", hit.resetAt || stdoutHit.resetAt);
      }
    }
    return null;
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
