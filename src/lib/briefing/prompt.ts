import type { BriefingMode } from "./target-file";

/**
 * Assembles the briefing prompt for the `claude -p` runtime: the vault SKILL.md verbatim (the
 * portable judgment logic — never edited here), plus a small CALIBRATION block that enforces the
 * concision/structure discipline the parity-verification workflow found Claude under-honors vs the
 * gpt-5.5 gold, plus the mode-specific job instruction and the gathered-data block.
 *
 * The model's reply IS the briefing markdown (the script writes it), so the instruction forbids any
 * preamble/fences/commentary. Tune reference content in SKILL.md (judgment) or here (harness
 * discipline) — see MAINTAINING.md.
 */
const CALIBRATION = `# OUTPUT DISCIPLINE (harness calibration — enforce SKILL.md's concision intent)
The skill above is authoritative for WHAT to surface and the voice. These are hard output constraints a prior draft missed:
- LENGTH: typical gold dailies run ~4.0–4.6KB / gold weekend ~7KB. Tighten prose toward that; do not pad and do not dump. A thin news day (holiday week, light calendar) is legitimately a SHORT briefing — never pad to hit the band; omit empty sections instead.
- DENSITY: one idea per bullet. Headlines are a short clause, not a sentence. Sub-bullets are terse — the supporting fact + its citation, not a paragraph. No multi-thread bullets.
- NO INVENTED FACTS (non-negotiable): every factual claim must come from the gathered data. Never invent logistics, travel times, parking, context, or "helpful" specifics you were not given (a retro grade caught "Emory parking eats 20 minutes" — nothing in the data said that). Interpretation of present facts is your job; adding absent facts is fabrication.
- COUNT DISCIPLINE: if a bullet states a count or a time span ("nine meetings, 9:30–3:30"), it must match the items you actually list. Recount before writing.
- GRANULARITY: cite at exactly the granularity the data gives. A meeting filename's start timestamp doesn't tell you its length or end time ("90-minute session" and "1:45–3:00 PM" were graded fabrication); a commit subject doesn't tell you which files it touched; a save's title doesn't tell you the vendor/author ("Anthropic Agents SDK" invented from a filename — it wasn't Anthropic's). Never add durations, end times, or entity attributions you weren't given. With start times only, say "back-to-back" or "may collide" — never assert "double-booked"/"overlaps" as fact without end times.
- DERIVED DATES: when converting a relative reference ("Thursday standup", "the following week") to a date, anchor it — name the weekday, check it against today's date, and prefer quoting the relative phrase if unsure (a grade caught "Thursday standup" rendered as Friday 6/19).
- LIBRARY section: use the exact level-three module order supplied by the gatherer: \`### Recommended for you\`, optional \`### Editor's memo\`, then \`### Library health\`. Place every supplied \`rec:<episode-id>\` on its own token-only bullet line, in order; never invent, rewrite, annotate, or repeat one. For 2–3 picks, precede them with a 2–3 sentence, 40–90 word publication-style lead explaining the set's shared tension or consequence without recapping each card. Never exceed three sentences or write one sentence per pick. For one pick use 1–2 sentences and 20–45 words; for zero use only the supplied no-selection sentence. The memo appears only when the exact Saturday-anchored memo was supplied. Reproduce the deterministic health summary exactly and never substitute backlog counts.
- DAY-THESIS: lead with one governing through-line and weight the whole briefing to it, rather than parallel equal threads.
- MEMO LINK (non-negotiable, mechanical rule): any line that FEATURES the editor's memo — i.e. **bolds** a phrase containing "editor's memo" or puts it in a heading — MUST end with \`[Read the memo](/api/reports/memo)\`. Passing references (an italic citation like "*…; Editor's memo, 6/28.*", or plain prose) need no link. If there's no fresh memo, don't feature it in bold — reference it plainly or not at all.
- LIBRARY LINK (non-negotiable): when the gatherer says the dated report is available, Library health MUST end with \`[Daily library report](/api/reports/morning)\` on its own line. When unavailable, keep the supplied warning and emit no report link.
- DECISIONS (non-negotiable, both modes): when pending meeting proposals are supplied, write \`## ⏭ Decisions awaiting you\`. Choose and order the meetings editorially. Each meeting is one top-level bullet whose lead explains what happened and why the unresolved choice matters; its first sub-bullet is the exact meeting citation, followed by only that meeting's supplied task ids, one token-only backticked id per line. Do not add a \`hilt:meeting\` pill to the lead; the citation is the one join key. Never restate or closely paraphrase TaskCard titles, quotes, or details, and never write a pending count (including phrases like "one pending"). The lead must add context that remains useful when the cards are expanded. The harness preserves your context/order, verifies meeting ownership and ids, and appends any canonical proposal you omitted. Do not duplicate the queue anywhere else: Work/Closed loops must not report meeting-actions open-entry counts, escalated-item counts, or pending-action inventory. Omit the section when no pending proposals are supplied.
- WORK & PRODUCT: synthesize consequential movement across all observed local evidence: code and agent activity, Bridge project and roadmap files, meeting decisions, delivery changes, and relevant loop synthesis. Bridge's hierarchy and actual activity define eligibility; there is no configured project list. Select what matters, connect evidence across sources, and explain consequences without dumping commits or turning the section into a meeting inventory. Meeting evidence belongs here only when it materially changes the work story. Do not repeat pending-decision inventory or place task ids. Daily mode emphasizes recent movement; weekend mode uses the full gathered weekly window and direction into next week. If nothing materially moved, say so plainly rather than filling a quota.
- PILL CITATIONS: cite system objects as inline links with the \`hilt:\` scheme — \`[name](<hilt:kind/id>) — ALWAYS wrap the destination in angle brackets: vault paths contain spaces/parens which break plain links\` (kinds: \`meeting\` id = vault-relative note path, \`task\` id = \`t-YYYYMMDD-NNN\`, \`person\` id = slug, \`project\` id = vault-relative dir, \`library\` id = artifact id). The reader renders these as object pills (hover-preview + click-through). A bullet whose SINGLE citation is the object it is about carries the pill inline in the bullet's own line — no separate citation sub-line. Detail sub-bullets must be EVIDENCE (a fact, a quote, a delta, a date) — never a bare citation line that only repeats the source; the pill already carries the source. A meeting pill CARRIES its instance date inside the chip — never write a date token after a meeting pill ("[Standup](<hilt:meeting/…>) (7/7)" is wrong); the "meeting (date)" house form applies only when no pill is used. Existing join keys are unchanged: the ⏭ meeting-citation first sub-bullet, \`*loop:<id>, <date>*\`, and backticked task-id lines stay exactly as specified. Only ids present in the gathered data may appear in a hilt: link — never invent one.
- SECTIONS: keep the canonical section spine and order; omit a section only when it is genuinely empty (don't silently fold one into another).
- LINKS: report/memo links (/api/reports/*) stay on standalone link lines, never inline mid-bullet. EXCEPTION: hilt: object pills are the opposite — always inline in the bullet's own text (see PILL CITATIONS), never on their own line. Real ET times. Keep the exact footer.
- OUTPUT CHANNEL (non-negotiable): your reply text IS the briefing — return ONLY the briefing
  markdown. Never write files or use tools; the harness validates your text and writes the file
  itself. Any skill instruction about writing to a path describes the HARNESS's job, not yours.`;

const JOB: Record<BriefingMode, string> = {
  daily:
    "Generate Justin's weekday DAILY briefing. The gather output below under '# GATHERED DATA' includes mode=daily plus target_file. Follow the briefing skill's daily mode: synthesize the sections and framing rules, use goals as a relevance prior rather than a checklist, and dedupe against the prior briefings included in the gathered data.",
  weekend:
    "Generate Justin's WEEKEND briefing. The gather output below under '# GATHERED DATA' includes mode=weekend, date_range, and target_file. Follow the briefing skill's weekend mode (the wider direction-of-travel view). If an existing Saturday weekend file is included, REFRESH it only when meaningful new information warrants it — otherwise keep its content materially intact; preserve created_at and bump updated_at. Refresh Decisions from current supplied evidence while preserving substantive meeting context where it remains accurate; the harness reconciles canonical membership after your response. Include the weekend YAML frontmatter (briefing_kind, date_range.start/end, created_at, updated_at, title), then an H1 matching the frontmatter title before the first section.",
};

export function buildBriefingPrompt(mode: BriefingMode, skillText: string, gatheredData: string): string {
  return [
    '[IMPORTANT: The user has invoked the "briefing" skill. Follow its instructions exactly.]',
    "",
    skillText.trim(),
    "",
    CALIBRATION,
    "",
    `# THIS RUN`,
    JOB[mode],
    "Output ONLY the finished briefing markdown as your reply — no preamble, no explanation, no code fences. Do not write any file yourself; do not post anywhere.",
    "",
    gatheredData.trim(),
  ].join("\n");
}
