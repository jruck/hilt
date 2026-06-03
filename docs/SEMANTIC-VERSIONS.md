# Semantic Knowledge Layer Versions

> **This is a NON-EXECUTABLE historical record.** The ONLY live semantic skill is
> `src/lib/semantic/pipeline.ts` (which re-exports the active prompt files and the cluster
> params). Previous versions are **NOT kept as runnable files** — there is no
> `pipeline-v0.1.ts`, no archived prompt copies, nothing to import. Every prior version lives
> in **git history**. This document exists so a human (or an agent) can read *what each version
> did and why* without spelunking diffs, and can jump to the right git ref to recover the exact
> code. It is the exact analog of `docs/PIPELINE-VERSIONS.md` for the Reference Library.

## How versioning works

The semantic layer (embed + extract + cluster) is a **single versioned skill** governed by
`src/lib/semantic/pipeline.ts`: the headline `SEMANTIC_VERSION` stamped on every derived row in
`semantic.sqlite`, plus the compound `SEMANTIC_COMPONENTS { embedding, extraction, taxonomy }`
that let an upgrade target the precise pass that changed (re-embed without re-extracting, etc.).

**Integers vs decimals** (identical to the Library scheme):

- An **integer** version (`v1`, `v2`, …) is a protocol **published at scale** via a full backfill
  across the whole corpus — the "of record" baseline most rows carry, recorded in
  `semantic_meta.active_version`.
- A **decimal** version (`v0.1`, `v1.1`, …) is a **test / iteration** pass run on a **sample lane**,
  reviewed in the semantic review queue (`DATA_DIR/semantic-review-queue`) before rollout. Bump the
  decimal each iteration.
- **Promotion:** when a decimal is blessed and backfilled across the corpus, it becomes the next
  **integer** (e.g. `v1.3 → v2`) and `active_version` is flipped to it.

The badge tells you at a glance: a **decimal badge = "from an experiment under review,"** an
**integer badge = "the published standard."**

### `SEMANTIC_VERSION` vs `SEMANTIC_DB_FORMAT_VERSION`

These are **orthogonal**, the same way graph's `LAYOUT_VERSION` is orthogonal to its
`TRANSPORT_FORMAT_VERSION`:

- `SEMANTIC_VERSION` (a `vN`/`vN.M` string) is a **model/prompt** version. Bumping it is a
  **backfill, not a migration**: new-version rows are written **alongside** the prior-version rows
  (the coexistence window) until the new version is blessed, then `semantic:gc` drops the old.
- `SEMANTIC_DB_FORMAT_VERSION` (an integer) is a **schema/wire** version. Bumping it means the
  on-disk shape changed such that old rows are no longer readable, so the **whole cache file is
  discarded and rebuilt** from the vault on next open. Because `semantic.sqlite` is a pure derived
  cache (Critical Constraint #2), discarding it is always safe. Bump this ONLY on a
  non-backward-compatible schema change (a `sqlite-vec` layout change, a column rename, a blob
  encoding change).

## The generation cycle (run this on every semantic change)

Identical shape to `docs/PIPELINE-VERSIONS.md`:

1. **Edit** the prompt(s) / cluster params in `src/lib/semantic/`.
2. **Bump** the affected component in `SEMANTIC_COMPONENTS` **and** the headline `SEMANTIC_VERSION`
   (a **decimal** for a test iteration, an **integer** for a full-corpus publish).
3. **Add an entry** to this file (the durable history).
4. **Write `docs/semantic-review-notes/<version>.md`** — the card rendered atop the sample lane. A
   `# Title` + a specific "what changed / what we were fixing / what's still open" body. Make it
   specific, not generic (the reviewer knows the common-sense bar).
5. **Cut the sample batch:** `npm run semantic:backfill -- sample --review-batch <label>` — it
   stamps the version on the sample rows, writes them **alongside** the live baseline (coexistence),
   and carries `docs/semantic-review-notes/<version>.md` into the **sibling** semantic review queue
   (`DATA_DIR/semantic-review-queue`, never colliding with the Library queue).
6. **Bless** when satisfied: flip `active_version` to the new (integer) version, then
   `npm run semantic:gc` sweeps the superseded rows.

Old versions are **never** kept as parallel runnable files. When the logic changes, the file is
edited in place and the previous behavior is recovered from git. Mapping each version to a git ref
(below) is how you "run" an old version: check out the ref.

**Current = `v0.1`** — the initial development build (decimal test lane). `SEMANTIC_DB_FORMAT_VERSION = 1`.
No integer baseline has been published at scale yet; `active_version` defaults to the headline
`SEMANTIC_VERSION` until the first cold-start blesses one.

## Version history

| Version | Class | One-line summary | Git ref (approx.) |
|---------|-------|------------------|-------------------|
| v0.1 | test | Initial layer: gemini-embedding-001@1536 embeddings + Flash entity extraction (`flash-extract-v0.1`) + UMAP/HDBSCAN clustering with Pro/Claude labeling (`umap-hdbscan-v0.1+pro-label-v0.1`). The P2.0→P2.4 build. | uncommitted working tree (this session) |

---

### v0.1 — Initial semantic layer (test)

- **Summary:** The first end-to-end semantic knowledge layer — embeddings, typed entities, an
  emergent hierarchical topic taxonomy, graph integration, and the live runner + scheduler.
- **Components:**
  - `embedding`: `gemini-embedding-001@1536` (Matryoshka-truncated, L2-normalized) + the
    item-as-unit chunking rule (long bodies split at sentence boundaries).
  - `extraction`: `flash-extract-v0.1` — the four-bucket `EXTRACTION_PROMPT` (person/project/idea/
    source) + the two-stage blocking + Flash merge-judge resolution.
  - `taxonomy`: `umap-hdbscan-v0.1+pro-label-v0.1` — UMAP→HDBSCAN leaf clustering with a warm-started
    balanced re-fit, labeled by the stronger Gemini Pro / Claude taxonomy model, with `topic_lineage`
    recording every split/merge/birth/death.
- **Why a decimal:** the layer ships flag-gated (`HILT_SEMANTIC_ENABLED`) and has not yet been
  blessed via a full-corpus cold-start; it is iterated and reviewed before becoming an integer
  baseline.
- **Git ref:** uncommitted working tree (this session). `SEMANTIC_VERSION = "v0.1"` in
  `src/lib/semantic/pipeline.ts`.

---

*Last updated: 2026-06-02*
