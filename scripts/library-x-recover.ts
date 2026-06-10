import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { loadEnvConfig } from "@next/env";
import { parseMarkdownFile, stringifyMarkdown } from "../src/lib/library/markdown";
import { CANDIDATE_CACHE_DIR } from "../src/lib/library/candidate-cache";
import { walkMarkdown } from "../src/lib/library/utils";
import { captureFailed, NO_SOURCE_MARKER } from "../src/lib/library/capture-health";

loadEnvConfig(process.cwd());
const execFileAsync = promisify(execFile);

/**
 * On-demand browser recovery for login-walled X content (X Articles, protected posts) the API and
 * Wayback can't reach. Uses the `browser-use` CLI against a REAL, already-logged-in Chrome profile
 * (default: "Default" = the everyday signed-in profile) — so there is no separate login, no stored
 * credential, no rate-limit risk. It reads the post/article text with a deterministic `eval` (no LLM
 * call), caches it with provenance, redigests, and stamps reweave_pending for the nightly weave.
 *
 * MANUAL ONLY — it drives a real Chrome profile, so it must not run unattended in the nightly drain
 * (that would fight the user's live browser). Run it when present:
 *
 *   npm run library:x:recover -- --path references/<x-stub>.md
 *   npm run library:x:recover -- --bucket           # every X-url stub in the needs_refetch bucket
 *   ... --profile "Default"   --dry-run
 */

const args = process.argv.slice(2);
const argValue = (name: string): string | null => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] || null : null; };
const vaultPath = argValue("--vault") || process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd();
const profile = argValue("--profile") || process.env.X_BROWSER_PROFILE || "Default";
const bucket = args.includes("--bucket");
const dryRun = args.includes("--dry-run");
const browserUseBin = process.env.BROWSER_USE_BIN || "browser-use";
const session = "library-x-recover";
let sessionLaunched = false;

const X_URL_RE = /^https?:\/\/(www\.)?(x|twitter)\.com\//i;
// Accept any non-trivial extractor hit (>=80 chars): tweets are legitimately short, and the
// extractor only reads tweet/article selectors — a login wall or deleted post returns empty.
const MIN_TEXT = 80;
// The DOM extractor: X Article rich text, then a tweet's text, then the article container — first
// non-trivial hit wins. Single-quoted/paren-safe so it survives shell argv.
const EXTRACT_JS = "(function(){var a=document.querySelector('[data-testid=twitterArticleRichTextView]');var t=document.querySelector('[data-testid=tweetText]');var ar=document.querySelector('article');return (a&&a.innerText)||(t&&t.innerText)||(ar&&ar.innerText)||'';})()";

interface XTarget { relative_path: string; title: string; contentUrl: string }

/** The URL whose TEXT we want: an X Article link in the body if present (the link-share case),
 *  else the item's own post URL. */
function contentUrlFor(data: Record<string, unknown>, body: string): string | null {
  const article = body.match(/https?:\/\/(?:www\.)?x\.com\/i\/article\/\d+/i)?.[0];
  if (article) return article;
  const url = String(data.url || "");
  return X_URL_RE.test(url) ? url : null;
}

function findXStubs(): XTarget[] {
  const targets: XTarget[] = [];
  for (const root of ["references", CANDIDATE_CACHE_DIR]) {
    for (const filePath of walkMarkdown(path.join(vaultPath, root), { includeHidden: root.includes(".cache") })) {
      let parsed: ReturnType<typeof parseMarkdownFile>;
      try { parsed = parseMarkdownFile(filePath); } catch { continue; }
      const { data, body } = parsed;
      if (data.type !== "reference" && data.type !== "reference-candidate") continue;
      if (data.library_mode === "keep") continue;
      if (!captureFailed({ body, frontmatter: data })) continue;
      const contentUrl = contentUrlFor(data, body);
      if (!contentUrl) continue;
      targets.push({ relative_path: path.relative(vaultPath, filePath), title: String(data.title || path.basename(filePath, ".md")), contentUrl });
    }
  }
  return targets;
}

function resolveTargets(): XTarget[] {
  const single = argValue("--path");
  if (single) {
    const rel = path.isAbsolute(single) ? path.relative(vaultPath, single) : single;
    const { data, body } = parseMarkdownFile(path.join(vaultPath, rel));
    const contentUrl = contentUrlFor(data, body);
    if (!contentUrl) throw new Error(`${rel} has no X content URL.`);
    return [{ relative_path: rel, title: String(data.title || rel), contentUrl }];
  }
  if (bucket) return findXStubs();
  throw new Error("Pass --path <file> or --bucket.");
}

/** `--profile` LAUNCHES the session; it must appear ONLY on the first command. Re-passing it to a
 *  running session errors ("already running with different config"), so attach calls are
 *  session-only. */
async function buLaunch(commandArgs: string[]): Promise<string> {
  const { stdout } = await execFileAsync(browserUseBin, ["--profile", profile, "--session", session, ...commandArgs], {
    timeout: 90_000, maxBuffer: 1024 * 1024 * 16,
  });
  return stdout;
}
async function buAttach(commandArgs: string[]): Promise<string> {
  const { stdout } = await execFileAsync(browserUseBin, ["--session", session, ...commandArgs], {
    timeout: 90_000, maxBuffer: 1024 * 1024 * 16,
  });
  return stdout;
}

/** Open the URL and extract its readable text, tolerating X's client-side hydration with a couple
 *  of retries (browser-use's open can return before the article paints). */
async function readXText(contentUrl: string): Promise<string> {
  if (sessionLaunched) { await buAttach(["open", contentUrl]).catch(() => ""); }
  else { await buLaunch(["open", contentUrl]).catch(() => ""); sessionLaunched = true; }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    let out: string;
    try { out = await buAttach(["eval", EXTRACT_JS]); } catch { continue; }
    const text = (out.split(/result:\s?/).pop() || "").trim();
    if (text.length >= MIN_TEXT) return text;
  }
  return "";
}

async function recoverOne(target: XTarget): Promise<"recovered" | "still_failed"> {
  const text = await readXText(target.contentUrl);
  if (text.length < MIN_TEXT) return "still_failed";

  const filePath = path.join(vaultPath, target.relative_path);
  const { data, body } = parseMarkdownFile(filePath);
  // Replace the stub inside Raw Content only; redigest rebuilds Summary/Key Points from it.
  const [head, rawTail] = body.split("## Raw Content");
  if (rawTail === undefined) return "still_failed";
  const newRaw = rawTail.replace(new RegExp(`[\\s\\S]*?${NO_SOURCE_MARKER}\\.?`), `\n\n${text}`)
    .includes(text) ? rawTail.replace(NO_SOURCE_MARKER + ".", text).replace(NO_SOURCE_MARKER, text) : `${rawTail}\n\n${text}`;
  data.source_recovered_from = `browser:${target.contentUrl}`;
  data.cached_source_chars = text.length;
  data.extracted_chars = text.length;
  fs.writeFileSync(filePath, stringifyMarkdown(data, `${head}## Raw Content${newRaw}`), "utf-8");

  // Cache-preferring redigest (no API/X refetch), then flag for the nightly weave.
  const tsxBin = fs.existsSync("node_modules/.bin/tsx") ? "node_modules/.bin/tsx" : "npx";
  const prefix = tsxBin === "npx" ? ["tsx"] : [];
  await execFileAsync(tsxBin, [...prefix, "scripts/library-redigest.ts", "--write", "--path", target.relative_path, "--limit", "1"], {
    env: { ...process.env, BRIDGE_VAULT_PATH: vaultPath, LIBRARY_CONNECTIONS_DISABLED: "1" }, maxBuffer: 1024 * 1024 * 16, timeout: 420_000,
  });
  const after = parseMarkdownFile(filePath);
  if (captureFailed({ body: after.body, frontmatter: after.data })) return "still_failed";
  after.data.reweave_pending = true;
  fs.writeFileSync(filePath, stringifyMarkdown(after.data, after.body), "utf-8");
  return "recovered";
}

async function main(): Promise<void> {
  const targets = resolveTargets();
  if (dryRun) {
    console.log(JSON.stringify({ dry_run: true, profile, count: targets.length, targets }, null, 2));
    return;
  }
  let recovered = 0;
  let failed = 0;
  try {
    for (const target of targets) {
      const outcome = await recoverOne(target);
      if (outcome === "recovered") recovered += 1; else failed += 1;
      console.error(`[x-recover] ${outcome.toUpperCase().padEnd(12)} ${target.title.slice(0, 55)}`);
    }
  } finally {
    await execFileAsync(browserUseBin, ["--session", session, "close"], { timeout: 30_000 }).catch(() => {});
  }
  console.log(JSON.stringify({ profile, attempted: targets.length, recovered, failed }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
