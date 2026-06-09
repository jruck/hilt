# Reference Library — Eval Architecture & Build Plan

## What this is

The Reference Library ingests external references into the Bridge vault as markdown — both items the
user **saved** deliberately and items pulled from **discovery** subscriptions (YouTube, newsletters,
Twitter/Raindrop) as review **candidates**. Each item runs through a pipeline: **extract** the source →
**digest** it → **reweave** (a pass where a model reads the source *and* the vault, producing a free-form
digest plus vault-grounded **connections**).

This plan specifies the **eval** that decides how each item is treated. It serves two uses:
- **Pre-reader** — triage the inflow and surface what's worth the user's limited attention.
- **Research assistant** — retrieve relevant material on demand for whatever the user is working on.

## The user's practice (what "relevance" is measured against)

The user is an AI-native builder/founder: agentic systems and orchestration (Hilt, agent architectures,
an AI product studio and consultancy) and how AI changes the way software is built, shipped, and operated.
**Relevant-to-study = ideas that advance how the user builds and thinks.** Objects with no bearing on that
practice — a product, a coat, a running shoe, a designer's portfolio, a person whose work is admired — are
*stash*, not *study*.

## The model

Three independent things describe an item: its **disposition** (nature of the save), its **worth** (a
continuous score, study items only), and its **lifecycle state** (where it sits).

### Disposition: `study` | `keep`
- **study** — knowledge/ideas potentially **foldable into the user's practice**. Considered material.
- **keep** — an **object/reference stashed for possible-but-not-guaranteed retrieval**: products,
  clothing, talent (people to potentially hire), art/aesthetic. Not ideas to process.

`keep` items are excluded from the worth-ranked feed; they live in a searchable stash the research
assistant surfaces on demand. **Worth scoring applies only to `study` items.** Stored as `library_mode`
(`study | keep`), set at ingest from source signals (Raindrop collection/tags such as *talent*/*art*,
product/shopping format, content classification).

### Worth (continuous, `study` items only)
How much should this compete for the user's attention right now. Drives the prominence of the feed
(**For You** at the top, **Recent** below, ranked and compacted).

```
worth = relevance × substance × freshness_decay
```
- **Relevance** — does this bear on the practice? (a) **anchored**: the vault-grounded connections woven
  at reweave (ties to the user's own projects/areas/people); (b) **topical**: fit to the broader
  practice even when unanchored. Re-weighted on read against *currently active* projects/areas.
- **Substance** — deep or shallow: how much **worthwhile material the source carries**, model-judged from
  the source. Model-judged richness, *not length* — a dense short essay scores high, a long padded post
  scores low.
- **Freshness** — a **decay multiplier**, not a standalone score.

**Resilience principle:** anchored relevance depends on connection generation; if a connection pass fails,
anchored relevance goes to zero and a good item can look worthless. The **topical** half is the hedge —
it carries a signal even when explicit connections are missing.

**Out of scope (do not add):** significance/social-signal scoring; novelty scoring.

### Lifecycle state: `active` | `to_archive` | `archived`
Where the item sits. **The eval never moves a file — it only flags. All archiving is manual.**
- **active** — normal circulation (study → worth-ranked feed; keep → searchable stash).
- **to_archive** — the eval flags a `study` item as **probably not worth your time** (low worth). This is
  a **non-destructive review bucket**: the item **stays in the main folder**, is **never moved
  automatically**, and waits for human review. The user reviews it and either **rescues** it ("keep this —
  and why," captured to refine grading) or **confirms** archival.
- **archived** — **manually** moved to the physical **`.archive/`** folder (by the user, or by Claude on
  an explicit command such as "archive all the to_archive items"). `.archive/` is excluded from the active
  feed but stays queryable, and is the clean separation point for agents crawling the vault outside Hilt.

The `to_archive` flag uses the worth score plus an **analyzed-guard**: only flag an item the connection
judge has actually run on (positive evidence of analysis — `reconnected_at` set, or connections present).
*Absence of connections must never be read as "irrelevant" — it usually means the pass didn't run.*

**Auto-archive (auto-promoting `to_archive` → `archived`) is deferred** until the ranking earns trust
through the review loop. When/if enabled later, it gets self-healing resurrection + hysteresis. Not now.

## Model drift & re-grading

Model-graded inputs (substance now; any LLM signal later) drift as models change. Mitigations are built in:
- **Manual archive only** — drift can never silently bury or destroy anything. The worst a drifted score
  does is mis-flag an item into the non-destructive `to_archive` bucket, which a human catches.
- **Version-stamp every grade** with the grading model + prompt version (extends the existing
  `pipeline_version` scheme).
- **Re-grade in full, consistent passes** — when the grading model changes, re-grade the whole library in
  one pass on one model so a ranking never mixes baselines. This is cheap (Gemini Flash over existing
  digests, minutes), so re-baselining many times is feasible.
- **Human-in-the-loop calibration** — `to_archive` rescues ("I like this one, because…") are captured and
  used to refine the grading rubric/thresholds.

## Architecture & stack: grade cheaply, score for free

- **Score on read — free, instant, local.** `worth = relevance × substance × freshness` is pure
  TypeScript over stored data; no model call. Re-scores the whole library (~800+ items) in well under a
  second and runs continuously as context shifts. Disposition, filters, freshness, and `to_archive`
  flagging are all local too.
- **Grade the durable inputs:**
  - **Connections** (relevance's anchored substrate) — produced at reweave on the **Claude Max
    subscription via CLI (OAuth, not the API key)**; rate-limited. Already present for most items; new
    items get them at reweave. *Reserved for reweave — the eval never calls it.*
  - **Substance** — for **new** items, folded into the reweave (≈zero marginal cost). For the **existing
    library**, backfilled by a **cheap Gemini Flash pass over the digests we already have** — **not** a
    Claude re-reweave. Version-stamped.
- **Topical relevance (later)** — **Gemini embeddings** (the separate semantic-layer workstream); cheap.

**Net cost:** day-to-day eval = **$0, instant**. Only fresh reweaves (Claude) and occasional full
substance re-grades (cheap Gemini) cost anything.

### Substance grading must be granular (validation gate)
The grader MUST produce a **spread** of scores, not pile everything at the top (the failure mode to avoid:
every item ≈ 1.0). Before trusting a backfill: sample it, confirm the distribution spreads across the
range, and tune the rubric/scale (anchored examples, or relative/percentile calibration) until granular.
**Do not ship a backfill that saturates.**

## Eval workbench — sidebar inspection filters
A collapsible **Eval / Inspect** section in the Library sidebar (verbosity is fine — it's a debugging
surface), layered on the existing source/channel facets:
- **Scores:** Relevance · Substance · Worth (low / med / high or range).
- **Disposition:** study · keep.
- **Lifecycle:** active · to_archive · archived.
- **Generation status:** connections (*has* · *judged & abstained* (`reconnected_at`, 0 ties) · *never
  judged* · *reweave pending*); digest method (`digested_with`: reweave · summarize-cli · other).
- **Pipeline version** (`pipeline_version`): multi-select.

The library **list** endpoint attaches per-item eval (disposition, relevance, substance, worth, lifecycle)
plus the raw status fields, using the same evaluator the For-You feed uses; `LibraryView` filters
client-side. Version, connection/judged state, `reweave_pending`, and digest method are filterable
immediately from existing frontmatter; score filters activate as scores land.

## Build steps
1. **Disposition classification** — make `study`/`keep` fire at ingest (today everything defaults to
   `study`). `src/lib/library/taxonomy.ts` (`looksLikeKeep` + Raindrop collection/tags + format); route
   `keep` out of the feed into the stash; confirm round-trip through `candidate-cache.ts`/`references.ts`.
2. **Eval workbench filters — existing-data slice.** Attach eval + raw status fields to list responses
   (`src/app/api/library/…`, `recommendations.ts` evaluator); add the sidebar section in
   `src/components/library/LibraryView.tsx`. Lights up immediately for inspection.
3. **Substance backfill via Gemini Flash** over existing digests — version-stamped, **with the
   granularity validation gate**. New items get substance folded into `REWEAVE_PROMPT`
   (`reweave-prompt.ts` JSON contract + `parseReweaveOutput`).
4. **Worth scoring** — refactor `src/lib/library/library-eval.ts` → `worth = relevance × substance ×
   freshness`, per-dimension reasons; rank For You by worth in `recommendations.ts`.
5. **`to_archive` flagging + manual archive** — flag low-worth study items into the non-destructive
   `to_archive` bucket (analyzed-guard applies); a manual action (user or Claude-on-command) moves an item
   to `.archive/` as `archived` (`archived_by: user`). No auto-move. Capture rescue reasons for grading
   refinement.
6. **Topical relevance (semantic layer)** — the topical half of relevance; resilience hedge + the fix for
   on-domain-but-unanchored items.
7. **Auto-archive — deferred.** Only after the review loop earns trust: a reconciliation pass promoting
   `to_archive` → `archived` with self-healing resurrection + hysteresis.

## Constraints
- **Markdown is the source of truth** — disposition, scores, grade provenance (model + version), and
  connections round-trip through frontmatter.
- **Provider transcript stores are read-only** (`~/.codex/projects`, `~/.claude/projects`, etc.).
- **`DATA_DIR` for the live app is `/Users/jruck/.hilt/data`** — read-state and review-queue write there.
- **The semantic layer is a separate track**; this plan only consumes its topical/relevance signal.
