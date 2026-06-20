import fs from "fs";
import path from "path";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { loadEnvConfig } from "@next/env";
import { parseMarkdownFile, stringifyMarkdown } from "../src/lib/library/markdown";
import { CANDIDATE_CACHE_DIR } from "../src/lib/library/candidate-cache";
import { walkMarkdown } from "../src/lib/library/utils";
import { captureFailed } from "../src/lib/library/capture-health";

loadEnvConfig(process.cwd());
const execFileAsync = promisify(execFile);

/**
 * On-demand browser recovery for login-walled X content (X Articles, protected posts) the API and
 * Wayback can't reach. Drives `browser-harness`, which attaches to a REAL, already-logged-in Chrome
 * (whatever signed-in profile is running on the recovery host) — so there is no separate login, no
 * stored credential, no rate-limit risk. It reads the post/article text with a deterministic in-page
 * `js()` extract (no LLM call), caches it with provenance, redigests, and stamps reweave_pending for
 * the nightly weave.
 *
 * MANUAL ONLY — it drives the live Chrome, so it must not run unattended in the nightly drain (that
 * would fight the user's browser). Run it when present:
 *
 *   npm run library:x:recover -- --path references/<x-stub>.md
 *   npm run library:x:recover -- --bucket           # every X-url stub in the needs_refetch bucket
 *   ... --dry-run                                    # list targets without touching the browser
 *
 * Requires browser-harness on PATH (override with BROWSER_HARNESS_BIN) and a one-time CDP authorize
 * in Chrome (click Allow on chrome://inspect) on the recovery host.
 */

const args = process.argv.slice(2);
const argValue = (name: string): string | null => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] || null : null; };
const vaultPath = argValue("--vault") || process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd();
const bucket = args.includes("--bucket");
const dryRun = args.includes("--dry-run");
// browser-harness attaches to the user's already-running Chrome (whatever profile is open), reading a
// Python snippet on stdin. It replaced the old `browser-use` CLI; the profile is no longer selectable
// here — it's whichever signed-in Chrome is running on the recovery host.
const browserHarnessBin = process.env.BROWSER_HARNESS_BIN || "browser-harness";

const X_URL_RE = /^https?:\/\/(www\.)?(x|twitter)\.com\//i;
// Accept any non-trivial extractor hit (>=80 chars): tweets are legitimately short, and the
// extractor only reads tweet/article selectors — a login wall or deleted post returns empty.
const MIN_TEXT = 80;
const MIN_PROSE_WORDS = 6;
// The DOM extractor returns the longest readable article/main/body candidate. Recovery rejects
// link-metadata stubs below, so early X hydration cannot pass a t.co wrapper as real content.
const EXTRACT_JS = "(function(){function c(s){return (s||'').replace(/\\n{3,}/g,'\\n\\n').trim();}function texts(sels){var xs=[];sels.forEach(function(sel){document.querySelectorAll(sel).forEach(function(el){var t=c(el.innerText);if(t)xs.push(t);});});xs.sort(function(a,b){return b.length-a.length;});return xs;}var article=texts(['[data-testid=twitterArticleRichTextView]','article','[role=article]']);if(article[0])return article[0];var main=texts(['main']);if(main[0])return main[0];return c(document.body&&document.body.innerText);})()";

interface XTarget { relative_path: string; title: string; contentUrl: string }

/** The URL whose TEXT we want: an X Article link in the body if present (the link-share case),
 *  else the item's own post URL. */
function contentUrlFor(data: Record<string, unknown>, body: string): string | null {
  const stamped = typeof data.x_article_url === "string" ? data.x_article_url : null;
  if (stamped) return stamped;
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

/** Run a Python snippet through browser-harness (helpers like new_tab/js/cdp are pre-imported; the
 *  daemon auto-starts and attaches to the running Chrome). The script is piped on stdin. */
function runHarness(pythonScript: string, extraEnv: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(browserHarnessBin, [], { env: { ...process.env, ...extraEnv } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `browser-harness exited ${code}`))));
    child.stdin.write(pythonScript);
    child.stdin.end();
  });
}

function proseWordCount(text: string): number {
  const stripped = text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, " ")
    .replace(/\b(Author|Published|Links|Link|Source|via)\s*:/gi, " ");
  return (stripped.match(/\b[A-Za-z]{3,}\b/g) || []).length;
}

function isUsableRecoveredText(text: string): boolean {
  if (/(Something went wrong|Try reloading|This post is unavailable|This Post is from an account that no longer exists|These posts are protected|Hmm\.\.\.this page doesn.?t exist|Sign in to X|Log in to X|Sign up for X|Don.?t miss what.?s happening|JavaScript is not available|Continue with (Google|Apple|phone|Email|username)|By continuing, you agree to our Terms of Service|Download the X app|Ads info|X for Business|©\s*\d{4}\s+X Corp)/i.test(text)) {
    return false;
  }
  return text.length >= MIN_TEXT && proseWordCount(text) >= MIN_PROSE_WORDS;
}

/** Open the URL in a fresh tab and extract its readable text, tolerating X's client-side hydration
 *  with a few retries (the page can report "loaded" before the article paints). Extraction runs in
 *  the browser via EXTRACT_JS; the snippet keeps the longest result across retries, then closes the
 *  tab. The TS-side isUsableRecoveredText gate (length + prose words + login-wall rejection) is the
 *  final arbiter — the snippet only short-circuits early once the text is clearly a full article. */
async function readXText(contentUrl: string): Promise<string> {
  const py = [
    "import os, time, json",
    "tid = new_tab(os.environ['BH_URL'])",
    "wait_for_load()",
    "extract = os.environ['BH_EXTRACT']",
    "best = ''",
    "for _ in range(4):",
    "    time.sleep(4)",
    "    try:",
    "        t = js(extract) or ''",
    "    except Exception:",
    "        t = ''",
    "    if len(t) > len(best):",
    "        best = t",
    "    if len(best) >= 800:",
    "        break",
    "try:",
    "    cdp('Target.closeTarget', targetId=tid)",
    "except Exception:",
    "    pass",
    "print(json.dumps({'text': best}))",
  ].join("\n");
  let out: string;
  try { out = await runHarness(py, { BH_URL: contentUrl, BH_EXTRACT: EXTRACT_JS }); }
  catch { return ""; }
  // browser-harness may print a daemon/update banner before our JSON line; take the last JSON object.
  const jsonLine = out.trim().split("\n").reverse().find((line) => line.trim().startsWith("{"));
  if (!jsonLine) return "";
  let text = "";
  try { text = String((JSON.parse(jsonLine) as { text?: unknown }).text || ""); } catch { return ""; }
  return isUsableRecoveredText(text) ? text : "";
}

function replaceRawContentSection(body: string, text: string): string | null {
  const match = body.match(/^##\s+Raw Content\s*$/mi);
  if (!match || match.index === undefined) return null;
  const sectionStart = match.index + match[0].length;
  const afterHeading = body.slice(sectionStart);
  const nextHeading = afterHeading.search(/\n##\s+/);
  const sectionEnd = nextHeading >= 0 ? sectionStart + nextHeading : body.length;
  const replacement = `\n\n<details>\n<summary>Full source cache</summary>\n\n${text.trim()}\n\n</details>\n`;
  return `${body.slice(0, sectionStart)}${replacement}${body.slice(sectionEnd)}`;
}

function clearStaleJudgmentFields(data: Record<string, unknown>): void {
  for (const key of [
    "connected_projects",
    "connection_suggestions",
    "connection_reasoning",
    "reconnected_at",
    "reweave_candidates",
    "attention_judgment",
    "substance",
    "substance_reason",
    "substance_version",
    "substance_graded_at",
  ]) {
    delete data[key];
  }
}

async function recoverOne(target: XTarget): Promise<"recovered" | "still_failed"> {
  const text = await readXText(target.contentUrl);
  if (text.length < MIN_TEXT) return "still_failed";

  const filePath = path.join(vaultPath, target.relative_path);
  const { data, body } = parseMarkdownFile(filePath);
  // Replace exactly the Raw Content section; redigest rebuilds Summary/Key Points from it.
  const nextBody = replaceRawContentSection(body, text);
  if (!nextBody) return "still_failed";
  data.source_recovered_from = `browser:${target.contentUrl}`;
  data.cached_source_chars = text.length;
  data.extracted_chars = text.length;
  fs.writeFileSync(filePath, stringifyMarkdown(data, nextBody), "utf-8");

  // Cache-preferring redigest (no API/X refetch), then flag for the nightly weave.
  const tsxBin = fs.existsSync("node_modules/.bin/tsx") ? "node_modules/.bin/tsx" : "npx";
  const prefix = tsxBin === "npx" ? ["tsx"] : [];
  await execFileAsync(tsxBin, [...prefix, "scripts/library-redigest.ts", "--write", "--path", target.relative_path, "--limit", "1"], {
    env: { ...process.env, BRIDGE_VAULT_PATH: vaultPath, LIBRARY_CONNECTIONS_DISABLED: "1" }, maxBuffer: 1024 * 1024 * 16, timeout: 420_000,
  });
  const after = parseMarkdownFile(filePath);
  if (captureFailed({ body: after.body, frontmatter: after.data })) return "still_failed";
  clearStaleJudgmentFields(after.data);
  after.data.reweave_pending = true;
  fs.writeFileSync(filePath, stringifyMarkdown(after.data, after.body), "utf-8");
  return "recovered";
}

async function main(): Promise<void> {
  const targets = resolveTargets();
  if (dryRun) {
    console.log(JSON.stringify({ dry_run: true, tool: "browser-harness", count: targets.length, targets }, null, 2));
    return;
  }
  let recovered = 0;
  let failed = 0;
  for (const target of targets) {
    const outcome = await recoverOne(target);
    if (outcome === "recovered") recovered += 1; else failed += 1;
    console.error(`[x-recover] ${outcome.toUpperCase().padEnd(12)} ${target.title.slice(0, 55)}`);
  }
  console.log(JSON.stringify({ tool: "browser-harness", attempted: targets.length, recovered, failed }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
