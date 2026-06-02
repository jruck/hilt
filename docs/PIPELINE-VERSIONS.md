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

**Current = `v1.3` (a test iteration in the Updated lane). `v1.4` is PENDING (concision). No reweave
generation has been published at scale yet — the first full backfill will publish `v2`.**

## Version history

| Version | Class | One-line summary | Git ref (approx.) |
|---------|-------|------------------|-------------------|
| v1 | **published baseline** | Digest era: `summarize`-CLI `DIGEST_PROMPT` (+ heuristic origin) + chrome stripping + cached-source reuse; token-overlap (later partly LLM-rejudged) connections. What the bulk of the ~600 refs carry. | `a19cb02`, `739c58f`, `d3b27f3` (2026-05-27 → 05-29) |
| v1.1 | test | LLM-judgment connections (`judgeConnections`), token overlap removed | `d3b27f3` (2026-05-29) |
| v1.2 | test | Unified **reweave**: one Claude pass → free-form digest + disciplined connections | uncommitted working tree (this session) |
| **v1.3 (current)** | test | Intent-aware reweave: ideas-first voice, treatment modes, X long-form/thread/embed, self-reference filter, omit-empty-connections | uncommitted working tree (this session) |
| v1.4 (PENDING) | test | Concision nudge — bias toward the tightest version that carries the substance | not yet applied |
| v2 (FUTURE) | published baseline | First full-library backfill with the blessed reweave protocol = promotion to the published standard | not yet cut |

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
- **Open feedback:** substantively good but **occasionally long** → motivates `v1.4` (concision).
- **Git ref:** uncommitted working tree (this session). `PIPELINE_VERSION = "v1.3"` in `pipeline.ts`.

### v1.4 — Concision nudge (PENDING, not yet applied)

- **Summary:** Bias the digest toward the **tightest version that still carries the substance**.
- **What will change:** a concision instruction in `REWEAVE_PROMPT` — when two phrasings carry the same
  substance, prefer the shorter; cut runway and restatement.
- **Why:** `v1.3` output is honest and on-voice but still occasionally long; the goal is the smallest
  note that loses nothing.
- **Status:** **PENDING.** Not in `reweave-prompt.ts` yet; `PIPELINE_VERSION` is still `v1.3`. When
  applied, bump to `v1.4`, write `docs/review-notes/v1.4.md`, and move this entry above the line.

---

*Last updated: 2026-06-01*
