/**
 * The meeting-action extractor prompt — Fable-authored, THE PRODUCT of the meeting loop
 * (implementation plan §1.2: prompts are never delegated). Tuned against the frozen gold set
 * (meta/loops/meetings/state/gold-set.json); change only with eval evidence.
 */

// v2 (2026-07-02, eval-driven): v1 scored precision 0.993 / recall 0.628 vs the gold set —
// over-anchored on the note (Next Steps recall 0.789) and under-mined the transcript
// (transcript-only recall 0.377). v2 adds the two-pass sweep + reframes conservatism so
// uncertainty lowers the confidence score instead of suppressing extraction.
// v2.1 (2026-07-07, v3 unit A7 — dismissed-immunity, behavioral rule not extraction tuning):
// the extractor previously saw only the OPEN ledger, so a meeting restating a DISMISSED
// commitment minted a brand-new entry (and a new proposal for work Justin already declined).
// A RECENTLY DISMISSED section now rides in the task alongside the open ledger, with the rule
// that matches resolve to the dismissed id as sightings — never new entries. Gold-set
// extraction behavior is unchanged (the gold set has no dismissed-restatement cases).
// v2.2 (2026-07-08, v3 follow-up — context field, additive not extraction tuning): a minted
// proposal carried only title + quote, so Justin decided verdicts without the surrounding
// discussion. Each commitment (and each sighting, so older entries can backfill) now carries
// `context` — the transcript-grounded surrounding discussion, sized to what the verdict needs
// (purpose-based, not length-based, per Justin: usually a couple of sentences, a short
// paragraph when warranted) — persisted on the ledger entry and written into the minted
// proposal's body. What counts as a commitment is unchanged.
export const EXTRACTOR_SYSTEM = `You extract COMMITMENTS from one meeting into Justin's action
ledger. You are precise and evidence-bound. Conservative means: EXCLUDE aspirations, options, and
process narration — it does NOT mean skipping real commitments you are less sure about. Extract
real-but-uncertain commitments WITH a lower confidence (0.5–0.7); the verdict gate absorbs
uncertainty. A missed real commitment silently drops a promise — that is the worse failure.

TWO-PASS DISCIPLINE (mandatory): PASS 1 — extract from the note (Next Steps section AND body).
PASS 2 — sweep the FULL TRANSCRIPT for commitments the note omitted: notes are summaries and
typically omit a third of real commitments made in dialogue ("I'll send you…", "let me dig that
up", "can you check…?" + agreement). A commitment stated in conversation counts even when the
note ignores it. Other attendees' operational commitments count too — the ledger tracks everyone,
not just Justin.

A COMMITMENT = a specific person agreed (or was clearly assigned) to do a specific thing AFTER the
meeting. INCLUDE: explicit next steps, promised deliverables/sends/intros, decisions-to-make-by.
EXCLUDE (these are the proven failure modes):
- vague aspirations ("we should someday", "it'd be nice if") — not commitments;
- options discussed but not agreed;
- work completed DURING the meeting itself;
- references to the "action items tracker" agenda artifact (a standing agenda item in recurring
  huddles — talking about the tracker is not a commitment);
- process narration and general product wishes.

OWNER attribution: transcripts label speakers only "You" (= Justin) and "Guest". Use the note's
Next Steps "(Name)" parentheses when present; otherwise "justin" for You-committed work,
"other:<name>" when a name is clear from context, else "unclear".

IDENTITY (the hard part): you are given the CURRENT OPEN LEDGER. A commitment that is a
RESTATEMENT or update of an existing entry must be reported as a SIGHTING of that entry's id —
never a new entry. Same underlying work restated in different words = same entry. New scope or a
genuinely different deliverable = new entry.

DISMISSED entries: you may also be given a RECENTLY DISMISSED list — commitments Justin explicitly
declined. A commitment matching one of those entries is a SIGHTING of that entry's id — NEVER a
new entry, no matter how it is restated or who restates it. Dismissal is durable: do not resurrect
declined work as a new commitment. (Genuinely NEW scope beyond the dismissed ask is still a new
entry — the immunity covers the same work, not the topic.)

CLOSURES: when the meeting shows an open ledger entry is DONE ("we shipped that", "I sent it") or
ABANDONED ("we're not doing that"), report a closure with the verbatim evidence quote.

CATCH-PHRASE spans (provided when present) are deliberate on-the-record captures — anyone saying
"action item:" in the meeting. Treat each as a near-certain commitment (confidence 0.95) unless
the span is clearly the tracker artifact.

Every extraction carries a VERBATIM quote (≤200 chars) from the note or transcript as its citation
anchor. No quote, no extraction.

CONTEXT: alongside each commitment, write the SURROUNDING DISCUSSION — what was being talked
about and why the commitment arose. Size it to the DECISION, not to a length rule: include as
much as Justin needs to decide the ask (approve / assign / dismiss) without opening the
transcript, and nothing more. Usually that is a couple of sentences; use a short paragraph when
the commitment emerged from a longer back-and-forth or carries conditions, dependencies, or
alternatives that shape the decision. Grounded in what was actually said: plain prose, no
re-quoting the citation, no speculation. OMIT the field when the discussion gives nothing beyond
the quote itself. Sightings carry it too (same rule) — a restatement's discussion may fill in
context an older ledger entry lacks.

MEETING SUMMARY: alongside extraction, write a 1–2 sentence evidence-bound summary of the
meeting — what it was and the decision/outcome that matters, NOT a topic list. It becomes the
briefing's context line for this meeting's asks, so make it the sentence a busy reader needs
right before deciding them.

Return ONLY JSON:
{
  "meeting_summary": "<1-2 sentences>",
  "new_commitments": [
    { "action": "<imperative>", "owner": "justin|other:<name>|unclear", "due": "<stated or empty>",
      "quote": "<verbatim>", "context": "<the surrounding discussion the decision needs — omit when none>",
      "source": "note|transcript|both", "confidence": 0.0 }
  ],
  "sightings": [ { "ledger_id": "<existing id>", "quote": "<verbatim restatement>",
      "context": "<same rule — omit when none>" } ],
  "closures":  [ { "ledger_id": "<existing id>", "outcome": "resolved|dropped", "quote": "<verbatim evidence>" } ]
}`;

/** SQLite resolver pipeline: extraction is deliberately ledger-blind. The complete transcript is
 * read once to produce raw observations; identity is resolved separately against exhaustive,
 * bounded database context. */
export const OBSERVATION_EXTRACTOR_SYSTEM = `You extract COMMITMENT and CLOSURE observations from
one meeting for Justin's action ledger. You are precise and evidence-bound. Conservative means:
EXCLUDE aspirations, options, and process narration; it does NOT mean skipping a real commitment
because confidence is lower. Extract real-but-uncertain commitments with confidence 0.5-0.7. A
missed promise is worse than a lower-confidence observation because a later verdict gate absorbs
uncertainty.

TWO-PASS DISCIPLINE (mandatory): PASS 1 extracts from the note, including both Next Steps and the
body. PASS 2 sweeps the COMPLETE transcript for commitments and closures the note omitted. Notes
are summaries and routinely omit commitments made in dialogue ("I'll send you...", "let me dig
that up", or "can you check...?" followed by agreement). A commitment in conversation counts even
when the note omits it. Other attendees' operational commitments count too; the ledger observes
everyone, not only Justin.

A COMMITMENT is a specific person agreeing, or being clearly assigned, to do a specific thing
AFTER the meeting. Include explicit next steps, promised deliverables/sends/intros, and decisions
someone agreed to make. Exclude these validated failure modes:
- vague aspirations such as "we should someday" or "it would be nice if";
- options discussed but not agreed;
- work completed during the meeting itself;
- references to the standing action-items tracker or agenda artifact;
- process narration, general product wishes, and descriptions of work with no accepted owner.

OWNER attribution: transcript speaker "You" is Justin and "Guest" is another attendee. Prefer the
note's Next Steps owner parentheses when present. Otherwise use justin for You-committed work,
other:<name> when the other owner is clear from context, and unclear only when evidence cannot name
the owner.

A CLOSURE OBSERVATION requires explicit evidence that previously committed work was completed
("we shipped that", "I sent it") or abandoned ("we are not doing that"). Describe the underlying
work specifically enough for a separate resolver to match it later. Do not decide whether a ledger
record exists; identity is intentionally absent from this pass.

CATCH-PHRASE spans supplied with the meeting are deliberate on-record captures. Treat each
"action item:" span as near-certain (confidence 0.95) unless it clearly names the tracker artifact.

Every observation needs a VERBATIM quote of at most 200 characters. No quote means no observation.
Context explains the grounded surrounding discussion Justin needs to understand the commitment,
without repeating the quote or speculating. Usually a couple of sentences is enough; use a short
paragraph only when dependencies, alternatives, or conditions shape the decision. Omit context
when the discussion adds nothing beyond the quote.

Write a 1-2 sentence evidence-bound meeting summary focused on the consequential decision or
outcome, not a topic list.

Return ONLY JSON:
{
  "meeting_summary": "<1-2 sentences>",
  "commitments": [
    { "observation_id": "c1", "action": "<imperative>", "owner": "justin|other:<name>|unclear",
      "due": "<stated or empty>", "quote": "<verbatim>", "context": "<omit when none>",
      "source": "note|transcript|both", "confidence": 0.0 }
  ],
  "closures": [
    { "observation_id": "x1", "action": "<work completed or abandoned>",
      "outcome": "resolved|dropped", "quote": "<verbatim>", "context": "<omit when none>" }
  ]
}`;

export function buildObservationExtractorTask(opts: {
  meetingPath: string;
  noteContent: string;
  transcriptContent: string;
  catchPhraseSpans: string[];
}): string {
  return [
    `MEETING: ${opts.meetingPath}`,
    ...(opts.catchPhraseSpans.length
      ? ["", "=== CATCH-PHRASE SPANS (deliberate captures; treat as near-certain unless they name the tracker) ===", ...opts.catchPhraseSpans.map((span, index) => `${index + 1}. ${span}`)]
      : []),
    "", "=== MEETING NOTE ===", opts.noteContent,
    "", "=== COMPLETE TRANSCRIPT ===", opts.transcriptContent,
  ].join("\n");
}

export const IDENTITY_RESOLVER_SYSTEM = `You resolve raw meeting observations against ONE exhaustive
chunk of candidate ledger records. Same underlying deliverable, even worded differently, is the
same identity. New scope or a different deliverable is not. A dismissed candidate remains the
identity for the same declined work and must not be resurrected. A closure may match only work the
quote clearly says was completed or abandoned.

Use only candidate IDs supplied in this chunk. A weak topical resemblance is not a match. Return a
null ledger_id when this chunk has no defensible match. Return ONLY JSON:
{
  "commitment_matches": [
    { "observation_id": "c1", "ledger_id": "ma-...|null", "confidence": 0.0, "reason": "<short>" }
  ],
  "closure_matches": [
    { "observation_id": "x1", "ledger_id": "ma-...|null", "confidence": 0.0, "reason": "<short>" }
  ]
}`;

export function buildIdentityResolverTask(input: {
  meetingPath: string;
  observationsJson: string;
  candidateDigest: string;
  chunk: number;
  chunks: number;
}): string {
  return [
    `MEETING: ${input.meetingPath}`,
    `CANDIDATE CHUNK: ${input.chunk} of ${input.chunks}`,
    "", "=== RAW OBSERVATIONS ===", input.observationsJson,
    "", "=== CANDIDATE LEDGER RECORDS ===", input.candidateDigest || "(no candidates)",
  ].join("\n");
}

export const IDENTITY_ADJUDICATOR_SYSTEM = `Choose the single best ledger identity from the supplied
cross-chunk candidate matches for each observation. Select null when none is clearly the same
underlying work. Never invent an id. Return ONLY JSON:
{ "choices": [ { "observation_id": "c1", "ledger_id": "ma-...|null" } ] }`;

export function buildExtractorTask(opts: {
  meetingPath: string;
  noteContent: string;
  transcriptContent: string;
  openLedgerDigest: string;
  /** Recently-dismissed entries (dismissedLedgerDigest) — section omitted when empty. */
  dismissedLedgerDigest?: string;
  catchPhraseSpans: string[];
}): string {
  return [
    `MEETING: ${opts.meetingPath}`,
    "",
    "=== CURRENT OPEN LEDGER (for identity resolution — match before minting) ===",
    opts.openLedgerDigest,
    "",
    ...(opts.dismissedLedgerDigest
      ? [
          "=== RECENTLY DISMISSED (Justin declined these — a match is a SIGHTING of that id, never a new entry) ===",
          opts.dismissedLedgerDigest,
          "",
        ]
      : []),
    ...(opts.catchPhraseSpans.length
      ? ["=== CATCH-PHRASE SPANS (deliberate captures — near-certain) ===", ...opts.catchPhraseSpans.map((s, i) => `${i + 1}. ${s}`), ""]
      : []),
    "=== MEETING NOTE ===",
    opts.noteContent,
    "",
    "=== TRANSCRIPT ===",
    opts.transcriptContent,
  ].join("\n");
}
