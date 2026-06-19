import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { loadEnvConfig } from "@next/env";
import { listLibraryArtifactDetails } from "../src/lib/library/library";
import { buildKbIndex } from "../src/lib/library/kb-index";
import { detectRateLimitInEnvelope, extractModelText, resolveClaudeBin, runClaude } from "../src/lib/library/connections";
import { stringifyMarkdown } from "../src/lib/library/markdown";
import { PIPELINE_VERSION } from "../src/lib/library/pipeline";
import { dateTimestamp, isoNow } from "../src/lib/library/utils";
import type { ConnectionSuggestion, LibraryArtifactDetail } from "../src/lib/library/types";

loadEnvConfig(process.cwd());
const execFileAsync = promisify(execFile);

/**
 * The editor's memo (Library v2, Workstream 3): the weekly synthesis pass over the period's study
 * intake. One non-agentic Claude call reads the KB index plus the week's already-digested items and
 * writes an argument — 2-4 through-lines tying the reading to specific active projects, plus a
 * "worth your time" shortlist — to the vault as a first-class library item at
 * references/process/memos/YYYY-MM-DD-editors-memo.md. Re-running the same day overwrites that
 * day's memo (idempotent). Skips cleanly (exit 0) on thin intake or a closed Claude window.
 *
 *   DATA_DIR=~/.hilt/data npx tsx scripts/library-memo.ts [--days 7] [--dry-run]
 */

const args = process.argv.slice(2);
const argValue = (name: string): string | null => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] || null : null; };
const has = (name: string): boolean => args.includes(name);
// Fail closed on garbage numbers: NaN fails every comparison, which would silently turn the intake
// window into "everything" (or the timeout into "never"), and each run is a paid Claude call.
const finiteArg = (name: string, fallback: number): number => {
  const raw = argValue(name);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) { console.error(`Invalid ${name}: "${raw}" — pass a number.`); process.exit(64); }
  return parsed;
};
const finiteEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) { console.error(`Invalid ${name}: "${raw}" — set a number.`); process.exit(64); }
  return parsed;
};

const vaultPath = argValue("--vault") || process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd();
const windowDays = Math.max(1, finiteArg("--days", 7));
const timeoutMs = finiteEnv("LIBRARY_MEMO_TIMEOUT_MS", 300_000);

const MEMO_SOURCE_ID = "library-memo";

interface IntakeItem {
  path: string;
  title: string;
  summary: string | null;
  url: string | null;
  connection_labels: string[];
}

function connectionLabels(artifact: LibraryArtifactDetail): string[] {
  const raw = artifact.raw_frontmatter.connection_suggestions;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => (entry && typeof entry === "object" && typeof (entry as { label?: unknown }).label === "string" ? (entry as { label: string }).label : null))
    .filter((label): label is string => Boolean(label));
}

function gatherIntake(): IntakeItem[] {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const { artifacts } = listLibraryArtifactDetails(vaultPath, { includeCandidates: true, limit: 100_000 });
  return artifacts
    .filter((artifact) => artifact.library_mode !== "keep")
    .filter((artifact) => artifact.lifecycle_status !== "expired" && artifact.lifecycle_status !== "skipped")
    // Prior memos are themselves study items; feeding them back in would make the memo cite itself
    // (and break same-day idempotent re-runs, where today's memo would join its own intake).
    .filter((artifact) => artifact.source_id !== MEMO_SOURCE_ID)
    .filter((artifact) => dateTimestamp(artifact.created_at) >= cutoff)
    .map((artifact) => ({
      path: artifact.path,
      title: artifact.title,
      summary: artifact.summary,
      url: artifact.url,
      connection_labels: connectionLabels(artifact),
    }));
}

interface MemoResponse {
  title: string;
  description: string;
  memo_markdown: string;
  referenced_items: string[];
}

function memoLinkTarget(input: string): string {
  return input.replace(/^\/+/, "").replace(/\.md$/, "");
}

function wikilinkLabel(input: string): string {
  return input.replace(/\[/g, "(").replace(/]/g, ")").replace(/\s+/g, " ").trim();
}

function sanitizeWikilinkLabels(markdown: string): string {
  return markdown.replace(/\[\[([^\]|\n]+)\|([\s\S]*?)]]/g, (match, target: string, label: string) => {
    if (label.includes("\n")) return match;
    return `[[${memoLinkTarget(target.trim())}|${wikilinkLabel(label)}]]`;
  });
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function protectMarkdownLinks(markdown: string): { text: string; restore: (text: string) => string } {
  const protectedSpans: string[] = [];
  const text = markdown.replace(/```[\s\S]*?```|`[^`\n]+`|!?\[\[[^\]]+]]|!?\[[^\]]*]\([^)]*\)/g, (match) => {
    const token = `@@HILT_MEMO_PROTECTED_${protectedSpans.length}@@`;
    protectedSpans.push(match);
    return token;
  });
  return {
    text,
    restore: (value: string) => value.replace(/@@HILT_MEMO_PROTECTED_(\d+)@@/g, (_match, index: string) => protectedSpans[Number(index)] || ""),
  };
}

function titleMentionVariants(title: string): string[] {
  const variants = new Set<string>();
  const add = (value: string | null | undefined) => {
    const trimmed = value?.replace(/\s+/g, " ").trim();
    if (trimmed && trimmed.length >= 8) variants.add(trimmed);
  };

  add(title);
  const bracketedSource = title.match(/^\[([^\]]+)]\s*(.+)$/);
  if (bracketedSource) {
    add(`${bracketedSource[1]}: ${bracketedSource[2]}`);
    add(bracketedSource[2]);
    add(bracketedSource[2].split(":")[0]);
  }
  const homePageTitle = title.match(/^Home Page\s*-\s*(.+)$/i);
  if (homePageTitle) add(homePageTitle[1]);
  const withAttribution = title.match(/^(.+?)\s+With\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,3})$/);
  if (withAttribution) add(`${withAttribution[1]} (${withAttribution[2]})`);

  return [...variants].sort((a, b) => b.length - a.length);
}

function referencedBodyLinkItems(memo: MemoResponse, items: IntakeItem[]): IntakeItem[] {
  const byPath = new Map(items.map((item) => [memoLinkTarget(item.path), item]));
  const linked: IntakeItem[] = [];
  for (const referenced of memo.referenced_items) {
    const item = byPath.get(memoLinkTarget(referenced));
    if (item && !linked.some((existing) => memoLinkTarget(existing.path) === memoLinkTarget(item.path))) linked.push(item);
  }
  return linked;
}

function linkReferencedItemMentions(markdown: string, items: IntakeItem[]): string {
  let linked = markdown;
  const entries = items.flatMap((item) => {
    const target = memoLinkTarget(item.path);
    return titleMentionVariants(item.title).map((label) => ({ label, target }));
  }).sort((a, b) => b.label.length - a.label.length);

  for (const entry of entries) {
    const protectedMarkdown = protectMarkdownLinks(linked);
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])(${escapeRegExp(entry.label)})(?![\\p{L}\\p{N}_])`, "gu");
    const replaced = protectedMarkdown.text.replace(pattern, (_match, prefix: string, label: string) => (
      `${prefix}[[${entry.target}|${wikilinkLabel(label)}]]`
    ));
    linked = protectedMarkdown.restore(replaced);
  }

  return linked;
}

function buildPrompt(items: IntakeItem[]): string {
  const kbIndex = buildKbIndex(vaultPath, { noWrite: true });
  const itemBlocks = items.map((item) => [
    `ITEM ${item.path}`,
    `Title: ${item.title}`,
    item.url ? `URL: ${item.url}` : "",
    item.connection_labels.length ? `Woven connections: ${item.connection_labels.join("; ")}` : "",
    item.summary ? `Summary: ${item.summary}` : "",
  ].filter(Boolean).join("\n")).join("\n\n");

  return [
    "You are a sharp publishing-house reader writing THE EDITOR'S MEMO to Justin about this week's",
    "reading intake. Below: an index of his active work, then the week's new library items (already",
    "digested — titles, summaries, woven connections).",
    "",
    "Write the memo as an argument about what the reading MEANS for his current work — never a list",
    "of links. It must contain:",
    "- 2-4 THROUGH-LINES, each tying at least 2 of the week's items to a SPECIFIC active project or",
    "  area from the index, ending with a concrete \"consider this\" recommendation.",
    "- A \"worth your time this week\" shortlist: at most 3 items, one-line reason each.",
    "- When naming a specific item from THIS WEEK'S ITEMS in the memo body, link it with Hilt",
    "  wikilink syntax: [[<ITEM path without .md>|<human title>]]. Use the ITEM path exactly as",
    "  the target, minus a trailing .md. Do not put square brackets inside the alias label; write",
    "  [AINews] as AINews, for example. Do not link generic concepts or active project names this way.",
    "",
    // The long free-form body must NOT travel inside a JSON string — escaping a multi-paragraph
    // markdown document is exactly where models slip (first live run failed on an unescaped char at
    // position 891). Small single-line JSON header + body between sentinels parses reliably.
    "Return EXACTLY this structure (the JSON header on ONE line; the memo body between the sentinels):",
    '<header>{ "title": "<memo title>", "description": "<1-2 sentence summary for the feed card>", "referenced_items": ["<vault-relative path of each item referenced, exactly as given in ITEM lines>"] }</header>',
    "<memo>",
    "<the memo body, plain markdown — no JSON escaping>",
    "</memo>",
    "",
    "=== INDEX OF JUSTIN'S WORK ===",
    kbIndex,
    "",
    "=== THIS WEEK'S ITEMS ===",
    itemBlocks,
  ].join("\n");
}

async function composeMemo(items: IntakeItem[]): Promise<MemoResponse | "rate_limited"> {
  const cliArgs = ["-p", buildPrompt(items), "--output-format", "json"];
  const model = process.env.LIBRARY_CONNECTIONS_MODEL;
  if (model) cliArgs.push("--model", model);

  let stdout: string;
  try {
    stdout = await runClaude(resolveClaudeBin(), cliArgs, timeoutMs);
  } catch (error) {
    const e = error as { stderr?: string; stdout?: string; message?: string };
    if (detectRateLimitInEnvelope(e?.stdout || "").limited || /usage limit|rate.?limit/i.test(e?.stderr || "")) return "rate_limited";
    throw new Error(`claude call failed: ${(e?.message || String(error)).slice(0, 300)}`);
  }
  if (detectRateLimitInEnvelope(stdout).limited) return "rate_limited";

  const text = extractModelText(stdout);
  const headerMatch = text.match(/<header>([\s\S]*?)<\/header>/);
  const memoMatch = text.match(/<memo>\s*([\s\S]*?)\s*<\/memo>/);
  if (!headerMatch || !memoMatch) {
    throw new Error(`memo response missing <header>/<memo> sentinels: ${text.slice(0, 300)}`);
  }
  const parsed = JSON.parse(headerMatch[1].trim()) as Partial<MemoResponse>;
  if (typeof parsed.title !== "string" || !memoMatch[1].trim()) {
    throw new Error(`memo response missing title or body: ${text.slice(0, 300)}`);
  }
  return {
    title: parsed.title,
    description: typeof parsed.description === "string" ? parsed.description : "",
    memo_markdown: memoMatch[1].trim(),
    referenced_items: Array.isArray(parsed.referenced_items) ? parsed.referenced_items.filter((p): p is string => typeof p === "string") : [],
  };
}

function referencedSuggestions(memo: MemoResponse, items: IntakeItem[]): ConnectionSuggestion[] {
  const byPath = new Map(items.map((item) => [item.path.replace(/\.md$/, ""), item]));
  const suggestions: ConnectionSuggestion[] = [];
  for (const referenced of memo.referenced_items) {
    const key = referenced.replace(/^\/+/, "").replace(/\.md$/, "");
    const item = byPath.get(key);
    // Drop paths that don't resolve to this week's intake — connection targets must be durable, and
    // a hallucinated path would stamp a dangling suggestion onto the memo. Candidates under
    // references/.cache/ are TEMPORARY (TTL'd) — same rule as the reweave prompt: never a connection
    // target. The memo body still names them; only durable refs get woven.
    if (!item || key.includes(".cache/") || suggestions.some((s) => s.target === key)) continue;
    suggestions.push({ target: key, label: item.title, relationship: "discussed in this memo" });
  }
  return suggestions;
}

async function main(): Promise<void> {
  const items = gatherIntake();

  if (has("--dry-run")) {
    console.log(JSON.stringify({ dry_run: true, window_days: windowDays, items_considered: items.length, items }, null, 2));
    return;
  }
  if (items.length < 2) {
    console.log(JSON.stringify({ skipped: "not enough intake", items_considered: items.length }));
    return;
  }

  const memo = await composeMemo(items);
  if (memo === "rate_limited") {
    console.log(JSON.stringify({ skipped: "rate_limited" }));
    return;
  }

  const now = isoNow();
  const today = now.slice(0, 10);
  const suggestions = referencedSuggestions(memo, items);
  const frontmatter: Record<string, unknown> = {
    type: "reference",
    title: memo.title,
    description: memo.description,
    format: "memo",
    channel: "internal",
    source_id: MEMO_SOURCE_ID,
    source_name: "Editor's Memo",
    library_mode: "study",
    captured_at: now,
    digested_at: now,
    digestion_status: "hot",
    pipeline_version: PIPELINE_VERSION,
    // The memo IS its own connection pass; without this stamp the nightly reweave drain would
    // target it as missing one and spend an agentic run re-weaving the editor's own synthesis.
    reconnected_at: now,
    connection_suggestions: suggestions,
  };
  const linkedMemoMarkdown = linkReferencedItemMentions(sanitizeWikilinkLabels(memo.memo_markdown), referencedBodyLinkItems(memo, items));
  const body = `# ${memo.title}\n\n${linkedMemoMarkdown}`;

  const memoDir = path.join(vaultPath, "references", "process", "memos");
  fs.mkdirSync(memoDir, { recursive: true });
  const memoPath = path.join(memoDir, `${today}-editors-memo.md`);
  fs.writeFileSync(memoPath, stringifyMarkdown(frontmatter, body), "utf-8");

  // Remote surface: render to ~/.hilt/reports/memo/ so the memo is always readable at
  // /api/reports/memo (in Hilt and over the tailnet); the Sunday briefing links here. Best-effort.
  try {
    const tsxBin = fs.existsSync("node_modules/.bin/tsx") ? "node_modules/.bin/tsx" : "npx";
    const prefix = tsxBin === "npx" ? ["tsx"] : [];
    await execFileAsync(tsxBin, [...prefix, "scripts/report-html.ts", "--md", memoPath, "--out", path.join(process.env.HOME || "~", ".hilt", "reports", "memo", "index.html"), "--title", "Editor's Memo"], { env: process.env, timeout: 60_000 });
  } catch (error) {
    console.error("[memo] report render failed:", error instanceof Error ? error.message.slice(0, 200) : error);
  }

  console.log(JSON.stringify({ memo: memoPath, items_considered: items.length, referenced: suggestions.length }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
