/**
 * One-shot: move any feedback stored in vault frontmatter (`feedback`/`feedback_at`/
 * `feedback_processed_at`) into Hilt's DATA_DIR feedback store, then strip it from the markdown — so
 * feedback no longer travels with the article. Dry-run by default; pass --write to apply.
 */
import path from "path";
import { loadEnvConfig } from "@next/env";
import type { LibraryComment } from "../src/lib/library/types";
import { listLibraryArtifactDetails } from "../src/lib/library/library";
import { seedStoredComments } from "../src/lib/library/library-feedback";
import { parseMarkdownFile, stringifyMarkdown } from "../src/lib/library/markdown";
import { atomicWriteFile, isoNow } from "../src/lib/library/utils";

loadEnvConfig(process.cwd());
const vault = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || "/Users/jruck/work/bridge";
const write = process.argv.includes("--write");
const cid = () => `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

function normalize(value: unknown, at: unknown, processedAt: unknown): LibraryComment[] {
  if (Array.isArray(value)) {
    return value
      .filter((e): e is Record<string, unknown> => Boolean(e && typeof e === "object" && typeof (e as Record<string, unknown>).text === "string"))
      .map((e) => ({
        id: typeof e.id === "string" && e.id ? e.id : cid(),
        text: String(e.text).trim(),
        created_at: typeof e.created_at === "string" ? e.created_at : isoNow(),
        updated_at: typeof e.updated_at === "string" ? e.updated_at : undefined,
        processed_at: typeof e.processed_at === "string" ? e.processed_at : undefined,
      }))
      .filter((c) => c.text);
  }
  if (typeof value === "string" && value.trim()) {
    return [{ id: cid(), text: value.trim(), created_at: typeof at === "string" ? at : isoNow(), processed_at: typeof processedAt === "string" ? processedAt : undefined }];
  }
  return [];
}

const all = listLibraryArtifactDetails(vault, { limit: 100000, includeCandidates: true, mode: "all" }).artifacts;
let migrated = 0;
for (const artifact of all) {
  const fm = artifact.raw_frontmatter;
  if (fm.feedback == null && fm.feedback_at == null && fm.feedback_processed_at == null) continue;
  const comments = normalize(fm.feedback, fm.feedback_at, fm.feedback_processed_at);
  console.log(`${artifact.title.slice(0, 50)} → ${comments.length} comment(s)`);
  if (!write) continue;
  if (comments.length) seedStoredComments(vault, artifact.id, comments);
  const filePath = path.join(vault, artifact.path);
  const parsed = parseMarkdownFile(filePath);
  const next: Record<string, unknown> = { ...parsed.data };
  delete next.feedback;
  delete next.feedback_at;
  delete next.feedback_processed_at;
  atomicWriteFile(filePath, stringifyMarkdown(next, parsed.body));
  migrated += 1;
}
console.log(`\n${write ? `migrated ${migrated} item(s) into the store + stripped frontmatter` : "DRY RUN — pass --write to apply"}`);
