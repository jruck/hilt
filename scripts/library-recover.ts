import fs from "fs";
import path from "path";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { loadEnvConfig } from "@next/env";
import { parseMarkdownFile, stringifyMarkdown } from "../src/lib/library/markdown";
import { CANDIDATE_CACHE_DIR } from "../src/lib/library/candidate-cache";
import { walkMarkdown } from "../src/lib/library/utils";
import { captureFailed, loginWallVerdict } from "../src/lib/library/capture-health";

loadEnvConfig(process.cwd());
const execFileAsync = promisify(execFile);

/**
 * On-demand authenticated-browser recovery for login-walled articles (LinkedIn pulse, and any item
 * digestion flagged `needs_auth_recovery` — a capture that was only a sign-in wall with no real article
 * under it). Mirrors `library-x-recover.ts` but is SOURCE-AGNOSTIC: it drives `browser-harness`, which
 * attaches to a REAL, already-logged-in Chrome on the recovery host (whatever signed-in profile is
 * running) — no separate login, no stored credential, no rate-limit risk. It reads the article text with
 * a deterministic in-page `js()` extract (no LLM), caches it with provenance, redigests, and stamps
 * reweave_pending for the nightly weave. The shared `loginWallVerdict` (capture-health) is the reject
 * gate, so this surface and X-recover detect the same walls and can't drift.
 *
 * MANUAL ONLY — it drives the live Chrome, so it must not run unattended in the nightly drain.
 *
 *   npm run library:recover -- --path references/<file>.md
 *   npm run library:recover -- --bucket            # every needs_auth_recovery item in the vault
 *   ... --dry-run                                   # list targets without touching the browser
 *
 * Requires browser-harness on PATH (override with BROWSER_HARNESS_BIN) and a one-time CDP authorize in
 * Chrome (click Allow on chrome://inspect) on the recovery host. The user must be signed in to the
 * target site (e.g. LinkedIn) in that Chrome.
 */

const args = process.argv.slice(2);
const argValue = (name: string): string | null => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] || null : null; };
const vaultPath = argValue("--vault") || process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd();
const bucket = args.includes("--bucket");
const dryRun = args.includes("--dry-run");
const browserHarnessBin = process.env.BROWSER_HARNESS_BIN || "browser-harness";

const MIN_TEXT = 200;
// Generic readable-article extractor: query article/main/reader containers (incl. LinkedIn pulse and
// the X article view) and keep the LONGEST readable candidate, so leading sign-in chrome and nav don't
// win over the body. The TS-side loginWallVerdict gate is the final arbiter.
const EXTRACT_JS = "(function(){function c(s){return (s||'').replace(/\\n{3,}/g,'\\n\\n').trim();}function texts(sels){var xs=[];sels.forEach(function(sel){try{document.querySelectorAll(sel).forEach(function(el){var t=c(el.innerText);if(t)xs.push(t);});}catch(e){}});xs.sort(function(a,b){return b.length-a.length;});return xs;}var sels=['article','[role=article]','[data-testid=twitterArticleRichTextView]','.reader-content','.article-content','[class*=article-content]','[class*=reader-article]','main','[role=main]'];var best=texts(sels);if(best[0])return best[0];return c(document.body&&document.body.innerText);})()";

interface RecoverTarget { relative_path: string; title: string; contentUrl: string }

function contentUrlFor(data: Record<string, unknown>): string | null {
  const url = String(data.url || "");
  return /^https?:\/\//i.test(url) ? url : null;
}

/** The cached source text from the Raw Content `<details>` block (what was captured). */
function rawContentSection(body: string): string {
  const match = body.match(/^##\s+Raw Content\s*$/mi);
  if (!match || match.index === undefined) return "";
  const after = body.slice(match.index + match[0].length);
  const next = after.search(/\n##\s+/);
  return (next >= 0 ? after.slice(0, next) : after).replace(/<\/?details>|<summary>[\s\S]*?<\/summary>/gi, "").trim();
}

/** Items that are specifically LOGIN-WALLED: digestion-flagged needs_auth_recovery, or (legacy, pre-flag)
 *  whose Raw Content is chrome-only by the shared loginWallVerdict. Deliberately NOT every captureFailed
 *  item — t.co/X stubs route to X-recover/refetch, not general browser recovery. Skips `keep` items. */
function findRecoverTargets(): RecoverTarget[] {
  const targets: RecoverTarget[] = [];
  for (const root of ["references", CANDIDATE_CACHE_DIR]) {
    for (const filePath of walkMarkdown(path.join(vaultPath, root), { includeHidden: root.includes(".cache") })) {
      let parsed: ReturnType<typeof parseMarkdownFile>;
      try { parsed = parseMarkdownFile(filePath); } catch { continue; }
      const { data, body } = parsed;
      if (data.type !== "reference" && data.type !== "reference-candidate") continue;
      if (data.library_mode === "keep") continue;
      let walled = data.needs_auth_recovery === true;
      if (!walled) {
        const rc = rawContentSection(body);
        if (rc) { const v = loginWallVerdict(rc); walled = v.isWall && !v.hasRealContent; }
      }
      if (!walled) continue;
      const contentUrl = contentUrlFor(data);
      if (!contentUrl) continue;
      targets.push({ relative_path: path.relative(vaultPath, filePath), title: String(data.title || path.basename(filePath, ".md")), contentUrl });
    }
  }
  return targets;
}

function resolveTargets(): RecoverTarget[] {
  const single = argValue("--path");
  if (single) {
    const rel = path.isAbsolute(single) ? path.relative(vaultPath, single) : single;
    const { data } = parseMarkdownFile(path.join(vaultPath, rel));
    const contentUrl = contentUrlFor(data);
    if (!contentUrl) throw new Error(`${rel} has no http(s) content URL.`);
    return [{ relative_path: rel, title: String(data.title || rel), contentUrl }];
  }
  if (bucket) return findRecoverTargets();
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

/** Open the URL in a fresh tab and extract its readable text, tolerating client-side hydration with a
 *  few retries (the page can report "loaded" before the article paints). Extraction runs in the browser
 *  via EXTRACT_JS; the snippet keeps the longest result across retries, then closes the tab. The shared
 *  loginWallVerdict gate (TS side) is the final arbiter — recovered text that's still a wall is rejected. */
async function readArticleText(contentUrl: string): Promise<string> {
  const hasArticle = "(function(){return !!document.querySelector('article, [role=article], [data-testid=twitterArticleRichTextView], main, [role=main]');})()";
  const py = [
    "import os, time, json",
    "tid = new_tab(os.environ['BH_URL'])",
    "wait_for_load()",
    "extract = os.environ['BH_EXTRACT']",
    `has_article = ${JSON.stringify(hasArticle)}`,
    "best = ''",
    "fallback = ''",
    "for _ in range(8):",
    "    time.sleep(3)",
    "    try:",
    "        ready = bool(js(has_article))",
    "    except Exception:",
    "        ready = False",
    "    try:",
    "        t = js(extract) or ''",
    "    except Exception:",
    "        t = ''",
    "    if ready and len(t) >= 400:",
    "        best = t",
    "        break",
    "    if len(t) > len(fallback):",
    "        fallback = t",
    "try:",
    "    cdp('Target.closeTarget', targetId=tid)",
    "except Exception:",
    "    pass",
    "print(json.dumps({'text': best or fallback}))",
  ].join("\n");
  let out: string;
  try { out = await runHarness(py, { BH_URL: contentUrl, BH_EXTRACT: EXTRACT_JS }); }
  catch { return ""; }
  const jsonLine = out.trim().split("\n").reverse().find((line) => line.trim().startsWith("{"));
  if (!jsonLine) return "";
  let text = "";
  try { text = String((JSON.parse(jsonLine) as { text?: unknown }).text || ""); } catch { return ""; }
  // Usable = a real article survives the login-wall strip (shared verdict). Rejects a page that's still
  // just a sign-in gate after recovery.
  return text.length >= MIN_TEXT && loginWallVerdict(text).hasRealContent ? text : "";
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

async function recoverOne(target: RecoverTarget): Promise<"recovered" | "still_failed"> {
  const text = await readArticleText(target.contentUrl);
  if (text.length < MIN_TEXT) return "still_failed";

  const filePath = path.join(vaultPath, target.relative_path);
  const { data, body } = parseMarkdownFile(filePath);
  const nextBody = replaceRawContentSection(body, text);
  if (!nextBody) return "still_failed";
  data.source_recovered_from = `browser:${target.contentUrl}`;
  data.cached_source_chars = text.length;
  data.extracted_chars = text.length;
  fs.writeFileSync(filePath, stringifyMarkdown(data, nextBody), "utf-8");

  // Cache-preferring redigest (no network refetch) summarizes the recovered text; then flag for the
  // nightly weave. The redigest clears needs_auth_recovery once the content is no longer chrome-only.
  const tsxBin = fs.existsSync("node_modules/.bin/tsx") ? "node_modules/.bin/tsx" : "npx";
  const prefix = tsxBin === "npx" ? ["tsx"] : [];
  await execFileAsync(tsxBin, [...prefix, "scripts/library-redigest.ts", "--write", "--path", target.relative_path, "--limit", "1"], {
    env: { ...process.env, BRIDGE_VAULT_PATH: vaultPath, LIBRARY_CONNECTIONS_DISABLED: "1" }, maxBuffer: 1024 * 1024 * 16, timeout: 420_000,
  });
  const after = parseMarkdownFile(filePath);
  if (captureFailed({ body: after.body, frontmatter: after.data })) return "still_failed";
  clearStaleJudgmentFields(after.data);
  after.data.reweave_pending = true;
  delete after.data.needs_auth_recovery;
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
    console.error(`[recover] ${outcome.toUpperCase().padEnd(12)} ${target.title.slice(0, 55)}`);
  }
  console.log(JSON.stringify({ tool: "browser-harness", attempted: targets.length, recovered, failed }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
