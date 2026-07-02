/**
 * Loop artifact IO — serialize/parse/validate the dated markdown artifacts loops write, and the
 * write guard that keeps developing loops out of the live vault.
 *
 * Contract (normative: scope §3.2 + types.ts): an artifact is markdown with YAML frontmatter.
 * Machines read the frontmatter (`items`, `health`); humans read the body sections. The same run
 * writes both, and the body's `## Escalations` / `## Loop health` sections are VIEWS rendered from
 * the frontmatter — render helpers here keep them consistent by construction.
 *
 * Implementation notes (for the implementer):
 * - Use `gray-matter` for frontmatter round-tripping (same as src/lib/library/markdown.ts).
 * - Validation is fail-loud: `parseLoopArtifact` throws LoopContractError with EVERY problem listed
 *   (not just the first) — artifacts are written by agents; error messages are how they self-correct.
 * - Keep functions pure except the explicit write/read helpers.
 */
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { atomicWriteFile } from "../library/utils";
import type { LoopArtifactFrontmatter, LoopHealth, LoopItem, RegistryLoop } from "./types";

const CADENCES = new Set(["daily", "weekly", "manual"]);
const ITEM_KINDS = new Set(["insight", "action", "proposal"]);
const VERDICTS = new Set(["approve", "dismiss", "assign_to_me", "assign_to_agent", "revise"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isAskKind(kind: unknown): boolean {
  return kind === "action" || kind === "proposal";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** All contract violations found, joined for the message; `problems` carries the individual list. */
export class LoopContractError extends Error {
  problems: string[];
  constructor(problems: string[]) {
    super(`loop artifact contract violation(s): ${problems.join("; ")}`);
    this.name = "LoopContractError";
    this.problems = problems;
  }
}

/**
 * Validate an unknown frontmatter object against the contract. Returns the list of problems
 * (empty = valid). Checks, at minimum:
 * - loop/run_at/cadence present and well-formed (cadence ∈ daily|weekly|manual)
 * - items is an array; every item has id, loop (matching the artifact's), kind ∈
 *   insight|action|proposal, non-empty title, citations array (each with a `source`)
 * - escalated, when present, has a non-empty reason
 * - confidence, when present, is 0..1 and only on asks (action|proposal)
 * - allowed_verdicts only on asks, and every value is a known Verdict
 * - health present with boolean ok
 * - item ids unique within the artifact
 */
export function validateLoopArtifactFrontmatter(fm: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(fm)) return ["frontmatter must be an object"];

  const loop = fm.loop;
  if (!isNonEmptyString(loop)) problems.push("loop must be a non-empty string");

  if (!isNonEmptyString(fm.run_at)) {
    problems.push("run_at must be a non-empty ISO timestamp string");
  } else if (Number.isNaN(Date.parse(fm.run_at))) {
    problems.push(`run_at "${fm.run_at}" must be a valid ISO timestamp`);
  }

  if (!isNonEmptyString(fm.cadence) || !CADENCES.has(fm.cadence)) {
    problems.push(`cadence must be one of daily|weekly|manual, got ${String(fm.cadence)}`);
  }

  if (fm.as_of !== undefined && !isNonEmptyString(fm.as_of)) {
    problems.push("as_of must be a non-empty YYYY-MM-DD string when present");
  }

  const items = fm.items;
  if (!Array.isArray(items)) {
    problems.push("items must be an array");
  } else {
    const seenIds = new Set<string>();
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const fallbackLabel = `item[${index}]`;
      const label = isRecord(item) && isNonEmptyString(item.id) ? item.id : fallbackLabel;

      if (!isRecord(item)) {
        problems.push(`${fallbackLabel} must be an object`);
        continue;
      }

      if (!isNonEmptyString(item.id)) {
        problems.push(`${label}.id must be a non-empty string`);
      } else if (seenIds.has(item.id)) {
        problems.push(`duplicate item id ${item.id}`);
      } else {
        seenIds.add(item.id);
      }

      if (!isNonEmptyString(item.loop)) {
        problems.push(`${label}.loop must be a non-empty string`);
      } else if (isNonEmptyString(loop) && item.loop !== loop) {
        problems.push(`${label}.loop "${item.loop}" must match artifact loop "${loop}"`);
      }

      if (!isNonEmptyString(item.kind) || !ITEM_KINDS.has(item.kind)) {
        problems.push(`${label}.kind must be one of insight|action|proposal, got ${String(item.kind)}`);
      }

      if (!isNonEmptyString(item.title)) {
        problems.push(`${label}.title must be a non-empty string`);
      }

      if (item.detail !== undefined && typeof item.detail !== "string") {
        problems.push(`${label}.detail must be a string when present`);
      }

      if (!Array.isArray(item.citations)) {
        problems.push(`${label}.citations must be an array`);
      } else {
        item.citations.forEach((citation, citationIndex) => {
          const citationLabel = `${label}.citations[${citationIndex}]`;
          if (!isRecord(citation)) {
            problems.push(`${citationLabel} must be an object`);
            return;
          }
          if (!isNonEmptyString(citation.source)) {
            problems.push(`${citationLabel}.source must be a non-empty string`);
          }
          if (citation.date !== undefined && typeof citation.date !== "string") {
            problems.push(`${citationLabel}.date must be a string when present`);
          }
          if (citation.anchor !== undefined && typeof citation.anchor !== "string") {
            problems.push(`${citationLabel}.anchor must be a string when present`);
          }
        });
      }

      if (item.escalated !== undefined) {
        if (!isRecord(item.escalated)) {
          problems.push(`${label}.escalated must be an object when present`);
        } else if (!isNonEmptyString(item.escalated.reason)) {
          problems.push(`${label}.escalated.reason must be a non-empty string`);
        }
      }

      if (item.confidence !== undefined) {
        if (!isFiniteNumber(item.confidence) || item.confidence < 0 || item.confidence > 1) {
          problems.push(`${label}.confidence must be a number from 0..1 when present`);
        }
        if (!isAskKind(item.kind)) {
          problems.push(`${label}.confidence is only allowed on action|proposal items`);
        }
      }

      if (item.owner !== undefined && typeof item.owner !== "string") {
        problems.push(`${label}.owner must be a string when present`);
      }

      if (item.allowed_verdicts !== undefined) {
        if (!isAskKind(item.kind)) {
          problems.push(`${label}.allowed_verdicts is only allowed on action|proposal items`);
        }
        if (!Array.isArray(item.allowed_verdicts)) {
          problems.push(`${label}.allowed_verdicts must be an array when present`);
        } else {
          item.allowed_verdicts.forEach((verdict, verdictIndex) => {
            if (!isNonEmptyString(verdict) || !VERDICTS.has(verdict)) {
              problems.push(`${label}.allowed_verdicts[${verdictIndex}] invalid verdict ${String(verdict)}`);
            }
          });
        }
      }
    }
  }

  if (!isRecord(fm.health)) {
    problems.push("health must be an object");
  } else {
    if (typeof fm.health.ok !== "boolean") {
      problems.push("health.ok must be boolean");
    }
    for (const field of ["attempted", "succeeded", "coverage"] as const) {
      const value = fm.health[field];
      if (value !== undefined && !isFiniteNumber(value)) {
        problems.push(`health.${field} must be numeric when present`);
      }
    }
    if (isFiniteNumber(fm.health.coverage) && (fm.health.coverage < 0 || fm.health.coverage > 1)) {
      problems.push("health.coverage must be 0..1 when present");
    }
    if (fm.health.quality_notes !== undefined && typeof fm.health.quality_notes !== "string") {
      problems.push("health.quality_notes must be a string when present");
    }
    if (fm.health.notes !== undefined && typeof fm.health.notes !== "string") {
      problems.push("health.notes must be a string when present");
    }
    if (fm.health.proposal_ids !== undefined) {
      if (!Array.isArray(fm.health.proposal_ids)) {
        problems.push("health.proposal_ids must be an array when present");
      } else {
        fm.health.proposal_ids.forEach((id, index) => {
          if (!isNonEmptyString(id)) problems.push(`health.proposal_ids[${index}] must be a non-empty string`);
        });
      }
    }
  }

  return problems;
}

/** Serialize frontmatter + body to the on-disk markdown form (gray-matter). */
export function serializeLoopArtifact(fm: LoopArtifactFrontmatter, body: string): string {
  return matter.stringify(body.trimEnd() + "\n", fm).trimEnd() + "\n";
}

/** Parse + validate an artifact file's content. Throws LoopContractError when invalid. */
export function parseLoopArtifact(markdown: string): { frontmatter: LoopArtifactFrontmatter; body: string } {
  const parsed = matter(markdown);
  const problems = validateLoopArtifactFrontmatter(parsed.data);
  if (problems.length > 0) throw new LoopContractError(problems);
  return { frontmatter: parsed.data as LoopArtifactFrontmatter, body: parsed.content };
}

/**
 * Render the `## Escalations` body section from the artifact's items: one bullet per escalated
 * item — `- **<title>** — <escalated.reason>` with a sub-bullet citation line
 * (`  - *<source>[, <date>]*` for the first citation) and, for asks, a sub-bullet naming the
 * allowed verdicts. Returns "" when nothing is escalated (the section is omitted entirely —
 * callers must not emit an empty heading).
 */
export function renderEscalationsSection(items: LoopItem[]): string {
  const escalated = items.filter((item) => item.escalated);
  if (escalated.length === 0) return "";

  const lines = ["## Escalations", ""];
  for (const item of escalated) {
    lines.push(`- **${item.title}** — ${item.escalated!.reason}`);
    const citation = item.citations[0];
    if (citation) {
      const citationText = citation.date ? `${citation.source}, ${citation.date}` : citation.source;
      lines.push(`  - *${citationText}*`);
    }
    if (isAskKind(item.kind) && item.allowed_verdicts?.length) {
      lines.push(`  - Verdicts: ${item.allowed_verdicts.join(", ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Render the `## Loop health` body section from the health block: an `ok`/`FAILING` first line,
 * the run metrics that are present (attempted/succeeded/coverage), then quality_notes and notes
 * as separate lines when present. Always returns a non-empty section (health is required).
 */
export function renderLoopHealthSection(health: LoopHealth): string {
  const lines = ["## Loop health", "", `- Status: ${health.ok ? "ok" : "FAILING"}`];
  if (health.attempted !== undefined) lines.push(`- attempted: ${health.attempted}`);
  if (health.succeeded !== undefined) lines.push(`- succeeded: ${health.succeeded}`);
  if (health.coverage !== undefined) lines.push(`- coverage: ${health.coverage}`);
  if (health.quality_notes) lines.push(`- quality_notes: ${health.quality_notes}`);
  if (health.notes) lines.push(`- notes: ${health.notes}`);
  return `${lines.join("\n")}\n`;
}

/** Vault-relative artifact path for a loop's dated report: meta/loops/<domain>/reports/<date>.md */
export function artifactRelPath(loop: Pick<RegistryLoop, "domain">, date: string): string {
  return ["meta", "loops", loop.domain, "reports", `${date}.md`].join("/");
}

/**
 * THE WRITE GUARD (implementation plan §1.4, risk #3). Resolve where this artifact may be written:
 * - `fm.as_of` set (launchpad/backtest run) → ALWAYS the sandbox, regardless of phase.
 * - loop.phase === "live" → the real vault (`vaultPath`).
 * - loop.phase === "shadow" → the sandbox.
 * Throws LoopContractError when the sandbox is required but `sandboxDir` is not provided, and when
 * `fm.loop` doesn't match `loop.id`. Never silently redirects live→vault on a mismatch.
 * Returns the ABSOLUTE file path (base + artifactRelPath), creating no directories itself.
 */
export function resolveArtifactWritePath(opts: {
  vaultPath: string;
  sandboxDir?: string;
  loop: RegistryLoop;
  fm: LoopArtifactFrontmatter;
  date: string;
}): string {
  const problems: string[] = [];
  if (opts.fm.loop !== opts.loop.id) {
    problems.push(`artifact loop "${opts.fm.loop}" does not match registry loop id "${opts.loop.id}"`);
  }

  const sandboxRequired = Boolean(opts.fm.as_of) || opts.loop.phase === "shadow";
  if (sandboxRequired && !opts.sandboxDir) {
    problems.push(`sandboxDir is required for loop ${opts.loop.id} phase ${opts.loop.phase}${opts.fm.as_of ? " with as_of" : ""}`);
  }

  if (problems.length > 0) throw new LoopContractError(problems);

  const base = sandboxRequired ? opts.sandboxDir! : opts.vaultPath;
  return path.join(base, artifactRelPath(opts.loop, opts.date));
}

/**
 * Write an artifact through the guard: resolves the path (above), mkdir -p the parent, serializes,
 * writes atomically (temp + rename, like src/lib/library/utils.ts:atomicWriteFile), and returns
 * the absolute path written.
 */
export function writeLoopArtifact(opts: {
  vaultPath: string;
  sandboxDir?: string;
  loop: RegistryLoop;
  fm: LoopArtifactFrontmatter;
  body: string;
  date: string;
}): string {
  const problems = validateLoopArtifactFrontmatter(opts.fm);
  if (problems.length > 0) throw new LoopContractError(problems);

  const filePath = resolveArtifactWritePath(opts);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  atomicWriteFile(filePath, serializeLoopArtifact(opts.fm, opts.body));
  return filePath;
}
