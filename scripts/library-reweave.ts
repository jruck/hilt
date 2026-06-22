import fs from "fs";
import path from "path";
import { loadEnvConfig } from "@next/env";
import { reweaveArtifact, RateLimitError } from "../src/lib/library/connections";
import { buildKbIndex } from "../src/lib/library/kb-index";
import { extractHeading, extractSection, markdownToPlain, parseMarkdownFile, stringifyMarkdown } from "../src/lib/library/markdown";
import { buildMediaMarkdown, stripDetailsWrapper } from "../src/lib/library/media";
import { enrichRawArtifactMedia } from "../src/lib/library/media-enrichment";
import { PIPELINE_VERSION } from "../src/lib/library/pipeline";
import { addToReviewQueue } from "../src/lib/library/review-queue";
import { hashId } from "../src/lib/library/utils";
import type { RawArtifact, ReweaveConnection, ReweaveResult } from "../src/lib/library/types";

loadEnvConfig(process.cwd());

const args = process.argv.slice(2);
const write = args.includes("--write"); // DEFAULT OFF = dry run

function argValue(name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
}

function argValues(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

const vaultPath = argValue("--vault")
  || process.env.BRIDGE_VAULT_PATH
  || process.env.HILT_WORKING_FOLDER
  || process.cwd();

const outDir = argValue("--out-dir");

// When set alongside --write, every reference written is registered in the per-vault review queue
// under this batch label, stamped with the current PIPELINE_VERSION, for later human review.
const reviewBatch = argValue("--review-batch");

// The generation note rendered atop the Updated lane. Defaults to docs/review-notes/<version>.md
// (relative to the repo root); override with --review-note <path>. Only loaded for a written batch.
const reviewNotePath = argValue("--review-note")
  || path.resolve(process.cwd(), "docs/review-notes", `${PIPELINE_VERSION}.md`);

/**
 * Load + parse the generation note for this batch. Title is the first `# ` heading (stripped from the
 * body); the remainder is the markdown shown in the card. Returns null when no note file is present —
 * the batch still registers, it just renders without an explainer card.
 */
function loadReviewNote(): { version: string; title: string; markdown: string } | null {
  if (!fs.existsSync(reviewNotePath)) {
    console.error(`No generation note at ${reviewNotePath} — registering the batch without a card.`);
    return null;
  }
  const raw = fs.readFileSync(reviewNotePath, "utf-8");
  const lines = raw.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^#\s+/.test(line));
  let title = `Generation ${PIPELINE_VERSION}`;
  let bodyLines = lines;
  if (headingIndex >= 0) {
    title = lines[headingIndex].replace(/^#\s+/, "").trim() || title;
    bodyLines = lines.slice(headingIndex + 1);
  }
  const markdown = bodyLines.join("\n").trim();
  return { version: PIPELINE_VERSION, title, markdown };
}

// Gentle pacing between reweave calls so a large backfill doesn't slam subscription rate limits.
const sleepMs = Number(argValue("--sleep") || 0);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolve --path targets (absolute or vault-relative against --vault), honoring --limit.
 */
function resolveTargets(): string[] {
  const paths = argValues("--path").map((item) => (path.isAbsolute(item) ? item : path.resolve(vaultPath, item)));
  if (!paths.length) {
    throw new Error("Pass one or more --path <reference.md>.");
  }
  const limit = Number(argValue("--limit") || 0);
  return Number.isFinite(limit) && limit > 0 ? paths.slice(0, limit) : paths;
}

/**
 * Extract a "## <heading>" section INCLUDING its heading line and trailing blank line, byte-for-byte
 * from the body, so the Media and Raw Content blocks can be preserved verbatim. Returns "" when the
 * section is absent.
 */
function extractSectionWithHeading(body: string, sectionName: string): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${sectionName}`.toLowerCase());
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}

/**
 * Extract ONLY the leading media block from the "## Media" section (heading + images/embeds), stopping
 * at the first prose line. Guards a known pollution: when a prior digest was a heading-less wall of text
 * (a failed summarize that dumped raw cache directly under Media with no `## ` of its own),
 * `extractSectionWithHeading` would swallow that whole wall as "media" — and the reweave would faithfully
 * preserve it, leaving the wall stuck above the clean digest. Media is images/embeds, so stop at the
 * first non-media (prose) line.
 */
function extractMediaSection(body: string): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === "## media");
  if (start === -1) return "";
  const kept: string[] = [lines[start]];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) break;
    const t = lines[i].trim();
    const isMedia = t === "" || /^!\[/.test(t) || /^\[!\[/.test(t) || /^<\/?[a-z]/i.test(t);
    if (!isMedia) break;
    kept.push(lines[i]);
  }
  return kept.join("\n").trim();
}

function connectionBody(reweave: ReweaveResult): string {
  const ordered: ReweaveConnection[] = [...reweave.connections_first_party, ...reweave.connections_library];
  if (!ordered.length) return "";
  return ordered.map((connection) => {
    const link = connection.target ? `[[${connection.target}|${connection.title}]]` : connection.title;
    return `- ${link} - ${connection.relationship}`;
  }).join("\n");
}

function digestSectionHeadings(digest: string): string[] {
  return digest
    .split(/\r?\n/)
    .filter((line) => /^##\s+/.test(line.trim()))
    .map((line) => line.trim().replace(/^##\s+/, ""));
}

function truncateDescription(value: string, limit = 300): string {
  const plain = markdownToPlain(value);
  if (plain.length <= limit) return plain;

  const clipped = plain.slice(0, limit).trimEnd();
  const sentenceBoundary = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("! "), clipped.lastIndexOf("? "));
  if (sentenceBoundary >= 120) return clipped.slice(0, sentenceBoundary + 1);

  const wordBoundary = clipped.replace(/\s+\S*$/, "").trimEnd();
  return `${wordBoundary || clipped}...`;
}

async function main(): Promise<void> {
  const files = resolveTargets();
  if (outDir && !write) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  // Build the KB index ONCE and reuse it across every file in this run. A backfill orchestrator can
  // build it once and pass --kb-index-file so parallel workers don't each rebuild it.
  const kbIndexFile = argValue("--kb-index-file");
  const kbIndex = kbIndexFile && fs.existsSync(kbIndexFile)
    ? fs.readFileSync(kbIndexFile, "utf-8")
    : buildKbIndex(vaultPath, { noWrite: true });
  const rethrowRateLimit = process.env.LIBRARY_REWEAVE_RETHROW_RATELIMIT === "1";
  const results: unknown[] = [];
  // Review-queue entries collected across the run, registered once at the end.
  const reviewEntries: Array<{ id: string; path: string; pipeline_version: string }> = [];

  for (const filePath of files) {
    let parsed: ReturnType<typeof parseMarkdownFile>;
    try {
      parsed = parseMarkdownFile(filePath);
    } catch (error) {
      results.push({ path: filePath, status: "error", reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const { data, body } = parsed;
    // Accept durable references AND discovery candidates (reference-candidate). Both reweave through
    // the same reweaveArtifact path and re-stamp pipeline_version; candidates are swept by
    // library-backfill --include-candidates (the v2.1 onion). Anything else is left untouched.
    if (data.type !== "reference" && data.type !== "reference-candidate") {
      results.push({ path: filePath, status: "skipped_not_reference", reason: `type is ${String(data.type)}, not reference` });
      continue;
    }

    const title = String(data.title || extractHeading(body, path.basename(filePath, ".md")));
    // Prefer the raw source cache, then the legacy Summary, then the frontmatter description.
    const sourceContent = stripDetailsWrapper(extractSection(body, "Raw Content"))
      || extractSection(body, "Summary")
      || String(data.description || "");

    // Intent signal: format/channel/url/tags tell the reweave WHY this was saved (product vs idea
    // vs aesthetic), so it can pick the treatment mode rather than analyzing everything the same way.
    const tags = Array.isArray(data.tags) ? data.tags.map(String).filter(Boolean).join(", ") : "";
    const intent = [
      data.format ? `format: ${String(data.format)}` : "",
      data.channel ? `saved via: ${String(data.channel)}` : "",
      data.url ? `url: ${String(data.url)}` : "",
      tags ? `tags: ${tags}` : "",
    ].filter(Boolean).join("; ");

    let reweave: Awaited<ReturnType<typeof reweaveArtifact>>;
    try {
      reweave = await reweaveArtifact(kbIndex, { title, sourceContent, intent }, { vaultPath, rethrowRateLimit });
    } catch (error) {
      if (error instanceof RateLimitError) {
        // Signal the backfill orchestrator to pause + back off (exit 75 = EX_TEMPFAIL).
        console.error(`RATE_LIMITED${error.resetAt ? ` RESET_AT=${error.resetAt}` : ""}`);
        process.exit(75);
      }
      throw error;
    }

    // SKIP-ON-FAILURE: a null result (CLI missing/timeout/rate-limit/disabled) or an empty digest
    // means we cannot responsibly rewrite the body. Leave the file untouched and report it.
    if (!reweave || !reweave.digest_markdown.trim()) {
      results.push({
        path: filePath,
        proposed_title: null,
        description: null,
        digest_section_headings: [],
        first_party: [],
        library: [],
        status: "skipped_error",
      });
      if (sleepMs) await sleep(sleepMs);
      continue;
    }

    // Drop self-references: the reweave explores the vault and can find this very note (or its prior
    // version, same URL) and suggest connecting/reweaving to itself. Filter those out.
    const selfKey = path.relative(vaultPath, filePath).replace(/\\/g, "/").replace(/\.md$/, "");
    const selfBase = path.basename(filePath, ".md");
    const isSelf = (t: unknown): boolean => {
      const b = String(t || "").replace(/\.md$/, "");
      return b === selfKey || b === selfBase || b.endsWith(`/${selfBase}`);
    };
    reweave.connections_first_party = reweave.connections_first_party.filter((c) => !isSelf(c.target));
    reweave.connections_library = reweave.connections_library.filter((c) => !isSelf(c.target));
    if (reweave.reweave_candidates) reweave.reweave_candidates = reweave.reweave_candidates.filter((c) => !isSelf(c.target));

    const proposedTitle = reweave.proposed_title.trim() || title;
    const digest = reweave.digest_markdown.trim();
    // Repair a broken/missing hero before (re)building Media: validate the captured thumbnail and fall
    // back to the page's OpenGraph image when it's unreachable (e.g. a Raindrop screenshot-render URL
    // that 500s on a 360-viewer product page). When the thumbnail changes, rebuild Media so the dead
    // image is dropped rather than preserved.
    const originalThumb = typeof data.thumbnail === "string" ? data.thumbnail : undefined;
    const enriched = await enrichRawArtifactMedia({
      url: String(data.url || ""),
      title,
      thumbnail: originalThumb,
      date: String(data.published || data.captured || ""),
      metadata: { media: Array.isArray(data.media) ? data.media : [] },
    } as RawArtifact);
    const repairedThumb = typeof enriched.raw.thumbnail === "string" ? enriched.raw.thumbnail : undefined;
    const thumbChanged = repairedThumb !== originalThumb;
    if (thumbChanged) {
      if (repairedThumb) data.thumbnail = repairedThumb;
      else delete data.thumbnail;
    }

    // Preserve the existing Media section verbatim; if there isn't one (or we just repaired the hero),
    // build it from frontmatter so the post/image shows at top.
    let media = thumbChanged ? "" : extractMediaSection(body);
    if (!media.trim()) {
      const built = buildMediaMarkdown({
        url: String(data.url || ""),
        title,
        thumbnail: repairedThumb,
        date: String(data.published || data.captured || ""),
        metadata: {
          video_url: typeof data.video_url === "string" ? data.video_url : undefined,
          expanded_url: typeof data.expanded_url === "string" ? data.expanded_url : undefined,
        },
      } as RawArtifact).trim();
      if (built) media = built;
    }
    const rawContentSection = extractSectionWithHeading(body, "Raw Content")
      || `## Raw Content

<details>
<summary>Full source cache</summary>

No cached source content available.

</details>`;
    const connections = connectionBody(reweave);
    // Omit the Connections section entirely when there are none — no empty heading.
    const connectionsBlock = connections.trim() ? `\n\n## Connections\n\n${connections}` : "";

    const nextBody = `# ${proposedTitle}

${media ? `${media}\n\n` : ""}${digest}${connectionsBlock}

${rawContentSection}
`;

    const connectionSuggestions = [...reweave.connections_first_party, ...reweave.connections_library].map((connection) => ({
      target: connection.target,
      label: connection.title,
      relationship: connection.relationship,
    }));
    const connectionReasoning = connectionSuggestions.length
      ? `Woven into ${connectionSuggestions.length} note${connectionSuggestions.length === 1 ? "" : "s"} across Justin's work.`
      : "";

    const nextData: Record<string, unknown> = { ...data };
    nextData.description = truncateDescription(reweave.description || String(data.description || ""));
    if (connectionReasoning) nextData.connection_reasoning = connectionReasoning;
    else delete nextData.connection_reasoning;
    if (reweave.reweave_candidates && reweave.reweave_candidates.length) {
      nextData.reweave_candidates = reweave.reweave_candidates;
    } else {
      delete nextData.reweave_candidates;
    }
    // Drop stale connection_suggestions or set the new set.
    if (connectionSuggestions.length) nextData.connection_suggestions = connectionSuggestions;
    else delete nextData.connection_suggestions;
    // The judge layer: the agent's direct attention-worthiness verdict, stamped alongside the weave.
    if (reweave.attention_judgment) nextData.attention_judgment = reweave.attention_judgment;
    nextData.reconnected_at = new Date().toISOString();
    nextData.pipeline_version = PIPELINE_VERSION;
    // A successful reweave upgrades a degraded (L1-only) item — clear the re-upgrade flag.
    delete nextData.reweave_pending;
    for (const key of Object.keys(nextData)) {
      if (nextData[key] === undefined) delete nextData[key];
    }

    const rendered = stringifyMarkdown(nextData, nextBody);

    if (write) {
      fs.writeFileSync(filePath, rendered, "utf-8");
      if (reviewBatch) {
        // Register against the same vault-relative path the app uses, keyed by its hashId.
        const relPath = path.relative(vaultPath, filePath).split(path.sep).join("/");
        reviewEntries.push({ id: hashId(relPath), path: relPath, pipeline_version: PIPELINE_VERSION });
      }
    } else if (outDir) {
      // Dry-run preview only: write the rendered markdown to the out dir, NEVER the vault.
      fs.writeFileSync(path.join(outDir, path.basename(filePath)), rendered, "utf-8");
    }

    results.push({
      path: filePath,
      proposed_title: proposedTitle,
      description: nextData.description,
      digest_section_headings: digestSectionHeadings(digest),
      first_party: reweave.connections_first_party.map((connection) => ({
        title: connection.title,
        relationship: connection.relationship,
      })),
      library: reweave.connections_library.map((connection) => ({
        title: connection.title,
        relationship: connection.relationship,
      })),
      status: write ? "updated" : "dry_run",
    });
    if (sleepMs) await sleep(sleepMs);
  }

  let reviewRegistered = 0;
  if (reviewBatch && write && reviewEntries.length) {
    const note = loadReviewNote() || undefined;
    reviewRegistered = addToReviewQueue(vaultPath, reviewEntries, { batch: reviewBatch, note }).added;
    console.error(`Registered ${reviewRegistered} reference(s) for review under batch "${reviewBatch}"${note ? ` with note "${note.title}"` : ""}.`);
  }

  console.log(JSON.stringify({
    write,
    vault: vaultPath,
    out_dir: outDir,
    review_batch: reviewBatch || null,
    review_registered: reviewRegistered,
    checked: files.length,
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
