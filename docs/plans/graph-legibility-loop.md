# Prompt: Graph legibility loop

Paste everything below this line into a fresh session.

---

Make the System → Graph semantic layer **legible and trustworthy**, looping until the acceptance criteria below all pass. The graph serves two purposes and every decision should serve them: (1) a **mirror** — surfacing the themes, proportions, and clusters of my corpus so I see where my attention actually goes; (2) an **agent-facing cross-reference index** — topics/entities an agent can query instead of grepping the whole vault, which only works if the taxonomy is well-tuned enough to trust.

## Diagnosis (already established 2026-06-10 — verify quickly, don't re-derive)

1. **All 847 topic labels are placeholders** ("Theme L0-8"). Root cause: `labelTopicsOnce` (`src/lib/semantic/gemini.ts`) sends ALL clusters in ONE call (~480K tokens in, 847 labels expected out) → blows output limits → `topics.ts` fail-softs (`catch { labels = [] }`) → every topic named `Theme <clusterId>`. Worked at toy scale, breaks at real scale. This mutes the entire conceptual layer — the most user-visible failure.
2. **Degenerate root taxonomy**: only 4 root topics; one holds 1,148 items (~48% of corpus). The honest resolution is the ~840 L1 topics (18–47 items each). Clustering runs in `scripts/semantic-cluster.py` (uv sidecar, UMAP+HDBSCAN, seed 42) via `src/lib/semantic/cluster.ts`.
3. **Entity node flood**: 4,611 entity nodes minted into the graph; 2,736 (60%) are single-mention noise. Plus extraction junk in top ranks ("Zyrtec" typed `source`, 116 mentions) and ambient working tools dominating by mention count (Opus 410) — instances, not themes.
4. **On-canvas labels are top-K degree hubs** (`GraphView.tsx` ~127–150, collision-pruned) — so unlabeled mega-topics and big entities own the legible layer. Colors: fuchsia=topic, cyan=entity (`graph-labels.ts`).

## Work items, in order — do not advance until the current item's criterion passes

1. **Batched topic labeling.** Rework labeling to batch ~40–60 clusters per call, merge partial results, retry a failed batch once, fail-soft **per batch** (never global). Label parent/root topics from their children's labels+summaries rather than raw excerpts. Add a **label-only repair mode** (relabel without re-clustering — re-clustering wipes `item_topics` and churns lineage) and use it for the corpus pass.
   *Criterion:* ≥95% of topics in `semantic.sqlite` have non-placeholder labels; the top 20 topics by `item_count` have specific, recognizable names (spot-check 10 against their member items — would the label tell me what's inside?); a forced end-to-end refit also labels cleanly (the Sunday job must not regress to placeholders).
2. **Entity node gating in the overlay.** Plot only entities with mention_count ≥ floor (default 3, env-tunable like the other `SEMANTIC_GRAPH_*` knobs in `src/lib/graph/config.ts`). Gate at the graph layer only — `semantic.sqlite` keeps everything queryable.
   *Criterion:* entity nodes in `graph.sqlite` drop to roughly the ≥3-mention population (~800–900); no dangling edges; degree recomputed.
3. **Root granularity.** Tune sidecar cluster params (min_cluster_size / selection epsilon / method) so no root topic holds >30% of items and root count lands somewhere sane (~6–20) — OR, if the data genuinely resists, de-emphasize L0 in the graph (size cap or render from L1) and document why. Verify lineage carries topic ids through the re-fit.
   *Criterion:* the SQL probe shows the root distribution within bounds (or the documented alternative shipped); item_topics coverage doesn't regress below current (~77%).
4. **UI sift + label priority.** Legend gains per-node-type visibility toggles (persisted, like the metadata-panel localStorage pattern); on-canvas label selection prefers a *named topic* over an entity at comparable degree.
   *Criterion:* toggles work in the rendered tab; topic names visibly present among the top labels (verify via the payload + a screenshot).
5. **(Stretch) Entity quality pass:** type corrections for obvious junk (medication ≠ source), a stop-list or salience damping for ambient working tools, cross-type duplicate merge. Only after 1–4.

## Loop protocol

For each item: implement → run the relevant suites → **run against the real data** → verify the criterion with a concrete probe (SQL against `~/.hilt/data/semantic.sqlite` / `graph.sqlite`, the live API, or a screenshot) → if unmet, diagnose and iterate on the same item. After items 1–2 land, rebuild the overlay + relayout and confirm in the **live runtime** (the flag-trap lesson: a fix isn't done until it's verified in the running app — restart `com.hilt.dev-server` via `launchctl kickstart -k` if runner/overlay code changed, then check `/api/system/graph/meta`).

## Constraints

- **API budget:** the Gemini key is shared, low-tier. Keep concurrency ≤4, lean on the hardened `withRetry`. Relabeling 847 topics ≈ ~20 batched calls — fine. No unbounded retry loops.
- **One writer at a time:** never run two backfills/refits concurrently (`pgrep -f semantic-` first). The graph runner also writes — prefer letting its watermark refresh pick up overlay changes, or trigger via the rebuild API rather than out-of-process scripts.
- **Versioning protocol:** changing `TOPIC_LABEL_PROMPT` or cluster params is a pipeline change — follow the semantic version protocol (decimal bump + review note) per `docs/PIPELINE-VERSIONS.md` conventions if the change alters derived content semantics; pure batching/transport fixes don't need a bump.
- Markdown stays source of truth; `semantic.sqlite`/`graph.sqlite` are derived caches; never write provider session stores.
- All suites green before commit (`test:semantic`, `test:graph`, `test:library`), tsc + eslint clean, CHANGELOG entry per change, commit to main when each item is verified.
- Make conservative judgment calls yourself and document them; only stop to ask if something is destructive or implies real spend beyond the relabel pass.

## Done

All five criteria verified (or 1–4 + documented deferral of 5), committed, live app showing named themes. Finish with a before/after report: label coverage, node/edge counts, root distribution, what the top 20 themes actually are — so I can judge the mirror against my own sense of my work.
