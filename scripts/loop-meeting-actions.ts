import fs from "fs";
import path from "path";
import { loadEnvConfig } from "@next/env";
import matter from "gray-matter";
import { detectRateLimitInEnvelope, extractModelText, resolveClaudeBin, runClaude } from "../src/lib/library/connections";
import { isoNow } from "../src/lib/library/utils";
import { loadRegistry, loopHome } from "../src/lib/loops/registry";
import { emitLoopArtifact, defaultSandboxDir } from "../src/lib/loops/emit";
import { readUnactedVerdicts, markVerdictsActed, readUnprocessedFeedback } from "../src/lib/loops/stores";
import { runThreadHealthPass, renderFeedbackHandledSection } from "../src/lib/loops/health-pass";
import {
  catchPhraseSpans, cleanExtractedContext, fillContextIfEmpty,
  normalizeActionText, restoreDismissedEntry, transition, type LedgerEntry, type LedgerStatus,
} from "../src/lib/loops/meeting-ledger";
import {
  buildIdentityResolverTask,
  buildObservationExtractorTask,
  IDENTITY_ADJUDICATOR_SYSTEM,
  IDENTITY_RESOLVER_SYSTEM,
  OBSERVATION_EXTRACTOR_SYSTEM,
} from "../src/lib/loops/meeting-extractor-prompt";
import { formatLedgerDigest, openMeetingLedgerRuntime } from "../src/lib/loops/meeting-ledger-runtime";
import { acquireMeetingLedgerLock, emitMeetingLedgerChanged, type IdentityContextSelection } from "../src/lib/loops/meeting-ledger-store";
import { mintProposalFromLedgerEntry, resolveProposalSink } from "../src/lib/loops/proposal-mint";
import type { LoopItem } from "../src/lib/loops/types";

loadEnvConfig(process.cwd());

/**
 * The meeting-actions loop (Briefings v2 Phase 5 — scope §9.1): extractor → ledger → escalations.
 *
 * Per run: (0) apply unacted verdicts to the ledger; (1) find unprocessed meetings; (2) per
 * meeting: deterministic "Action item:" pre-scan + a complete-transcript observation pass followed
 * by exhaustive, chunked SQLite identity resolution; (3) apply new/sighting/closure results to the ledger; (4) emit the
 * daily artifact — new asks escalated "awaiting your verdict", aging items surfaced, deltas as
 * content. State + reports under meta/loops/meetings/ (write-guarded: sandbox while phase:shadow).
 *
 *   npx tsx scripts/loop-meeting-actions.ts [--vault <p>] [--date YYYY-MM-DD] [--as-of YYYY-MM-DD]
 *       [--meetings-file <json array of vault-relative paths>] # explicit set (eval harness)
 *       [--ledger-home <dir>]                                 # override state home (eval sandboxes)
 *       [--max-meetings N]
 *       [--proposals-dir <dir>] [--no-proposals]              # proposal sink override / kill switch
 *
 * Proposal files (v3 unit A6): every ask that ESCALATES also mints a task proposal file (status
 * `proposed`) into the resolved sink — precedence: --proposals-dir → <ledger-home>/proposals/ →
 * registry proposal_sink:"vault" → <loopHome>/proposals/. The ledger entry is stamped `task_id`
 * so re-runs never re-mint (and a dismissed proposal's deleted file never resurrects). This run
 * owns the LEDGER; the verdict API route owns the proposal FILE effects (approve/dismiss/revise).
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
const recentSummaryStart = new Date(Date.parse(today) - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
/** Backfill window (Justin, 2026-07-02): parse only meetings ≤30 days old. Older meetings'
 * commitments are mostly resolved or dead — parsing them mints open "zombie" entries that never
 * see closure evidence and bloat the identity digest riding in every extraction prompt. The
 * archive stays in the vault; widen the window here if history is ever wanted. */
const BACKFILL_DAYS = Number(process.env.LOOP_MEETING_BACKFILL_DAYS || 30);

/** Resolve the transcript via the note's frontmatter wiki-link (authoritative — R-meet). */
function resolveTranscript(fmData: Record<string, unknown>): string | null {
  const link = typeof fmData.transcript === "string" ? fmData.transcript : "";
  const m = link.match(/\[\[(.+?)\]\]/);
  if (!m) return null;
  const rel = m[1].endsWith(".md") ? m[1] : `${m[1]}.md`;
  const abs = path.join(vaultPath, rel);
  return fs.existsSync(abs) ? abs : null;
}

function findUnprocessedMeetings(processed: Record<string, string>): string[] {
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
  // `context` (v2.2) is advisory prose — cleanExtractedContext validates/caps it at apply time,
  // and its absence is never an error (older extractions and thin transcripts omit it).
  new_commitments: Array<{ action: string; owner: string; due?: string; quote: string; context?: string; source: string; confidence: number }>;
  sightings: Array<{ ledger_id: string; quote: string; context?: string }>;
  closures: Array<{ ledger_id: string; outcome: "resolved" | "dropped"; quote: string }>;
}

interface CommitmentObservation {
  observation_id: string;
  action: string;
  owner: string;
  due?: string;
  quote: string;
  context?: string;
  source: string;
  confidence: number;
}

interface ClosureObservation {
  observation_id: string;
  action: string;
  outcome: "resolved" | "dropped";
  quote: string;
  context?: string;
}

interface ObservationExtraction {
  meeting_summary?: string;
  commitments: CommitmentObservation[];
  closures: ClosureObservation[];
}

interface IdentityMatch {
  observation_id: string;
  ledger_id: string | null;
  confidence: number;
  reason?: string;
}

/** Per-meeting summaries captured at extraction time (the extractor has the full transcript in
 * hand — a summary is one more JSON field). The artifact renders recent ones as content so the
 * briefing editor has SUBSTANCE for exactly the meetings whose asks it surfaces — without this,
 * asks from beyond gather's raw-meeting window arrive contextless ("six action items awaiting
 * your verdict" was the editor's honest best; rejected 2026-07-03). */
type MeetingSummaries = Record<string, { date: string; summary: string }>;
function meetingTitleFromRel(rel: string): string {
  return (rel.split("/").pop() || rel).replace(/-\d{4}-\d{2}-\d{2}[^/]*\.md$/, "").replace(/\.md$/, "");
}

function parseJsonObject(stdout: string): Record<string, unknown> {
  const text = extractModelText(stdout);
  const match = text.match(/\{[\s\S]*\}/);
  const value = JSON.parse(match ? match[0] : text) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("model output is not a JSON object");
  return value as Record<string, unknown>;
}

async function runModelJson(input: {
  system: string;
  task: string;
  prefix: string;
  addDir?: string;
}): Promise<Record<string, unknown> | "rate_limited" | null> {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", input.prefix));
  const promptPath = path.join(dir, "system.txt");
  fs.writeFileSync(promptPath, input.system, "utf-8");
  const cliArgs = ["-p", input.task, "--append-system-prompt-file", promptPath, "--output-format", "json"];
  if (input.addDir) cliArgs.push("--allowed-tools", "Read", "--permission-mode", "default", "--add-dir", input.addDir);
  const model = process.env.LOOP_MEETING_MODEL || process.env.LIBRARY_CONNECTIONS_MODEL;
  if (model) cliArgs.push("--model", model);
  try {
    const stdout = await runClaude(resolveClaudeBin(), cliArgs, timeoutMs, vaultPath);
    if (detectRateLimitInEnvelope(stdout).limited) return "rate_limited";
    return parseJsonObject(stdout);
  } catch (error) {
    const carrier = error as { stdout?: string; stderr?: string };
    if (detectRateLimitInEnvelope(carrier.stdout || "").limited || /usage limit|rate.?limit/i.test(carrier.stderr || "")) return "rate_limited";
    console.warn(`[loop-meeting-actions] ${input.prefix} model call failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function extractMeetingObservations(rel: string): Promise<ObservationExtraction | "rate_limited" | null> {
  const noteAbs = path.join(vaultPath, rel);
  // A malformed note (broken frontmatter, unreadable file) must degrade to a per-meeting
  // failure — an uncaught throw here killed the whole run AND left the bad meeting unprocessed,
  // wedging every subsequent run behind it (adversarial finding, 2026-07-07).
  let parsed: ReturnType<typeof matter>;
  let transcript = "(no transcript available)";
  let spans: ReturnType<typeof catchPhraseSpans> = [];
  try {
    parsed = matter(fs.readFileSync(noteAbs, "utf-8"));
    const transcriptAbs = resolveTranscript(parsed.data as Record<string, unknown>);
    if (transcriptAbs) {
      transcript = fs.readFileSync(transcriptAbs, "utf-8");
      spans = catchPhraseSpans(transcript);
    }
  } catch (err) {
    console.warn(`[loop-meeting-actions] skipping unreadable meeting ${rel}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  // Pass paths instead of embedding/truncating the transcript in argv. Claude's Read tool must
  // consume the complete files; this keeps large meetings exhaustive without hitting ARG_MAX.
  const sourceDir = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "hilt-ma-source-"));
  const notePath = path.join(sourceDir, "note.md");
  const transcriptPath = path.join(sourceDir, "transcript.md");
  fs.writeFileSync(notePath, parsed.content, "utf-8");
  fs.writeFileSync(transcriptPath, transcript, "utf-8");
  try {
    const task = buildObservationExtractorTask({
      meetingPath: rel,
      noteContent: `Read the complete note at ${notePath}`,
      transcriptContent: `Read the complete transcript at ${transcriptPath}; do not sample or truncate it.`,
      catchPhraseSpans: spans,
    }) + feedbackGuidanceRef.value;
    const output = await runModelJson({ system: OBSERVATION_EXTRACTOR_SYSTEM, task, prefix: "hilt-ma-observe-", addDir: sourceDir });
    if (output === "rate_limited" || output === null) return output;
    const commitments = (Array.isArray(output.commitments) ? output.commitments : []).flatMap((raw, index) => {
      const value = raw as Partial<CommitmentObservation>;
      if (!value.action?.trim() || !value.quote?.trim()) return [];
      return [{
        observation_id: `c${index + 1}`,
        action: value.action.trim(),
        owner: value.owner?.trim() || "unclear",
        ...(value.due?.trim() ? { due: value.due.trim() } : {}),
        quote: value.quote.trim().slice(0, 200),
        ...(cleanExtractedContext(value.context) ? { context: cleanExtractedContext(value.context)! } : {}),
        source: value.source || "transcript",
        confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0.5)),
      }];
    });
    const closures = (Array.isArray(output.closures) ? output.closures : []).flatMap((raw, index) => {
      const value = raw as Partial<ClosureObservation>;
      if (!value.action?.trim() || !value.quote?.trim() || !["resolved", "dropped"].includes(value.outcome || "")) return [];
      return [{
        observation_id: `x${index + 1}`,
        action: value.action.trim(),
        outcome: value.outcome as "resolved" | "dropped",
        quote: value.quote.trim().slice(0, 200),
        ...(cleanExtractedContext(value.context) ? { context: cleanExtractedContext(value.context)! } : {}),
      }];
    });
    return {
      ...(typeof output.meeting_summary === "string" && output.meeting_summary.trim()
        ? { meeting_summary: output.meeting_summary.trim().slice(0, 400) }
        : {}),
      commitments,
      closures,
    };
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
}

function matchRows(output: Record<string, unknown>, key: "commitment_matches" | "closure_matches"): IdentityMatch[] {
  return (Array.isArray(output[key]) ? output[key] : []).flatMap((raw) => {
    const value = raw as Partial<IdentityMatch>;
    if (typeof value.observation_id !== "string") return [];
    const ledgerId = typeof value.ledger_id === "string" && value.ledger_id !== "null" ? value.ledger_id : null;
    return [{
      observation_id: value.observation_id,
      ledger_id: ledgerId,
      confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0)),
      ...(typeof value.reason === "string" ? { reason: value.reason.slice(0, 240) } : {}),
    }];
  });
}

async function resolveMeetingIdentity(input: {
  rel: string;
  observations: ObservationExtraction;
  context: IdentityContextSelection;
}): Promise<ExtractionResult | "rate_limited" | null> {
  const allObservations = [...input.observations.commitments, ...input.observations.closures];
  const observationById = new Map(allObservations.map((value) => [value.observation_id, value]));
  const candidateById = new Map(
    [...input.context.required, ...input.context.older_matches].map((value) => [value.id, value]),
  );
  const proposed = new Map<string, Map<string, number>>();
  const chunks = input.context.chunks;

  // Every context chunk is examined. A null from one chunk does not settle the observation; the
  // union is adjudicated only after all recent, mandatory old, dismissal, and older-match records
  // have had a chance to claim identity.
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const allowed = new Set(chunk.map((entry) => entry.id));
    const output = await runModelJson({
      system: IDENTITY_RESOLVER_SYSTEM,
      task: buildIdentityResolverTask({
        meetingPath: input.rel,
        observationsJson: JSON.stringify({ commitments: input.observations.commitments, closures: input.observations.closures }),
        candidateDigest: formatLedgerDigest(chunk, isoNow()),
        chunk: index + 1,
        chunks: chunks.length,
      }),
      prefix: "hilt-ma-resolve-",
    });
    if (output === "rate_limited" || output === null) return output;
    for (const match of [...matchRows(output, "commitment_matches"), ...matchRows(output, "closure_matches")]) {
      if (!observationById.has(match.observation_id) || !match.ledger_id || !allowed.has(match.ledger_id) || match.confidence < 0.55) continue;
      const bucket = proposed.get(match.observation_id) ?? new Map<string, number>();
      bucket.set(match.ledger_id, Math.max(bucket.get(match.ledger_id) ?? 0, match.confidence));
      proposed.set(match.observation_id, bucket);
    }
  }

  // Deterministic exact normalized action identity is authoritative, including dismissed records.
  for (const observation of allObservations) {
    for (const candidate of candidateById.values()) {
      if (normalizeActionText(candidate.action) !== normalizeActionText(observation.action)) continue;
      const bucket = proposed.get(observation.observation_id) ?? new Map<string, number>();
      bucket.set(candidate.id, 1);
      proposed.set(observation.observation_id, bucket);
    }
  }

  const chosen = new Map<string, string>();
  const ambiguous: Array<{ observation: CommitmentObservation | ClosureObservation; candidates: LedgerEntry[] }> = [];
  for (const observation of allObservations) {
    const candidates = [...(proposed.get(observation.observation_id) ?? new Map()).entries()]
      .sort((a, b) => b[1] - a[1]);
    if (candidates.length === 1) chosen.set(observation.observation_id, candidates[0][0]);
    else if (candidates.length > 1) ambiguous.push({
      observation,
      candidates: candidates.flatMap(([id]) => candidateById.get(id) ? [candidateById.get(id)!] : []),
    });
  }
  if (ambiguous.length) {
    const output = await runModelJson({
      system: IDENTITY_ADJUDICATOR_SYSTEM,
      task: JSON.stringify(ambiguous.map((value) => ({
        observation: value.observation,
        candidates: value.candidates.map((entry) => ({ id: entry.id, action: entry.action, owner: entry.owner, status: entry.status, context: entry.context ?? null })),
      }))),
      prefix: "hilt-ma-adjudicate-",
    });
    if (output === "rate_limited" || output === null) return output;
    for (const raw of Array.isArray(output.choices) ? output.choices : []) {
      const value = raw as { observation_id?: unknown; ledger_id?: unknown };
      if (typeof value.observation_id !== "string" || typeof value.ledger_id !== "string") continue;
      const options = proposed.get(value.observation_id);
      if (options?.has(value.ledger_id)) chosen.set(value.observation_id, value.ledger_id);
    }
  }

  return {
    ...(input.observations.meeting_summary ? { meeting_summary: input.observations.meeting_summary } : {}),
    new_commitments: input.observations.commitments
      .filter((observation) => !chosen.has(observation.observation_id))
      .map(({ observation_id: _id, ...observation }) => observation),
    sightings: input.observations.commitments.flatMap((observation) => {
      const ledgerId = chosen.get(observation.observation_id);
      return ledgerId ? [{ ledger_id: ledgerId, quote: observation.quote, ...(observation.context ? { context: observation.context } : {}) }] : [];
    }),
    closures: input.observations.closures.flatMap((observation) => {
      const ledgerId = chosen.get(observation.observation_id);
      return ledgerId ? [{ ledger_id: ledgerId, outcome: observation.outcome, quote: observation.quote }] : [];
    }),
  };
}

async function main(): Promise<void> {
  const registry = loadRegistry(vaultPath);
  const loop = registry.loops.find((l) => l.id === "meeting-actions");
  if (!loop) throw new Error("meeting-actions not in registry");

  const ledgerHomeOverride = argValue("--ledger-home");
  const home = ledgerHomeOverride
    || (loop.phase === "live" ? loopHome(vaultPath, loop) : loopHome(defaultSandboxDir(), loop));
  fs.mkdirSync(path.join(home, "state"), { recursive: true });

  // Proposal sink (A6): flags beat registry beats shadow default — see resolveProposalSink.
  const noProposals = args.includes("--no-proposals");
  const proposalSink = resolveProposalSink({
    proposalsDirFlag: argValue("--proposals-dir"),
    ledgerHomeFlag: ledgerHomeOverride,
    ...(loop.proposal_sink ? { registryProposalSink: loop.proposal_sink } : {}),
    vaultPath,
    loopHome: home,
  });

  const now = isoNow();
  const runId = `meeting-actions:${now}`;
  const lock = await acquireMeetingLedgerLock({
    vaultPath,
    ledgerHomeOverride,
    label: runId,
    timeoutMs: timeoutMs + 60_000,
  });
  try {
    const ledger = openMeetingLedgerRuntime({
      vaultPath,
      legacyHome: home,
      ledgerHomeOverride,
      forceSqlite: args.includes("--sqlite"),
    });
    let runFinished = false;
    ledger.beginRun({ id: runId, startedAt: now });
    try {

  // 0 · Apply unacted verdicts (approve/assign = accepted+tracked; dismiss = dropped;
  // revise = correction, NOT a decision: the action text updates and the entry stays
  // UN-verdicted so it RE-ESCALATES revised for a real approve/dismiss — a correction must
  // not end the conversation (caught by Justin 2026-07-03).
  const verdicts = readUnactedVerdicts(home);
  const verdictEntries: LedgerEntry[] = [];
  for (const v of verdicts) {
    const entry = ledger.getEntry(v.item_id);
    if (!entry) continue;
    if (v.verdict === "restore") {
      restoreDismissedEntry(entry, now);
      verdictEntries.push(entry);
      continue;
    }
    if (v.verdict === "revise") {
      if (v.note) entry.action = `${entry.action} [revised: ${v.note}]`;
      delete entry.verdict;
      verdictEntries.push(entry);
      continue;
    }
    entry.verdict = { verdict: v.verdict, at: v.created_at, ...(v.note ? { note: v.note } : {}) };
    if (v.verdict === "dismiss") transition(entry, "dropped", now, "dismissed by verdict");
    verdictEntries.push(entry);
  }
  if (verdictEntries.length) {
    ledger.applyEntries(verdictEntries, { type: "verdict-applied", at: now, runId });
    markVerdictsActed(home, verdicts.map((v) => v.id), { at: now, run_at: now });
  }

  // 0b · Consume feedback (scope §6 flywheel, v1: read → adjust → stamp). Justin's unprocessed
  // feedback rides into every extraction call this run as calibration guidance, then gets stamped.
  // The clustering-into-proposals upgrade (library-steering pattern) lands when volume warrants.
  const feedback = readUnprocessedFeedback(home);
  const feedbackGuidance = feedback.length
    ? "\n\n=== JUSTIN'S FEEDBACK ON YOUR PRIOR OUTPUTS (calibrate to this) ===\n"
      + feedback.map((f) => `- [${f.created_at.slice(0, 10)}${f.target.item_id ? ` on ${f.target.item_id}` : ""}] ${f.text}`).join("\n")
    : "";
  feedbackGuidanceRef.value = feedbackGuidance;
  // C3: the health pass replaces the bare markFeedbackProcessed stamp — every consumed thread
  // also gets a visible agent reply + "calibrated" resolution (the record of consumption).
  const feedbackHandled = runThreadHealthPass({ loopId: loop.id, home, now, runAt: now });

  // 1 · Unprocessed meetings (explicit set wins — the eval harness path). NB: meeting
  // filenames contain commas/emoji — the explicit list is a JSON file, never comma-split argv.
  const meetingsFile = argValue("--meetings-file");
  const explicit = meetingsFile ? (JSON.parse(fs.readFileSync(meetingsFile, "utf-8")) as string[]) : null;
  const queue = (explicit || findUnprocessedMeetings(ledger.processedMeetings())).slice(0, maxMeetings);

  // The report only renders recent summaries. Keep that query bounded as the processed-meeting
  // history grows; summaries for meetings handled in this run are added below before rendering.
  const summaries = ledger.meetingSummaries(recentSummaryStart, today);
  const opened: LedgerEntry[] = [];
  const closed: string[] = [];
  const sighted: string[] = [];
  let rateLimited = false;
  let failures = 0;
  let identityContextTokens = 0;
  let identityChunks = 0;

  // Dismissed-immunity backstop (v3 unit A7, belt-and-suspenders under the prompt rule): if the
  // extractor emits as NEW a commitment whose action exactly matches a recently-dismissed entry,
  // fold it as a SIGHTING of that entry instead of minting. Exact normalized-text match only —
  // fuzzy identity is the extractor's job; this catches the literal-restatement miss. The set is
  // stable across the queue: dismiss-verdict drops land only in pass 0 above (mid-queue closure
  // drops carry no dismiss verdict).
  const dismissedEntries = ledger.recentlyDismissed(now);
  const dismissedByAction = new Map(dismissedEntries.map((entry) => [normalizeActionText(entry.action), entry]));

  // 2-3 · Extract + apply, meeting by meeting (sequential: the ledger digest must reflect
  // earlier meetings' entries for identity resolution across the queue).
  for (const rel of queue) {
    const observations = await extractMeetingObservations(rel);
    if (observations === "rate_limited") { rateLimited = true; break; }
    if (!observations) { failures += 1; continue; }
    const lookupTerms = [...observations.commitments, ...observations.closures]
      .flatMap((value) => [
        value.action,
        `${value.action} ${value.context ?? ""} ${"owner" in value ? value.owner : ""} ${rel}`,
      ]);
    const context = ledger.identityContext({ now: isoNow(), observations: lookupTerms, tokenBudget: 40_000 });
    identityContextTokens += context.estimated_tokens;
    identityChunks += context.chunks.length;
    const result = await resolveMeetingIdentity({ rel, observations, context });
    if (result === "rate_limited") { rateLimited = true; break; }
    if (!result) { failures += 1; continue; }
    const meetingDate = rel.match(/meetings\/(\d{4}-\d{2}-\d{2})\//)?.[1] || today;
    const firstId = ledger.nextEntryId(meetingDate);
    let nextSequence = Number(firstId.slice(firstId.lastIndexOf("-") + 1));
    const nextId = () => `ma-${meetingDate}-${String(nextSequence++).padStart(3, "0")}`;
    const changed = new Map<string, LedgerEntry>();
    for (const c of result.new_commitments) {
      const dismissedTwin = dismissedByAction.get(normalizeActionText(c.action || ""));
      if (dismissedTwin) {
        dismissedTwin.sightings.push({ at: now, meeting: rel, ...(c.quote ? { quote: c.quote.slice(0, 200) } : {}) });
        fillContextIfEmpty(dismissedTwin, c.context);
        changed.set(dismissedTwin.id, dismissedTwin);
        sighted.push(dismissedTwin.id);
        continue;
      }
      const context = cleanExtractedContext(c.context);
      const id = nextId();
      const entry: LedgerEntry = {
        id,
        action: c.action,
        owner: c.owner || "unclear",
        ...(c.due ? { due: c.due } : {}),
        ...(context ? { context } : {}),
        citations: [{ source: rel, date: meetingDate, anchor: c.quote?.slice(0, 200) }],
        confidence: Math.max(0, Math.min(1, c.confidence ?? 0.5)),
        source: "extractor",
        status: "open",
        opened_at: now,
        opened_from: rel,
        status_history: [{ at: now, from: null, to: "open" }],
        sightings: [],
      };
      changed.set(id, entry);
      opened.push(entry);
    }
    // Sightings record EVIDENCE only — never a status change. A sighting on a dropped/resolved
    // entry (the dismissed-immunity path routes restatements of declined work here) appends to
    // the entry's receipts and nothing else: dropped entries never reopen, never re-escalate
    // (escalation + aging iterate openEntries, which excludes them), never re-mint (task_id
    // stamp + verdict both persist).
    for (const s of result.sightings) {
      const entry = changed.get(s.ledger_id) ?? ledger.getEntry(s.ledger_id);
      if (!entry) continue;
      entry.sightings.push({ at: now, meeting: rel, ...(s.quote ? { quote: s.quote.slice(0, 200) } : {}) });
      // A restatement's discussion may supply the context an older entry lacks (pre-v2.2
      // entries have none) — filled only when empty, never overwriting existing prose.
      fillContextIfEmpty(entry, s.context);
      changed.set(entry.id, entry);
      sighted.push(s.ledger_id);
    }
    for (const c of result.closures) {
      const entry = changed.get(c.ledger_id) ?? ledger.getEntry(c.ledger_id);
      if (!entry || entry.status === "resolved" || entry.status === "dropped") continue;
      transition(entry, c.outcome, now, c.quote?.slice(0, 200));
      changed.set(entry.id, entry);
      closed.push(c.ledger_id);
    }
    if (result.meeting_summary) {
      summaries[rel] = { date: meetingDate, summary: result.meeting_summary };
    }
    if (process.env.HILT_MEETING_LEDGER_CRASH_BEFORE_COMMIT === rel) {
      process.kill(process.pid, "SIGKILL");
    }
    // One transaction owns the entry changes, meeting summary, and processed marker. A killed
    // worker therefore commits the whole meeting or none of it.
    ledger.applyMeeting({
      meeting: rel,
      processedAt: now,
      entries: [...changed.values()],
      ...(result.meeting_summary ? { summary: summaries[rel] } : {}),
      runId,
      eventType: "meeting-extraction-applied",
    });
    if (!ledgerHomeOverride && ledger.mode === "sqlite") {
      emitMeetingLedgerChanged(vaultPath, { storage: "sqlite", meeting: rel, run_id: runId });
    }
  }

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
  const proposalsMinted: string[] = [];
  let proposalFailures = 0;
  // First-touch always escalates (Justin, 2026-07-10): an ask EXTRACTED THIS RUN reaches the
  // queue even when its meeting has aged past RECENT_DAYS — a days-late first extraction (the
  // trigger AND nightly both failed for a stretch) must never park work ledger-only and
  // invisible. The flood-gate keeps holding for entries opened by PRIOR runs that never met
  // the recency bar (the 2026-07-02 backfill flood).
  const openedThisRun = new Set(opened.map((entry) => entry.id));
  // SQLite returns detached entry objects. A commitment opened early in this batch may be closed
  // by a later meeting, so never let the original `opened` snapshot override canonical state here.
  // The legacy JSON runtime happened to share object references and masked this stale-reopen bug.
  const currentOpened = [...openedThisRun]
    .map((id) => ledger.getEntry(id))
    .filter((entry): entry is LedgerEntry => Boolean(entry));
  const escalationCandidates = new Map(
    [...ledger.escalationCandidates(today, RECENT_DAYS), ...currentOpened]
      .map((entry) => [entry.id, entry]),
  );
  for (const e of escalationCandidates.values()) {
    if (!(["open", "carried"] as LedgerStatus[]).includes(e.status)) continue;
    if (e.verdict) continue;
    if (e.owner.startsWith("other:")) continue;
    const meetingDate = e.opened_from.match(/meetings\/(\d{4}-\d{2}-\d{2})\//)?.[1] || today;
    // Recency admits an ask to the queue; ONCE IN, it stays until decided (first_escalated_at) —
    // 2026-07-06: a holiday weekend aged 15 undecided asks out of the panel silently. Backfill
    // entries that never met the recency bar stay latent (the flood-gate holds).
    if (!isRecentDate(meetingDate) && !e.first_escalated_at && !openedThisRun.has(e.id)) continue;
    let changed = false;
    if (!e.first_escalated_at) { e.first_escalated_at = now; changed = true; }
    // A6: an escalated ask ALSO becomes a proposal task file in the resolved sink (the volume
    // gates above carry over for free — only entries that reach this line ever mint). Entries
    // with a task_id stamp never re-mint, even when the file is gone (dismiss deleted it
    // deliberately; a revise re-escalation reuses the same file). A mint failure must not sink
    // the run — the ask still escalates; the file catches up next run.
    if (!noProposals && !e.task_id) {
      try {
        const minted = mintProposalFromLedgerEntry(e, { sink: proposalSink, loopId: loop.id, vaultPath, now, idDate: today });
        if (minted) {
          proposalsMinted.push(minted.id);
          changed = true;
        }
      } catch (error) {
        proposalFailures += 1;
        console.error(`[loop-meeting-actions] proposal mint failed for ${e.id}:`, error);
      }
    }
    // Persist the escalation/task stamp before rendering. Proposal minting also reconciles an
    // existing file by origin id, so a crash on either side of this transaction cannot duplicate
    // the proposal on the next run.
    if (changed) ledger.applyEntries([e], { type: "proposal-escalated", at: now, runId });
    items.push({
      id: e.id, loop: loop.id, kind: "action",
      title: `${e.owner === "justin" ? "" : `[${e.owner}] `}${e.action.slice(0, 140)}`,
      ...(e.citations[0]?.anchor ? { detail: `"${e.citations[0].anchor}"${e.due ? ` — due: ${e.due}` : ""}` } : {}),
      citations: e.citations,
      confidence: e.confidence,
      owner: e.owner,
      escalated: { reason: "new commitment awaiting your verdict" },
      allowed_verdicts: ["approve", "dismiss", "assign_to_me", "assign_to_agent", "revise"],
      // B3 canvas contract: expose the minted proposal's task id so the briefing editor can
      // place it — the reader UI renders a live TaskCard where the id sits.
      ...(e.task_id ? { task_id: e.task_id } : {}),
    });
  }
  // Aging = ACCEPTED commitments that are slipping. Only entries Justin approved can age-escalate
  // (an un-verdicted backfill entry is not "slipping" — it was never accepted; the first aging
  // design escalated every ≥7d open entry, which re-flooded the panel with ~600-day-old backfill
  // the moment the flood-gate above stopped the first flood). Aged from acceptance. Uncapped by
  // Justin's call (2026-07-02): the pool is self-limiting — every member is something he
  // explicitly approved, and closure removes it.
  const aging = ledger.acceptedAging(now, 7)
    .filter(({ entry }) => entry.verdict?.verdict === "approve" && !openedThisRun.has(entry.id))
    .map(({ entry, age }) => ({ e: entry, age }))
    .sort((a, b) => b.age - a.age);
  for (const { e, age } of aging) {
    items.push({
      id: `${e.id}-aging`, loop: loop.id, kind: "insight",
      title: `Aging ${age}d since you accepted it: ${e.action.slice(0, 110)} (${e.owner})`,
      citations: e.citations,
      escalated: { reason: `accepted commitment open ${age} days with no closure evidence` },
    });
  }

  const counts = ledger.counts();
  const openTotal = counts.open + counts.carried;
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
    `- Open entries: ${openTotal}`,
    "",
    ...(opened.length ? ["### Opened", ...opened.map((e) => `- **${e.id}** (${e.owner}, conf ${e.confidence}): ${e.action}`), ""] : []),
    ...(closed.length ? ["### Closed", ...closed.map((id) => `- ${id}: ${(ledger.getEntry(id)?.action || "entry unavailable").slice(0, 100)}`), ""] : []),
    ...(feedbackHandled.consumed ? [renderFeedbackHandledSection(feedbackHandled).trimEnd(), ""] : []),
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
        feedbackHandled.consumed ? `${feedbackHandled.consumed} feedback thread(s) consumed` : "",
        proposalsMinted.length ? `${proposalsMinted.length} proposal file(s) minted (${proposalSink.kind} sink)` : "",
        proposalFailures ? `${proposalFailures} proposal mint failure(s)` : "",
        identityContextTokens ? `${identityContextTokens} estimated identity-context tokens across ${identityChunks} exhaustive chunk(s)` : "",
      ].filter(Boolean).join(" · ") || "clean run",
    },
    contentBody,
  });

  ledger.finishRun({
    id: runId,
    finishedAt: isoNow(),
    status: rateLimited || failures ? "partial" : "succeeded",
    attempted: queue.length,
    succeeded: queue.length - failures - (rateLimited ? 1 : 0),
    contextTokens: identityContextTokens,
    ...(rateLimited ? { error: "rate-limited mid-queue" } : failures ? { error: `${failures} extraction failure(s)` } : {}),
  });
  runFinished = true;
  await ledger.finishSuccessfulRun(vaultPath, home, new Date(now));

  console.log(JSON.stringify({
    artifact,
    ledger_home: home,
    processed: queue.length,
    opened: opened.length,
    sighted: sighted.length,
    closed: closed.length,
    ledger_storage: ledger.mode,
    open_total: openTotal,
    rate_limited: rateLimited,
    failures,
    proposal_sink: noProposals ? null : { dir: proposalSink.dir, kind: proposalSink.kind },
    proposals_minted: proposalsMinted.length,
    proposal_failures: proposalFailures,
    identity_context_tokens: identityContextTokens,
    identity_chunks: identityChunks,
  }, null, 2));
    } catch (error) {
      if (!runFinished) {
        try {
          ledger.finishRun({
            id: runId,
            finishedAt: isoNow(),
            status: "failed",
            attempted: 0,
            succeeded: 0,
            contextTokens: 0,
            error: error instanceof Error ? error.message : String(error),
          });
        } catch { /* preserve the original failure; an active row remains crash evidence */ }
      }
      throw error;
    } finally {
      ledger.close();
    }
  } finally {
    lock.release();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
