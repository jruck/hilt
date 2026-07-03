import fs from "fs";
import path from "path";
import { loadEnvConfig } from "@next/env";
import matter from "gray-matter";
import { detectRateLimitInEnvelope, extractModelText, resolveClaudeBin, runClaude } from "../src/lib/library/connections";
import { atomicWriteFile, isoNow } from "../src/lib/library/utils";
import { loadRegistry, loopHome } from "../src/lib/loops/registry";
import { emitLoopArtifact, defaultSandboxDir } from "../src/lib/loops/emit";
import { readUnactedVerdicts, markVerdictsActed, readUnprocessedFeedback, markFeedbackProcessed } from "../src/lib/loops/stores";
import {
  catchPhraseSpans, mintEntryId, nextSeq, openEntries, openLedgerDigest,
  readLedger, transition, writeLedger, type Ledger, type LedgerEntry,
} from "../src/lib/loops/meeting-ledger";
import { EXTRACTOR_SYSTEM, buildExtractorTask } from "../src/lib/loops/meeting-extractor-prompt";
import type { LoopItem } from "../src/lib/loops/types";

loadEnvConfig(process.cwd());

/**
 * The meeting-actions loop (Briefings v2 Phase 5 — scope §9.1): extractor → ledger → escalations.
 *
 * Per run: (0) apply unacted verdicts to the ledger; (1) find unprocessed meetings; (2) per
 * meeting: deterministic "Action item:" pre-scan + one claude extraction call with the OPEN LEDGER
 * for identity resolution; (3) apply new/sighting/closure results to the ledger; (4) emit the
 * daily artifact — new asks escalated "awaiting your verdict", aging items surfaced, deltas as
 * content. State + reports under meta/loops/meetings/ (write-guarded: sandbox while phase:shadow).
 *
 *   npx tsx scripts/loop-meeting-actions.ts [--vault <p>] [--date YYYY-MM-DD] [--as-of YYYY-MM-DD]
 *       [--meetings-file <json array of vault-relative paths>] # explicit set (eval harness)
 *       [--ledger-home <dir>]                                 # override state home (eval sandboxes)
 *       [--max-meetings N]
 */
const args = process.argv.slice(2);
const argValue = (name: string): string | null => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] || null : null; };
const vaultPath = argValue("--vault") || process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || "/Users/jruck/work/bridge";
const today = argValue("--date") || new Date().toLocaleDateString("en-CA");
const asOf = argValue("--as-of");
const maxMeetings = Number(argValue("--max-meetings") || 25);
const timeoutMs = Number(process.env.LOOP_MEETING_TIMEOUT_MS || 300_000);
/** "Recent" = still verdict-worthy: escalation + queue-priority both key off this. */
const RECENT_DAYS = 3;
const isRecentDate = (d: string): boolean => (Date.parse(today) - Date.parse(d)) / 86_400_000 <= RECENT_DAYS;
/** Backfill window (Justin, 2026-07-02): parse only meetings ≤30 days old. Older meetings'
 * commitments are mostly resolved or dead — parsing them mints open "zombie" entries that never
 * see closure evidence and bloat the identity digest riding in every extraction prompt. The
 * archive stays in the vault; widen the window here if history is ever wanted. */
const BACKFILL_DAYS = Number(process.env.LOOP_MEETING_BACKFILL_DAYS || 30);

interface ProcessedState { processed: Record<string, string>; }

function processedPath(home: string): string { return path.join(home, "state", "processed-meetings.json"); }
function readProcessed(home: string): ProcessedState {
  try { return JSON.parse(fs.readFileSync(processedPath(home), "utf-8")); } catch { return { processed: {} }; }
}
function writeProcessed(home: string, s: ProcessedState): void {
  atomicWriteFile(processedPath(home), `${JSON.stringify(s, null, 1)}\n`);
}

/** Resolve the transcript via the note's frontmatter wiki-link (authoritative — R-meet). */
function resolveTranscript(fmData: Record<string, unknown>): string | null {
  const link = typeof fmData.transcript === "string" ? fmData.transcript : "";
  const m = link.match(/\[\[(.+?)\]\]/);
  if (!m) return null;
  const rel = m[1].endsWith(".md") ? m[1] : `${m[1]}.md`;
  const abs = path.join(vaultPath, rel);
  return fs.existsSync(abs) ? abs : null;
}

function findUnprocessedMeetings(home: string): string[] {
  const processed = readProcessed(home).processed;
  const root = path.join(vaultPath, "meetings");
  const recent: string[] = []; // ≤RECENT_DAYS old — jump the queue (their asks are verdict-worthy TODAY)
  const backlog: string[] = []; // everything else drains oldest-first behind them
  const horizon = asOf || today;
  for (const dir of fs.readdirSync(root).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dir)) continue;
    if (asOf && dir > asOf) continue;
    if ((Date.parse(horizon) - Date.parse(dir)) / 86_400_000 > BACKFILL_DAYS) continue;
    const dayDir = path.join(root, dir);
    for (const f of fs.readdirSync(dayDir).sort()) {
      if (!f.endsWith(".md")) continue;
      const rel = `meetings/${dir}/${f}`;
      if (!processed[rel]) (isRecentDate(dir) ? recent : backlog).push(rel);
    }
  }
  // Recent-first, newest recent day first: without this, a 1400-meeting backlog at 25/run means
  // today's meetings wouldn't be read for two months — the loop must be useful tomorrow morning.
  recent.reverse();
  return [...recent, ...backlog];
}

const feedbackGuidanceRef = { value: "" };

interface ExtractionResult {
  meeting_summary?: string;
  new_commitments: Array<{ action: string; owner: string; due?: string; quote: string; source: string; confidence: number }>;
  sightings: Array<{ ledger_id: string; quote: string }>;
  closures: Array<{ ledger_id: string; outcome: "resolved" | "dropped"; quote: string }>;
}

/** Per-meeting summaries captured at extraction time (the extractor has the full transcript in
 * hand — a summary is one more JSON field). The artifact renders recent ones as content so the
 * briefing editor has SUBSTANCE for exactly the meetings whose asks it surfaces — without this,
 * asks from beyond gather's raw-meeting window arrive contextless ("six action items awaiting
 * your verdict" was the editor's honest best; rejected 2026-07-03). */
type MeetingSummaries = Record<string, { date: string; summary: string }>;
function summariesPath(home: string): string { return path.join(home, "state", "meeting-summaries.json"); }
function readSummaries(home: string): MeetingSummaries {
  try { return JSON.parse(fs.readFileSync(summariesPath(home), "utf-8")); } catch { return {}; }
}
function writeSummaries(home: string, s: MeetingSummaries): void {
  atomicWriteFile(summariesPath(home), `${JSON.stringify(s, null, 1)}\n`);
}
function meetingTitleFromRel(rel: string): string {
  return (rel.split("/").pop() || rel).replace(/-\d{4}-\d{2}-\d{2}[^/]*\.md$/, "").replace(/\.md$/, "");
}

async function extractMeeting(rel: string, ledger: Ledger): Promise<ExtractionResult | "rate_limited" | null> {
  const noteAbs = path.join(vaultPath, rel);
  const parsed = matter(fs.readFileSync(noteAbs, "utf-8"));
  const transcriptAbs = resolveTranscript(parsed.data as Record<string, unknown>);
  const transcript = transcriptAbs ? fs.readFileSync(transcriptAbs, "utf-8") : "(no transcript available)";
  const spans = transcriptAbs ? catchPhraseSpans(transcript) : [];

  const task = buildExtractorTask({
    meetingPath: rel,
    noteContent: parsed.content.slice(0, 20_000),
    transcriptContent: transcript.slice(0, 120_000),
    openLedgerDigest: openLedgerDigest(ledger, isoNow()),
    catchPhraseSpans: spans,
  }) + feedbackGuidanceRef.value;

  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "hilt-ma-"));
  const promptPath = path.join(dir, "system.txt");
  fs.writeFileSync(promptPath, EXTRACTOR_SYSTEM, "utf-8");
  const cliArgs = ["-p", task, "--append-system-prompt-file", promptPath, "--output-format", "json"];
  const model = process.env.LOOP_MEETING_MODEL || process.env.LIBRARY_CONNECTIONS_MODEL;
  if (model) cliArgs.push("--model", model);
  try {
    const stdout = await runClaude(resolveClaudeBin(), cliArgs, timeoutMs, vaultPath);
    if (detectRateLimitInEnvelope(stdout).limited) return "rate_limited";
    const text = extractModelText(stdout);
    const m = text.match(/\{[\s\S]*\}/);
    const parsedOut = JSON.parse(m ? m[0] : text) as ExtractionResult;
    return {
      ...(typeof parsedOut.meeting_summary === "string" && parsedOut.meeting_summary.trim()
        ? { meeting_summary: parsedOut.meeting_summary.trim().slice(0, 400) }
        : {}),
      new_commitments: Array.isArray(parsedOut.new_commitments) ? parsedOut.new_commitments : [],
      sightings: Array.isArray(parsedOut.sightings) ? parsedOut.sightings : [],
      closures: Array.isArray(parsedOut.closures) ? parsedOut.closures : [],
    };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    if (detectRateLimitInEnvelope(e?.stdout || "").limited || /usage limit|rate.?limit/i.test(e?.stderr || "")) return "rate_limited";
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const registry = loadRegistry(vaultPath);
  const loop = registry.loops.find((l) => l.id === "meeting-actions");
  if (!loop) throw new Error("meeting-actions not in registry");

  const home = argValue("--ledger-home")
    || (loop.phase === "live" ? loopHome(vaultPath, loop) : loopHome(defaultSandboxDir(), loop));
  fs.mkdirSync(path.join(home, "state"), { recursive: true });

  const ledger = readLedger(home);
  const now = isoNow();

  // 0 · Apply unacted verdicts (approve = accepted+tracked; dismiss = dropped; revise = note).
  const verdicts = readUnactedVerdicts(home);
  for (const v of verdicts) {
    const entry = ledger.entries[v.item_id];
    if (!entry) continue;
    entry.verdict = { verdict: v.verdict, at: v.created_at, ...(v.note ? { note: v.note } : {}) };
    if (v.verdict === "dismiss") transition(entry, "dropped", now, "dismissed by verdict");
    if (v.verdict === "revise" && v.note) entry.action = `${entry.action} [revised: ${v.note}]`;
  }
  if (verdicts.length) markVerdictsActed(home, verdicts.map((v) => v.id), { at: now, run_at: now });

  // 0b · Consume feedback (scope §6 flywheel, v1: read → adjust → stamp). Justin's unprocessed
  // feedback rides into every extraction call this run as calibration guidance, then gets stamped.
  // The clustering-into-proposals upgrade (library-steering pattern) lands when volume warrants.
  const feedback = readUnprocessedFeedback(home);
  const feedbackGuidance = feedback.length
    ? "\n\n=== JUSTIN'S FEEDBACK ON YOUR PRIOR OUTPUTS (calibrate to this) ===\n"
      + feedback.map((f) => `- [${f.created_at.slice(0, 10)}${f.target.item_id ? ` on ${f.target.item_id}` : ""}] ${f.text}`).join("\n")
    : "";
  feedbackGuidanceRef.value = feedbackGuidance;
  if (feedback.length) markFeedbackProcessed(home, feedback.map((f) => f.id), { at: now, run_at: now });

  // 1 · Unprocessed meetings (explicit set wins — the eval harness path). NB: meeting
  // filenames contain commas/emoji — the explicit list is a JSON file, never comma-split argv.
  const meetingsFile = argValue("--meetings-file");
  const explicit = meetingsFile ? (JSON.parse(fs.readFileSync(meetingsFile, "utf-8")) as string[]) : null;
  const queue = (explicit || findUnprocessedMeetings(home)).slice(0, maxMeetings);

  const processedState = readProcessed(home);
  const summaries = readSummaries(home);
  const opened: LedgerEntry[] = [];
  const closed: string[] = [];
  const sighted: string[] = [];
  let rateLimited = false;
  let failures = 0;

  // 2-3 · Extract + apply, meeting by meeting (sequential: the ledger digest must reflect
  // earlier meetings' entries for identity resolution across the queue).
  for (const rel of queue) {
    const result = await extractMeeting(rel, ledger);
    if (result === "rate_limited") { rateLimited = true; break; }
    if (!result) { failures += 1; continue; }
    const meetingDate = rel.match(/meetings\/(\d{4}-\d{2}-\d{2})\//)?.[1] || today;
    for (const c of result.new_commitments) {
      const id = mintEntryId(meetingDate, nextSeq(ledger, meetingDate));
      const entry: LedgerEntry = {
        id,
        action: c.action,
        owner: c.owner || "unclear",
        ...(c.due ? { due: c.due } : {}),
        citations: [{ source: rel, date: meetingDate, anchor: c.quote?.slice(0, 200) }],
        confidence: Math.max(0, Math.min(1, c.confidence ?? 0.5)),
        source: "extractor",
        status: "open",
        opened_at: now,
        opened_from: rel,
        status_history: [{ at: now, from: null, to: "open" }],
        sightings: [],
      };
      ledger.entries[id] = entry;
      opened.push(entry);
    }
    for (const s of result.sightings) {
      const entry = ledger.entries[s.ledger_id];
      if (!entry) continue;
      entry.sightings.push({ at: now, meeting: rel, ...(s.quote ? { quote: s.quote.slice(0, 200) } : {}) });
      sighted.push(s.ledger_id);
    }
    for (const c of result.closures) {
      const entry = ledger.entries[c.ledger_id];
      if (!entry || entry.status === "resolved" || entry.status === "dropped") continue;
      transition(entry, c.outcome, now, c.quote?.slice(0, 200));
      closed.push(c.ledger_id);
    }
    if (result.meeting_summary) {
      summaries[rel] = { date: meetingDate, summary: result.meeting_summary };
      writeSummaries(home, summaries);
    }
    processedState.processed[rel] = now;
    // Crash-safety: persist after EVERY meeting — a killed run keeps its completed extractions
    // (learned 2026-07-02 when a 36-meeting eval run was stopped mid-queue).
    writeLedger(home, ledger);
    writeProcessed(home, processedState);
  }

  writeLedger(home, ledger);
  writeProcessed(home, processedState);

  // 4 · Emit the artifact: pending recent asks escalated, aging items surfaced.
  const items: LoopItem[] = [];
  // Escalation policy: every OPEN, UN-VERDICTED commitment from a RECENT meeting (≤RECENT_DAYS)
  // awaits a verdict — keyed on the LEDGER, not on which run opened it (a re-run must not make
  // yesterday's pending asks vanish from the panel). Backfill/older entries never escalate here
  // (the 2026-07-02 flood, twice); they live in the ledger and surface via the aging path below
  // once accepted, or contextually later.
  // OWNERSHIP (Justin, 2026-07-03): verdicts are for JUSTIN'S commitments — "approve" means he
  // accepts the work as his. Other attendees' commitments stay in the ledger as observations
  // (closure detection, future waiting-on projections) but never demand his morning verdict.
  // `unclear` still escalates: it may be his, and correcting it doubles as extractor feedback.
  for (const e of openEntries(ledger)) {
    if (e.verdict) continue;
    if (e.owner.startsWith("other:")) continue;
    const meetingDate = e.opened_from.match(/meetings\/(\d{4}-\d{2}-\d{2})\//)?.[1] || today;
    if (!isRecentDate(meetingDate)) continue;
    items.push({
      id: e.id, loop: loop.id, kind: "action",
      title: `${e.owner === "justin" ? "" : `[${e.owner}] `}${e.action.slice(0, 140)}`,
      ...(e.citations[0]?.anchor ? { detail: `"${e.citations[0].anchor}"${e.due ? ` — due: ${e.due}` : ""}` } : {}),
      citations: e.citations,
      confidence: e.confidence,
      owner: e.owner,
      escalated: { reason: "new commitment awaiting your verdict" },
      allowed_verdicts: ["approve", "dismiss", "assign_to_me", "assign_to_agent", "revise"],
    });
  }
  // Aging = ACCEPTED commitments that are slipping. Only entries Justin approved can age-escalate
  // (an un-verdicted backfill entry is not "slipping" — it was never accepted; the first aging
  // design escalated every ≥7d open entry, which re-flooded the panel with ~600-day-old backfill
  // the moment the flood-gate above stopped the first flood). Aged from acceptance. Uncapped by
  // Justin's call (2026-07-02): the pool is self-limiting — every member is something he
  // explicitly approved, and closure removes it.
  const aging = openEntries(ledger)
    .filter((e) => e.verdict?.verdict === "approve" && !opened.includes(e))
    .map((e) => ({ e, age: Math.floor((Date.parse(now) - Date.parse(e.verdict!.at)) / 86_400_000) }))
    .filter(({ age }) => age >= 7)
    .sort((a, b) => b.age - a.age);
  for (const { e, age } of aging) {
    items.push({
      id: `${e.id}-aging`, loop: loop.id, kind: "insight",
      title: `Aging ${age}d since you accepted it: ${e.action.slice(0, 110)} (${e.owner})`,
      citations: e.citations,
      escalated: { reason: `accepted commitment open ${age} days with no closure evidence` },
    });
  }

  const open = openEntries(ledger);
  // Recent-meeting summaries ride as content: the briefing editor needs each meeting's substance
  // right where its asks surface — one entry per meeting, summary + nested asks (Justin's shape).
  const recentSummaries = Object.entries(summaries)
    .filter(([, s]) => isRecentDate(s.date))
    .sort(([, a], [, b]) => b.date.localeCompare(a.date));
  const contentBody = [
    `# Meeting Actions — ${today}`,
    "",
    "_The action ledger loop: extraction → identity-resolved ledger → verdicts. v1: every new_",
    "_commitment is verdict-gated before it counts as accepted._",
    "",
    ...(recentSummaries.length
      ? [
          "## Recent meetings",
          "",
          ...recentSummaries.map(([rel, s]) => `- **${meetingTitleFromRel(rel)}** (${s.date}): ${s.summary}`),
          "",
        ]
      : []),
    "## Ledger deltas",
    "",
    `- Meetings processed: ${queue.length}${rateLimited ? " (rate-limited mid-queue; remainder next run)" : ""}`,
    `- Opened: ${opened.length} · Sightings: ${sighted.length} · Closed: ${closed.length}`,
    `- Open entries: ${open.length}`,
    "",
    ...(opened.length ? ["### Opened", ...opened.map((e) => `- **${e.id}** (${e.owner}, conf ${e.confidence}): ${e.action}`), ""] : []),
    ...(closed.length ? ["### Closed", ...closed.map((id) => `- ${id}: ${ledger.entries[id].action.slice(0, 100)}`), ""] : []),
  ].join("\n");

  const artifact = emitLoopArtifact({
    vaultPath,
    loop,
    date: today,
    runAt: now,
    ...(asOf ? { asOf } : {}),
    items,
    health: {
      ok: !rateLimited && failures === 0,
      attempted: queue.length,
      succeeded: queue.length - failures - (rateLimited ? 1 : 0),
      coverage: queue.length ? (queue.length - failures) / queue.length : 1,
      notes: [
        rateLimited ? "rate-limited mid-queue" : "",
        failures ? `${failures} extraction failure(s)` : "",
        `${verdicts.length} verdict(s) applied`,
        feedback.length ? `${feedback.length} feedback item(s) consumed` : "",
      ].filter(Boolean).join(" · ") || "clean run",
    },
    contentBody,
  });

  console.log(JSON.stringify({
    artifact,
    ledger_home: home,
    processed: queue.length,
    opened: opened.length,
    sighted: sighted.length,
    closed: closed.length,
    open_total: open.length,
    rate_limited: rateLimited,
    failures,
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
