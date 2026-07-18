# Hilt Semantic Graph v1 — Time Capsule

This branch preserves Hilt's first semantic knowledge system at retirement on
2026-07-18. It is a research artifact, not a supported production branch and
not a recommendation to restore the old runtime unchanged.

## Why it existed

The system explored whether a file-native personal workspace could reveal
useful relationships that explicit links and ordinary search miss. It had four
separate pieces:

1. **Explicit graph index** — parsed Bridge Markdown, wikilinks, Library
   connections, meetings, projects, areas, people, and tags into `graph.sqlite`.
2. **Semantic layer** — embedded the same corpus and extracted entities and an
   emergent topic hierarchy into `semantic.sqlite`.
3. **Library relevance contribution** — compared Library items with current
   work and contributed a bounded contextual-fit term to Worth scoring.
4. **Visual graph** — displayed the explicit graph plus semantic topic/entity
   overlays in System, with focused links from Docs, Library, and People.

The semantic layer directly affected only Library relevance scoring and the
visual graph overlay. Briefings were affected indirectly when Library
recommendations selected different items. Meetings, tasks, proposals, people
notes, and ordinary Bridge content did not query the semantic database.

## Why it was retired

The visual graph was interesting but not part of the daily workflow. The
semantic contribution to Library recommendations was useful in principle, but
its continuous embedding, extraction, taxonomy, and refit work produced a
Google Cloud bill that was not justified by the observed improvement.

A one-time historical bake-off compared the frozen semantic scorer with three
no-semantic alternatives across 26 recommendation checkpoints and six complete
Briefing days. The explicit-context hybrid was the strongest replacement: it
combined bounded lexical matching with Hilt's readable connection suggestions
and attention judgment, while remaining deterministic at scoring time. The
retirement therefore favors a simpler, observable system rather than claiming
that semantic retrieval has no merit.

## Frozen implementation

- Embeddings: `gemini-embedding-001`, stored at 1,536 dimensions.
- Per-item extraction: `gemini-flash-latest`.
- Topic taxonomy/refit: `gemini-pro-latest`.
- Semantic version: `v0.1`.
- Semantic database format: `1`.
- Graph layout version: `1`; graph wire format: `2`.
- Recommendation/Briefing editor used by the bake-off:
  `claude-sonnet-4-6`.

Useful historical waypoints include the first graph implementation
(`2701b23`), initial semantic layer (`cf07f3b`), Library semantic relevance
integration (`d5b7837`), scheduler/editor work (`e482013`), and semantic graph
overlay (`9f29ca2`). Later fixes are present in this branch's ancestry.

The one-time replay source is preserved in:

- `src/lib/library/recommendation-bakeoff.ts`
- `src/lib/library/recommendation-bakeoff.test.ts`
- `scripts/library-recommendation-bakeoff.ts`
- `scripts/library-bakeoff-blind-packet.ts`

## Private data capsule

The source branch intentionally does not contain vault text, embeddings,
SQLite databases, prompts, model responses, screenshots, environment values,
or personal evaluation output. Those live in the private local capsule:

`${DATA_DIR}/archives/semantic-graph-v1-2026-07-18/`

Its `manifest.json` records checksums, SQLite health/counts, model/configuration
identifiers, source refs, and artifact inventory. The capsule also contains
consistent `semantic.sqlite` and `graph.sqlite` snapshots, the completed
bake-off evidence, and a Git bundle for redundant source recovery.

## Strengths worth revisiting

- Semantic neighbors could recognize conceptual relationships without shared
  wording.
- A graph overlay made explicit and inferred structure inspectable together.
- Versioned derived caches allowed rebuilds without changing Markdown.
- The historical replay and score breakdown made replacement quality
  measurable instead of anecdotal.

## Weaknesses not to repeat

- Continuous whole-corpus embeddings and LLM extraction were too aggressive
  for the value delivered.
- Model aliases such as `latest` weakened cost and reproducibility controls.
- The visual graph and recommendation scorer shared expensive infrastructure
  despite very different user value.
- Provider usage was not bounded by a clear monthly budget or surfaced as a
  first-class operational metric.

## Safe restoration

1. Restore this branch into an isolated worktree; never replace current Hilt.
2. Use an isolated `DATA_DIR` populated from verified capsule snapshots.
3. Keep `HILT_SEMANTIC_ENABLED=false` and `SEMANTIC_OFFLINE=1`.
4. Run only read-only replay/query commands at first. Do not install schedules,
   start the SemanticRunner, or supply Gemini credentials.
5. For frozen visual inspection, run the archived Next application against the
   isolated graph snapshot without the background graph/semantic runners.
6. Any revival should begin as a new design with explicit provider/model pins,
   a cost ceiling, incremental-work guarantees, and a fresh quality/cost
   evaluation. Re-enabling paid semantic processing requires a separate,
   explicit decision.

The right future use of this capsule is to understand the old architecture and
reuse its lessons—not to blindly cherry-pick the retired runtime.
