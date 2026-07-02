import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { loadEnvConfig } from "@next/env";
import { detectRateLimitInEnvelope, extractModelText, resolveClaudeBin, runClaude } from "../src/lib/library/connections";
import { isoNow } from "../src/lib/library/utils";
import { loadRegistry, loopHome } from "../src/lib/loops/registry";
import { emitLoopArtifact, defaultSandboxDir } from "../src/lib/loops/emit";
import { openEntries, readLedger } from "../src/lib/loops/meeting-ledger";
import type { LoopItem } from "../src/lib/loops/types";

loadEnvConfig(process.cwd());
const execFileAsync = promisify(execFile);

/**
 * The goals/areas alignment loop (Briefings v2 Phase 6 — scope §9.4): accountability.
 * STATED priorities (areas/index.md North Stars + area goals, via the existing goal-context
 * builder) vs. OBSERVED attention over the trailing window (git commits, meeting titles +
 * next-steps, the action ledger, library saves). One claude call produces the alignment read;
 * contradictions escalate WITH EVIDENCE. Never enumerates every goal — surfaces only what
 * advanced, got blocked, or contradicts (the SKILL.md relevance-prior rule, carried over).
 *
 * DERIVED loop: reads other loops' state + cheap deterministic sources; barely touches raw vault.
 *
 *   npx tsx scripts/loop-goals-areas.ts [--vault <p>] [--date YYYY-MM-DD] [--as-of YYYY-MM-DD] [--window-days 7]
 */
const args = process.argv.slice(2);
const argValue = (name: string): string | null => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] || null : null; };
const vaultPath = argValue("--vault") || process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || "/Users/jruck/work/bridge";
const today = argValue("--date") || new Date().toLocaleDateString("en-CA");
const asOf = argValue("--as-of");
const windowDays = Number(argValue("--window-days") || 7);
const timeoutMs = Number(process.env.LOOP_GOALS_TIMEOUT_MS || 240_000);

const REPOS = [vaultPath, "/Users/jruck/work/engineering/me/hilt", `${vaultPath}/libraries/everpro`, `${vaultPath}/libraries/priceless-misc`];

function daysAgo(base: string, n: number): string {
  const d = new Date(`${base}T12:00:00`);
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("en-CA");
}

async function statedPriorities(): Promise<string> {
  try {
    const tsxBin = fs.existsSync("node_modules/.bin/tsx") ? "node_modules/.bin/tsx" : "npx";
    const prefix = tsxBin === "npx" ? ["tsx"] : [];
    const { stdout } = await execFileAsync(tsxBin, [...prefix, "scripts/briefing-goal-context.ts"], {
      env: { ...process.env, BRIDGE_VAULT_PATH: vaultPath }, timeout: 60_000, maxBuffer: 1024 * 1024 * 4,
    });
    return stdout.trim();
  } catch {
    // Fallback: the raw index.
    try { return fs.readFileSync(path.join(vaultPath, "areas", "index.md"), "utf-8"); } catch { return "(areas/index.md unavailable)"; }
  }
}

async function observedGit(since: string, until: string): Promise<string> {
  const chunks: string[] = [];
  for (const repo of REPOS) {
    try {
      const { stdout } = await execFileAsync("git", ["-C", repo, "log", `--since=${since} 00:00`, `--until=${until} 23:59`, "--pretty=  %ad %s", "--date=short"], { timeout: 20_000, maxBuffer: 1024 * 1024 * 2 });
      if (stdout.trim()) chunks.push(`## ${path.basename(repo)}\n${stdout.trim().split("\n").slice(0, 40).join("\n")}`);
    } catch { /* repo absent on this machine */ }
  }
  return chunks.join("\n") || "(no commits in window)";
}

function observedMeetings(since: string, until: string): string {
  const root = path.join(vaultPath, "meetings");
  const lines: string[] = [];
  try {
    for (const dir of fs.readdirSync(root).sort()) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dir) || dir < since || dir > until) continue;
      for (const f of fs.readdirSync(path.join(root, dir))) {
        if (f.endsWith(".md")) lines.push(`- ${dir}: ${f.replace(/-\d{4}-.*$/, "")}`);
      }
    }
  } catch { /* none */ }
  return lines.slice(0, 60).join("\n") || "(no meetings in window)";
}

function observedLedger(): string {
  const registry = loadRegistry(vaultPath);
  const ma = registry.loops.find((l) => l.id === "meeting-actions");
  if (!ma) return "(no meeting-actions loop)";
  const home = ma.phase === "live" ? loopHome(vaultPath, ma) : loopHome(defaultSandboxDir(), ma);
  const ledger = readLedger(home);
  const open = openEntries(ledger);
  return open.length
    ? open.slice(0, 40).map((e) => `- [${e.owner}] ${e.action.slice(0, 100)} (opened ${e.opened_at.slice(0, 10)})`).join("\n")
    : "(action ledger empty)";
}

function observedLibrary(since: string, until: string): string {
  const dir = path.join(vaultPath, "references");
  const lines: string[] = [];
  try {
    for (const f of fs.readdirSync(dir).sort()) {
      const d = f.slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d >= since && d <= until && f.endsWith(".md")) {
        lines.push(`- ${f.replace(/\.md$/, "").slice(0, 90)}`);
      }
    }
  } catch { /* none */ }
  return lines.slice(0, 30).join("\n") || "(no saves in window)";
}

const GOALS_SYSTEM = `You are the goals/areas alignment analyst for Justin's knowledge system. Given
his STATED priorities (North Stars + area goals) and the OBSERVED attention evidence from the
trailing window, produce an honest alignment read.

Rules (non-negotiable):
- Goals are a relevance prior, NOT a checklist. Do NOT enumerate every goal or report "no progress"
  unless the absence itself is decision-relevant (a top "now" priority with zero attention IS
  decision-relevant; a long-term goal idling is not).
- Every claim cites evidence from the observed data (commit subjects, meeting titles, ledger
  entries, saves). No evidence, no claim.
- CONTRADICTIONS are the payload: a stated top priority with no observed attention across the
  window, or heavy attention on something absent from any stated priority (drift). State them
  plainly with the evidence.

Return ONLY JSON:
{ "alignment": [ { "priority": "<north star / goal>", "evidence": ["<cited observation>"], "read": "advancing|blocked|idle-ok|contradiction" } ],
  "contradictions": [ { "title": "<one line>", "detail": "<2-3 sentences with evidence>", "severity": "high|medium" } ],
  "drift": [ { "title": "<attention sink not in stated priorities>", "evidence": ["<cited>"] } ],
  "summary": "<3-4 sentence direction-of-travel read>" }`;

async function main(): Promise<void> {
  const registry = loadRegistry(vaultPath);
  const loop = registry.loops.find((l) => l.id === "goals-areas");
  if (!loop) throw new Error("goals-areas not in registry");

  const until = asOf || today;
  const since = daysAgo(until, windowDays);
  const [stated, git] = await Promise.all([statedPriorities(), observedGit(since, until)]);
  const meetings = observedMeetings(since, until);
  const ledger = observedLedger();
  const library = observedLibrary(since, until);

  const task = [
    `WINDOW: ${since} → ${until}`,
    "", "=== STATED PRIORITIES ===", stated,
    "", "=== OBSERVED: git commits ===", git,
    "", "=== OBSERVED: meetings ===", meetings,
    "", "=== OBSERVED: open action ledger ===", ledger,
    "", "=== OBSERVED: library saves ===", library,
  ].join("\n");

  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "hilt-goals-"));
  const promptPath = path.join(dir, "system.txt");
  fs.writeFileSync(promptPath, GOALS_SYSTEM, "utf-8");
  let parsed: any = null;
  let rateLimited = false;
  try {
    const stdout = await runClaude(resolveClaudeBin(), ["-p", task, "--append-system-prompt-file", promptPath, "--output-format", "json"], timeoutMs, vaultPath);
    if (detectRateLimitInEnvelope(stdout).limited) rateLimited = true;
    else {
      const text = extractModelText(stdout);
      const m = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : text);
    }
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    if (detectRateLimitInEnvelope(e?.stdout || "").limited || /rate.?limit|usage limit/i.test(e?.stderr || "")) rateLimited = true;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const items: LoopItem[] = [];
  if (parsed) {
    (parsed.contradictions || []).forEach((c: any, i: number) => {
      items.push({
        id: `ga-${until}-contra-${i + 1}`, loop: loop.id, kind: "insight",
        title: String(c.title || "").slice(0, 140),
        detail: String(c.detail || "").slice(0, 400),
        citations: [{ source: "areas/index.md" }],
        ...(c.severity === "high" ? { escalated: { reason: "stated priority contradicted by observed attention" } } : {}),
      });
    });
    (parsed.drift || []).forEach((d: any, i: number) => {
      items.push({
        id: `ga-${until}-drift-${i + 1}`, loop: loop.id, kind: "insight",
        title: `Drift: ${String(d.title || "").slice(0, 120)}`,
        detail: (d.evidence || []).join(" · ").slice(0, 300),
        citations: [{ source: "areas/index.md" }],
      });
    });
  }

  const contentBody = [
    `# Goals / Areas Alignment — ${until}`,
    "",
    `_Stated priorities vs. observed attention, ${since} → ${until}. Derived loop: reads other`,
    "_loops' state + commit/meeting/library evidence. Goals are a relevance prior, not a checklist._",
    "",
    "## Direction of travel",
    "",
    parsed?.summary || (rateLimited ? "_(rate-limited this run)_" : "_(analysis failed this run)_"),
    "",
    "## Alignment",
    "",
    ...(parsed?.alignment?.length
      ? parsed.alignment.map((a: any) => `- **${a.priority}** — ${a.read}${a.evidence?.length ? ` · ${a.evidence[0]}` : ""}`)
      : ["_(none)_"]),
    "",
  ].join("\n");

  const artifact = emitLoopArtifact({
    vaultPath, loop, date: until, runAt: isoNow(),
    ...(asOf ? { asOf } : {}),
    items,
    health: {
      ok: Boolean(parsed),
      coverage: parsed ? 1 : 0,
      notes: rateLimited ? "rate-limited" : parsed ? `${(parsed.alignment || []).length} priorities read, ${items.length} findings` : "analysis call failed",
    },
    contentBody,
  });

  console.log(JSON.stringify({ artifact, findings: items.length, rate_limited: rateLimited, ok: Boolean(parsed) }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
