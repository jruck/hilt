# Reference Library Pipeline Versions

> **This is a NON-EXECUTABLE historical record.** The ONLY live summarization skill is
> `src/lib/library/pipeline.ts` (which re-exports the active prompt files). Previous pipeline
> versions are **NOT kept as runnable files** — there is no `pipeline-v1.2.ts`, no archived prompt
> copies, nothing to import. Every prior version lives in **git history**. This document exists so a
> human (or an agent) can read *what each version did and why* without spelunking diffs, and can jump
> to the right git ref to recover the exact code.

## How versioning works

The Reference Library digest + connection + reweave logic is a **single versioned skill**:
`src/lib/library/pipeline.ts` plus the prompt files it re-exports (`reweave-prompt.ts`,
`connection-prompt.ts`) and the digestion glue in `digestion.ts` / `connections.ts`.

**Integers vs decimals:**

- An **integer** version (`v1`, `v2`, …) is a protocol that has been **published at scale** — rolled
  out across the whole library via a full backfill. It is the "of record" baseline most items carry.
- A **decimal** version (`v1.1`, `v1.2`, …) is a **test / iteration** generation — reviewed on a small
  batch in the **Updated** lane, *not* yet rolled out. Bump the decimal each iteration.
- **Promotion:** when a decimal is blessed and backfilled across the library, it becomes the next
  **integer** (e.g. `v1.3` → `v2`), and that integer is the new baseline.

The item badge tells you everything at a glance: a **decimal badge = "from an experiment under
review,"** an **integer badge = "the published standard."** Every ingested item is **stamped** with
the `PIPELINE_VERSION` that produced it (`pipeline_version` on the durable reference and the candidate,
surfaced on `LibraryArtifact`) — the provenance trail.

## The generation cycle (run this on every pipeline change)

1. **Edit** the prompt(s)/logic in `pipeline.ts` / `reweave-prompt.ts` / `connection-prompt.ts`.
2. **Bump** `PIPELINE_VERSION` — a **decimal** for a test iteration, an **integer** for a full-library
   publish.
3. **Add an entry** to this file (the durable history).
4. **Write `docs/review-notes/<version>.md`** — the card shown atop the Updated lane. A `# Title`
   (the generation's human name) + a brief body. Make it **specific, not generic** — the reviewer
   already knows the common-sense bar. A good note says:
   - **What changed since the last review** — the concrete deltas of *this* generation.
   - **What we were fixing in the first place** — name the actual prior failures (specific phrases /
     items), so the reviewer can verify "is that gone now?" rather than re-deriving the bar.
   - **What's still open** — the known weakness this pass did *not* address, called out as the thing
     to flag.
   Cut anything the reviewer would treat as obvious. End with a plain reference to this registry for
   fuller history (it is a repo doc, so it is NOT linkable from the vault-scoped Docs tab — reference
   it by path, don't fake a link).
5. **Cut the batch:** `npx tsx scripts/library-reweave.ts --write --review-batch <label> --path …`
   (it stamps the version on every item **and** carries `docs/review-notes/<version>.md` into the
   review queue, so the card shows up automatically). `--review-note <path>` overrides the default
   note location.

Old versions are **never** kept as parallel runnable files. When the logic changes, the file is edited
in place and the previous behavior is recovered from git. Mapping each version to a git ref (below) is
how you "run" an old version: check out the ref.

**Current = `v2.6` — a source-description discipline TEST iteration over the published `v2`
baseline.** It keeps the v2 digest voice and v2.5 embedded-video recovery, while narrowing the
frontmatter `description` to an evergreen account of the source itself. Timing, personal context,
active-work references, and recommendation language belong only to a recommendation episode's
`why_now`. `v2` through `v2.5` remain current-compatible because existing good notes do not need
regeneration.

## Version history

| Version | Class | One-line summary | Git ref (approx.) |
|---------|-------|------------------|-------------------|
| v1 | **published baseline** | Digest era: `summarize`-CLI `DIGEST_PROMPT` (+ heuristic origin) + chrome stripping + cached-source reuse; token-overlap (later partly LLM-rejudged) connections. What the bulk of the ~600 refs carry. | `a19cb02`, `739c58f`, `d3b27f3` (2026-05-27 → 05-29) |
| v1.1 | test | LLM-judgment connections (`judgeConnections`), token overlap removed | `d3b27f3` (2026-05-29) |
| v1.2 | test | Unified **reweave**: one Claude pass → free-form digest + disciplined connections | uncommitted working tree (this session) |
| v1.3 | test | Intent-aware reweave: ideas-first voice, treatment modes, X long-form/thread/embed, self-reference filter, omit-empty-connections | uncommitted working tree (this session) |
| v1.4 | test | Concision & density: executive-brief discipline (bullets/tables over prose walls), newsletter synthesis, connections lean first-party + deduped | uncommitted working tree (this session) |
| v2 | **published baseline** | The `v1.4` protocol verbatim, promoted on full-library backfill. Every durable reference is being reanalyzed to v2 (`scripts/library-backfill.ts`); v1.4 items re-stamped without reweave | uncommitted working tree (this session) |
| v2.1 | test | **The onion** — shared `CAPTURE_VOICE` core feeds both L1 digest and L2 reweave; candidates can be reweaved with connections (`LIBRARY_CANDIDATE_REWEAVE`); free-form candidate render drops the rigid Summary/Key Points/Assessment scaffold. Also: X long-post repair (verify via xurl, prefer `note_tweet`, preserve numbered findings) | uncommitted working tree (this session) |
| v2.2 | test | **The judge layer** (Library v2) — `REWEAVE_PROMPT` gains an `attention_judgment` field: the reweave agent's direct high/medium/low verdict on attention-worthiness for Justin's practice, with a one-line reason, stamped to frontmatter. Digest/connection behavior is UNCHANGED — v2/v2.1 items are NOT version-behind (all three are in `CURRENT_PIPELINE_VERSIONS`). Powers the judge–score agreement and For You precision metrics (`docs/plans/library-v2.md`) | uncommitted working tree (this session) |
| v2.3 | test | **Capture integrity** — X Article bookmarks acquire `article.title` + `article.plain_text`; the shared capture-health gate blocks metadata wrappers from digest/reweave, and retry cooldown starts at failure time. Digest voice and judge behavior are unchanged; v2/v2.1/v2.2 remain current-compatible. | uncommitted working tree (this session) |
| v2.4 | test | **Structured-output reliability** — Reweave calls pass an explicit JSON Schema and consume Claude's `structured_output` envelope before the text fallback. Fixes a live Notion Ship OS pass whose useful completed weave was discarded because one quoted phrase made prompt-only JSON invalid. Digest voice and judge behavior are unchanged; v2 through v2.3 remain current-compatible. | uncommitted working tree (this session) |
| v2.5 | test | **Embedded-video source recovery** — Thin explicit study saves inspect page video tags/players/metadata only after normal text capture is insufficient; recoverable videos use captions first, audio transcription second, and store the transcript as canonical Raw Content with player provenance. Short/decorative video and keep/discovery items are gated out by default; a detected required video that cannot be transcribed follows the normal capture retry policy. Timestamped transcript passthrough can no longer become a visible digest, and failed reweaves cannot check off Connections. | uncommitted working tree (this session) |
| **v2.6 (current)** | test | **Source description vs recommendation pitch** — Reweave descriptions are strictly evergreen and source-centric. They may explain what the source contains, argues, demonstrates, or teaches, but cannot refer to current timing, Justin's work, active projects, or why the item should be read now. Recommendation episodes own that contextual pitch, and editor validation rejects pitches that merely paraphrase the source description. Existing v2 notes remain compatible and improve only when naturally reprocessed. | uncommitted working tree (this session) |

> **Re-base note (2026-06-01):** earlier this work was numbered v1–v5 as if each step shipped. It
> didn't — only the *digest era* (now folded into **v1**) was ever applied across the whole library.
> Every reweave step since has been a small review batch, so under the integer/decimal rule those are
> decimals off the published baseline: old v3 → **v1.1**, old v4 → **v1.2**, old v5 → **v1.3**, old v6
> → **v1.4**. The 12 items currently in the Updated lane were re-stamped `v5` → `v1.3`.

> Git mapping caveat: the Reference Library shipped fast across a small window of "Release Hilt 6/7"
> squash commits, and the reweave work plus the `pipeline.ts` / `review-queue.ts` provenance
> scaffolding currently live in the **uncommitted working tree (this session)**. The refs above are
> the closest committed boundary for each behavior.

---

### v1 — Published baseline: digest era (at scale)

- **Summary:** The pipeline that produced the existing library at scale. This is the integer baseline
  most of the ~600 refs carry.
- **Origin (heuristic):** the very first generation digested with pure local heuristics — first ~4
  sentences as the summary plus leading sentences as near-duplicate "key points," and deterministic
  token-overlap connections (`suggestArtifactConnections` / `tokenize` / a stopword list). No LLM.
- **What the baseline settled on:**
  - Digest via `DIGEST_PROMPT` through the `summarize` CLI — a distinct narrative summary followed by a
    literal `Key takeaways:` line and 3–6 *distinct* bullets that do not restate the summary.
  - Web/newsletter/email **chrome stripping** (`stripWebChrome`) before summarizing.
  - **Cached-source reuse** (`preferCachedSource`) so redigestion doesn't feed the title back as source.
  - Connections were token-overlap (and were later partly re-judged by LLM via
    `scripts/library-rejudge-connections.ts`).
- **Why:** ship a file-native Reference Library across the whole corpus, cheaply and deterministically.
- **Limits that motivated the reweave experiments:** summaries restated the lede; "key points"
  duplicated the summary; token overlap padded weak, vibe-level ties.
- **Git ref:** `a19cb02` / `739c58f` (heuristic origin, 2026-05-27/28); the digest + chrome-stripping
  baseline folded into `d3b27f3` (2026-05-29).

### v1.1 — LLM-judgment connections (test)

- **Summary:** Connections become an LLM judgment instead of token overlap.
- **What changed:**
  - Removed `suggestArtifactConnections` / `tokenize` / `reasonFor` / the stopword scorer entirely.
  - Added `buildKbIndex` (a compact ~1.25K-token index of North Stars / projects / areas / people /
    recent references) and `judgeConnections` (`connection-prompt.ts`'s `CONNECTION_PROMPT`).
  - Claude is run **headless inside the vault** with **read-only** tools (`Read`, `Grep`, `Glob`,
    `--add-dir`), doing a **comprehensive whole-vault search** to ground ties. **No count cap.**
  - **"No connection" is first-class** — a clean `connects: false` with one-line reasoning is valid.
  - Baseline / contrast / foundational ties count as real connections.
- **Why:** token overlap could only match shared words; the model reasoning over the actual corpus
  produces honest, directional relationships and abstains freely. (See "library connections philosophy.")
- **Git ref:** `d3b27f3` (2026-05-29) — `connections.ts#judgeConnections`, `connection-prompt.ts`.

### v1.2 — Unified reweave, one Claude pass (test)

- **Summary:** Collapse digest-then-judge into a **single** in-vault Claude pass that produces both the
  digest and the connections.
- **What changed:**
  - New `reweaveArtifact` (`connections.ts`) + `REWEAVE_PROMPT` / `parseReweaveOutput`
    (`reweave-prompt.ts`). One read-only run in the vault returns a `ReweaveResult`.
  - Digest is now **free-form** — the model picks its own `##` sections sized to the source. The
    summarize CLI is narrowed to **extraction only**; the model owns the note's shape.
  - **Disciplined connections:** first-party ties surfaced comprehensively; library cross-refs only when
    they sharpen or surprise. Wikilink labels (`- [[target|Title]] - relationship`). **No candidate
    targets** (never link into `references/.cache/`).
  - `judgeConnections` + the legacy Summary/Key Points path remain the **offline-safe fallback**.
- **Why:** two passes duplicated the corpus read and let the summary and connection set drift apart.
- **Git ref:** uncommitted working tree (this session).

### v1.3 — Intent-aware reweave (current)

- **Summary:** Same one-pass reweave, sharpened for voice and for matching the *treatment* to **why**
  the item was saved.
- **What changed:**
  - **Ideas-first voice rules** in `REWEAVE_PROMPT`: no media-object talk ("this thread…", "a long-form
    guide…"), no process/extraction narration ("Who's actually talking", "What this is"), no
    attention-selling ("Worth ten seconds", "worth keeping"), no honesty/quality self-labels ("Honest
    take", "the clearest write-up I've seen"). **Do keep source-bias caveats** (biased/promotional/thin).
  - **Treatment modes** inferred from save-context / URL / format: idea → distill + connect; product →
    specs-for-later; aesthetic → brief description + genuine peer ties only; failed capture → one honest
    line that it couldn't be retrieved.
  - **Omit empty Connections** — no lone `- ` bullet; reasoning / reweave candidates go to frontmatter.
  - **X handling:** request/prefer `note_tweet` long-form; detect thread roots (`looksLikeThreadRoot`)
    and flag partial captures; embed any X post (not only status/video URLs).
  - **Self-reference filter** — the item never connects to itself.
  - **Reweave timeout** raised and made configurable via `LIBRARY_REWEAVE_TIMEOUT_MS`.
- **Why:** early reweave kept narrating the medium and grading its own work; treatment modes stop
  over-processing a product page or aesthetic save as if it were an essay.
- **Open feedback:** substantively good but **too prose-heavy** → motivates `v1.4` (concision & density).
- **Git ref:** uncommitted working tree (this session).

### v1.4 — Concision & density (current)

- **Summary:** Same one-pass reweave, pushed toward **executive-brief density** and away from
  paragraph-heavy output. Targeted additions only (the prompt's structure/voice from v1.3 is kept).
- **What changed (three targeted rules added to `REWEAVE_PROMPT`):**
  - **DENSITY directive:** write like a daily executive brief — lead with the takeaway, deliver substance
    at the highest signal-per-word, prefer tight bullets and small tables over paragraph walls, reserve
    prose for where it carries an argument, cut floral runway/restatement. Length tracks substance.
  - **Newsletter / roundup treatment mode:** for a multi-topic digest, synthesize the 1-3 salient threads
    rather than mirroring its table of contents as a heading-then-paragraph per item.
  - **Connections lean first-party + dedupe:** library cross-refs default to none-or-one (two is a lot),
    first-party ties always lead, and the Connections list must not repeat a point the digest body
    already drew.
- **Why:** v1.3 read well but too many notes were walls of prose (Centaurs, Dax, Vibe-Code), the AI News
  newsletter reproduced its whole TOC, and library cross-refs crowded/duplicated the first-party ties.
  The model is Justin's own manual captures (e.g. `references/process/2026-05-22-roadmap-defense-collapsing`):
  tight Summary → dense Key-Insight bullets → Implications-for-his-work with first-party links.
- **Separate (non-prompt) fix to ship with this batch:** broken hero images (e.g. a 360-viewer asset)
  fall back to the page's OpenGraph `og:image`.
- **Git ref:** uncommitted working tree (this session). `PIPELINE_VERSION = "v1.4"` in `pipeline.ts`.

### v2 — Published baseline

- **Summary:** The `v1.4` protocol **verbatim** (no prompt change), promoted from a decimal test
  iteration to the integer **published baseline** because it is being applied across the whole library.
- **What "promotion" means:** after iterating `v1.1 → v1.4` on a small review batch and blessing the
  result, every durable reference is reanalyzed to `v2`. Items already at `v1.4` are **re-stamped**
  `v2` without a reweave (identical protocol); everything else is reweaved. New organic ingestion
  stamps `v2` automatically.
- **The backfill runner:** `scripts/library-backfill.ts` — a parallel, resumable, rate-limit-aware
  orchestrator. Worklist = every `type: reference` not yet `v2` (recomputed from disk each pass, so it
  is idempotent and resumes after interruption). A worker pool of N reweave processes shares one
  prebuilt KB index; on a Claude usage limit a worker exits `75`, the pool pauses with exponential
  backoff and drops concurrency, then climbs back after a clean streak. Read-state baseline is advanced
  at the end so the mass rewrite does not flood the New lane.
- **Git ref:** uncommitted working tree (this session). `PIPELINE_VERSION = "v2"` in `pipeline.ts`.

---

### v2.1 — The onion: one shared voice core for both layers (test)

- **Summary:** A single voice core now feeds **both** layers of the capture skill, so candidates and
  saved items are written in the same voice — and candidates can now be reweaved with connections.
  Previously only the L2 reweave carried the good "v2" voice; candidates got a cheap single-shot
  `DIGEST_PROMPT` rendered with a rigid template, so they still looked like "v1".
- **What changed (the onion):**
  - **`capture-voice.ts` is the single source of voice.** It exports `CAPTURE_VOICE` (the shared
    voice / density / intent spec) and `DIGEST_PROMPT` (= `CAPTURE_VOICE` + "output the body, no
    connections"). The numbered-list-preservation nuance is folded into `CAPTURE_VOICE` itself.
  - **`pipeline.ts` retired its inline rigid `DIGEST_PROMPT`** (the "2-4 sentence summary + literal
    `Key takeaways:` + 3-6 bullets" template) and now re-exports `DIGEST_PROMPT` from
    `capture-voice.ts`. `PIPELINE_VERSION` stays `v2.1`.
  - **`REWEAVE_PROMPT` (L2) now embeds `CAPTURE_VOICE`** for its digest guidance, keeping its vault
    intro, its disciplined CONNECTIONS section, and the exact JSON contract `parseReweaveOutput`
    expects. The voice is no longer duplicated between the two prompts.
  - **Candidates can be reweaved.** With `LIBRARY_CANDIDATE_REWEAVE=1` (default OFF), discovery
    candidates go down the SAME single `reweaveArtifact` call saved items use — a free-form
    `digest_markdown` plus first-party / library connections — with no extra LLM pass. On reweave-null
    the candidate degrades to the L1 free-form `DIGEST_PROMPT` body, never the old summary/key-points
    template.
  - **Candidate render mirrors the durable form.** `buildCandidateMarkdown` renders the free-form
    `digest_markdown` (or legacy Summary/Key Points fallback) + an omit-when-empty `## Connections`
    section, dropping the rigid `## Summary / ## Key Points / ## Assessment / ## Suggested
    Connections` scaffold. Media + Raw Content are kept; score / recommendation / `description` live
    in frontmatter (so a free-form body round-trips to a non-empty feed summary).
  - **Backfill orchestrator fixes:** `scripts/library-backfill.ts` now tracks `TARGET_VERSION` from the
    live `PIPELINE_VERSION` (was hardcoded `"v2"`, which made every fresh `v2.1` reweave count as a
    failure and triggered the 3x-retry quota waste), and gained `--include-candidates` to sweep
    `references/.cache/library-candidates/` (which also picks up the ~5 unstamped saved refs).
    `scripts/library-reweave.ts` now accepts `type: reference-candidate` files and re-stamps them.
- **Also folded in (earlier v2.1 work):** X long-post repair — `digestArtifact` verifies the
  bookmarked X post through the configured xurl path and prefers full `note_tweet.text`; thread/list
  roots that can't be verified complete no longer become "hot" on 80+ chars of metadata; the
  numbered/listed-findings preservation rule (now living in `CAPTURE_VOICE`).
- **Why:** the voice fix only ever reached saved items; candidates were a parallel rigid path. Folding
  both layers onto one `CAPTURE_VOICE` means shedding L2 degrades gracefully to L1 — same voice, fewer
  layers — instead of a separate look.
- **Git ref:** uncommitted working tree (this session). `PIPELINE_VERSION = "v2.1"` in `pipeline.ts`.

---

*Last updated: 2026-06-03*
