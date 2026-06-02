# Phase 2 — Semantic Knowledge Layer (Entities · Embeddings · Emergent Topics)

> Status: **PLAN / exploration** (no build yet). This is the "vector analysis" phase the
> Knowledge Graph work pointed at. It exists because the explicit-link graph hit its
> ceiling: wikilinks + manual connections + folders are strong but sparse signals, and
> meetings/notes are never *intentionally* cross-linked — so the graph structurally
> cannot surface cross-topic through-lines. See `memory/graph-vector-phase2.md`.

---

## Decisions (locked via interview)

| Decision | Choice |
|----------|--------|
| **Models** | **Gemini API** — Gemini Embedding 001 (substrate) + Gemini Flash (per-item extraction); a stronger model (Gemini Pro / Claude) for the lower-frequency global taxonomy pass. New `SEMANTIC_*` env config; `GEMINI_API_KEY`. |
| **Ship first** | **(1) CLI / query backbone, then (2) graph integration** (topic + entity nodes, similarity/co-occurrence edges). A dedicated Topics view and/or auto-generated topic pages come **later**. |
| **Topic evolution** | **Balanced** — warm-started periodic re-fit; topics move only on real signal; `topic_lineage` tracked so old items get pulled under new themes. |
| **Entities** | **All four** types: people/authors/creators · projects/areas/tasks · ideas/concepts/themes · sources/tools/orgs. |
| **Scope** | **Main vault + Library references** (your work *and* what you've consumed — for cross-pollination). `libraries/` sub-vault still excluded. |
| **Media** | **Text-only for v1** (transcripts/summaries/notes + the creator/channel/source entities). True multimodal embedding deferred. |
| **Topic granularity** | **Data-driven + hierarchy** — clustering finds the natural granularity; exposed broad→specific to navigate at any depth. |
| **First query to nail** | **Topic exploration** — "what themes am I working on / thinking about (incl. recent/trending), drill into any to see its items." Shapes the first CLI commands. |

*Still open (deferred, not blocking P2.0):* re-fit cadence exact interval, topic-page materialization (markdown vs DB-served), how aggressively Library refs weight vs your own notes.

---

## 0. Reframe — it's not (only) "vector analysis"

"Vector analysis" is one ingredient. The thing you actually want is a **derived semantic
layer with three intertwined sub-layers**, all *observed and re-derivable*, none
hand-curated:

| Layer | What it is | Method | Answers |
|-------|-----------|--------|---------|
| **A. Embeddings** | every item/chunk → a vector in one shared space | embedding model | "what's *similar* to this" (serendipity, fuzzy links) |
| **B. Entities** | the typed things: people, authors, channels, projects, tasks, ideas, tools, orgs | per-item LLM extraction + resolution | "who/what is this *about*" (precise, explicit) |
| **C. Topics** | emergent, hierarchical, evolving themes | embed → cluster → LLM label/merge | "what *themes* run through my work" (the taxonomy you don't curate) |

The two **reference architectures** the field has converged on, both of which are
"derive, don't curate," and both directly applicable here:

1. **Microsoft GraphRAG** — an LLM extracts entities + relationships from each chunk into
   a graph, then **Leiden hierarchical community detection** groups related entities, and
   an LLM writes a summary/label per community. The community hierarchy *is* an evolving
   topic taxonomy, re-derived on each build. ([GraphRAG 2026 guide](https://stackviv.ai/blog/graphrag-knowledge-graphs-rag), [Memgraph](https://memgraph.com/blog/how-microsoft-graphrag-works-with-graph-databases))
2. **BERTopic + LLM** — embed → UMAP → HDBSCAN cluster → **LLM names each cluster and
   merges overlapping ones**. 2025 research finds this hybrid more coherent *and* cheaper
   than either pure clustering or end-to-end LLM topic extraction. ([BERTopic best practices](https://maartengr.github.io/BERTopic/getting_started/best_practices/best_practices.html), [LLM-assisted topic reduction, arXiv 2509.19365](https://arxiv.org/abs/2509.19365))

**This plan = GraphRAG's spine (extract → graph → hierarchical communities → label) with
BERTopic's embed→cluster→LLM-label for the topic layer, wired into Hilt's existing
derived-cache + pipeline-versioning conventions.**

---

## 1. Design principles (derived from your constraints)

1. **Observe, don't curate.** The entity/topic taxonomy is *fully derived and
   re-derivable*. There are **no manual override rules** ("split this topic", "rename
   that one", "these five are one"). Quality "out of the gate" comes from good
   embeddings + good extraction prompts + LLM-assisted labeling/merging + hierarchy —
   *not* from a pile of corrections. (If light steering is ever wanted, it's an
   **advisory** seed to the labeler, never a hard rule — explicitly out of scope for v1.)
2. **Markdown stays source of truth** (Critical Constraint #2). This is a derived cache:
   `DATA_DIR/semantic.sqlite`. Delete + rebuild reproduces it. Any generated topic/entity
   *pages* are artifacts (like Library candidates), not source.
3. **Versioned & re-runnable** (mirrors the Library `PIPELINE_VERSION` scheme). Every
   embedding and extraction is stamped with model + prompt + params version. A model
   upgrade is a *backfill*, not a migration — re-analysis is a first-class scheduled op.
4. **Reuse existing infra.** Shell-out LLM (Claude CLI / a Gemini CLI) + `better-sqlite3`
   + the `sqlite-vec` extension (file-native, no vector-DB server) + a GraphRunner-style
   incremental loop + launchd-scheduled batch jobs for heavy passes.

---

## 2. Your open questions, answered with best practice

### "Do you cluster the whole corpus, or tag each item then dedupe? Maybe both."
**Both — as a pipeline. That's the consensus.** Per-item extraction gives you precise,
explicit entities (a video *is* its creator + channel + the ideas in it — extraction
nails this; embeddings alone never would). Global clustering over embeddings gives you
the emergent topic structure and the serendipity. The LLM labeling/merge step reconciles
them. Pure clustering = incoherent labels; pure per-item tagging = a sprawling
un-deduped tag list. The hybrid is why coherence shows up.

### "How do you handle cold-start (analyze everything) AND new items one-by-one?"
Three cadences (see §4): **cold-start backfill** (once), **incremental on ingest** (slot
each new item into the nearest existing topics — no re-cluster), and **periodic global
re-fit** (re-cluster everything so the taxonomy can evolve). This *is* your "maybe you do
both" — it's the standard online-topic-modeling shape. ([BERTopic online](https://maartengr.github.io/BERTopic/getting_started/online/online.html))

### "I don't want to micromanage it splitting/renaming/merging topics."
You won't. Topic merge/split is done by the **LLM during the global re-fit** (merging
overlapping clusters, naming them) — research shows this is *more* coherent than manual
curation. Your only job is to observe. The taxonomy churns on its own as the corpus
changes; **topic lineage** (§4) keeps the history coherent so old material gets pulled
under new themes retroactively — exactly your "step back and see the through-lines."

### "As better models come out, re-analyze or upgrade cleanly."
Versioning (§5) makes this trivial: bump `SEMANTIC_VERSION`, run a backfill, bless it.
Because everything is re-derivable, a new embedding model just means a re-embed +
re-cluster. No lock-in, no hand-fixing.

### "Is 'vector analysis' even the right model?"
Partly. Embeddings are the *substrate*, but the durable value is the **entity + topic
graph derived on top of them**. Think "GraphRAG-style knowledge graph construction,"
not "a pile of vectors."

---

## 3. Architecture (the three layers in detail)

### Layer A — Embeddings (substrate)
- **Chunking:** notes/refs as a unit (frontmatter + body); long meetings split into
  coherent segments. Each chunk, each resolved entity, and each topic label is embedded
  into **one shared space** so items ↔ topics ↔ entities are directly comparable.
- **Model (recommendation): Gemini Embedding 001** — current #1 on English MTEB (~68.3),
  3072-dim with **Matryoshka** truncation (store 1536 to halve storage at minimal quality
  loss), and **multimodal** (text/image/PDF/audio/video in the same space) — relevant
  since you noted a video is creator + channel + ideas. API-based; your scale (low
  thousands of items) is far under the ~10M-embeddings/month threshold where self-hosting
  pays off. ([Gemini Embedding paper, arXiv 2503.07891](https://arxiv.org/pdf/2503.07891), [MTEB 2026](https://awesomeagents.ai/leaderboards/embedding-model-leaderboard-mteb-april-2026/))
  - **Local alternative** (zero-API / sovereignty): `Qwen3-Embedding-8B` (tops MTEB,
    open-weight) or `BGE-M3`. ([embedding comparison 2026](https://app.ailog.fr/en/blog/news/embedding-models-2026))
- **Store:** `sqlite-vec` extension loaded into `better-sqlite3` — KNN search inside the
  same file-native SQLite we already use; no separate vector service.
- **Versioned:** `embedding_model`, `dim`, `embedded_at` per row; re-embed on upgrade.

### Layer B — Entities (precision)
- **Per-item LLM extraction** → structured JSON: `{type: person|author|channel|project|
  task|idea|tool|org, name, aliases[], salience}`. Few-shot prompted (GraphRAG-style). **Gemini
  Flash** is the right call here — cheap, fast, structured output, high volume. (Your
  instinct is correct.)
- **Entity resolution** (the dedupe you worried about, done properly): canonicalize via
  (a) embedding similarity of name+context + (b) an LLM merge-judge for near-dupes →
  a clean `entities` table with `aliases`. This is "build a massive tag list → dedupe"
  but principled.

### Layer C — Topics (emergent, hierarchical, evolving)
- **Bottom-up:** embed everything → UMAP → HDBSCAN (or Leiden over a similarity graph) →
  raw clusters at multiple granularities (a **hierarchy**: broad parents, specific
  children — "Agent architecture" ⊃ "context windows", "tool use", …).
- **LLM label + reduce:** an LLM names each cluster and merges overlapping ones (the 2025
  best practice). For each topic it also writes a short summary (GraphRAG community
  summary) — useful for topic pages and CLI answers.
- **Re-fit on each global pass** so the taxonomy *evolves* with the corpus (your "new area
  explodes, then old work reveals through-lines" scenario). Warm-started from the prior
  taxonomy to avoid wild churn.

---

## 4. Three cadences (cold-start + incremental + periodic global)

1. **Cold-start backfill** (one-time, launchd batch, resumable/chunked like the graph
   layout main-loop): embed all chunks, extract + resolve entities, run global
   clustering, label. Stamp the version. Estimate: low thousands of items × cheap
   embedding ≈ a few dollars + minutes.
2. **Incremental on ingest** (per new item, via the GraphRunner/watcher pattern): embed
   it, extract entities, assign to **nearest existing topics** by embedding. Fast, no
   re-cluster. New items just slot in.
3. **Periodic global re-fit** (scheduled, e.g. nightly/weekly): re-cluster over all
   embeddings; LLM re-labels/merges; **topic lineage** recorded (when a topic
   splits/merges, keep `topic_lineage(old_id, new_id, op)`), so the timeline stays
   coherent and old notes get pulled under new themes. This is the "step back and
   re-analyze" you described — and how you "discover serendipity" without curating.

*(Caution from the research: naive online clustering over-proliferates subtopics — hence
the periodic global re-fit + LLM merge rather than pure streaming clustering. [online topic modeling / OT merge, arXiv 2504.07711](https://arxiv.org/pdf/2504.07711))*

---

## 5. Versioning & model upgrades (reuse the Library pattern)

Mirror `PIPELINE_VERSION`: a `SEMANTIC_VERSION` capturing **embedding model + extraction
prompt + cluster params**. Decimal = test pass on a sample lane; integer = full backfill
blessed at scale. On a model upgrade: bump version → run backfill (re-embed / re-extract /
re-cluster) → keep prior version's rows until blessed → swap. Because the whole layer is
derived, this is safe and repeatable — directly satisfying "reanalyze historic stuff with
newer models / upgrade and it keeps working."

---

## 6. Storage & serving — the "navigate it / query it fast" surface

**New derived db: `DATA_DIR/semantic.sqlite`** (`better-sqlite3` + `sqlite-vec`, WAL,
singleton, delete+rebuild reproduces — same convention as `graph.sqlite`). Tables
(all version-stamped):

- `chunks(id, item_path, kind, text, embedding[vec], model, version)`
- `entities(id, type, canonical_name, summary, embedding[vec])` + `entity_aliases`
- `topics(id, parent_id, label, summary, level, version)` (hierarchical)
- `item_entities(item, entity, salience)`, `item_topics(item, topic, score)`
- `topic_lineage(old_topic, new_topic, op, version)`

**Fast CLI queries** (your explicit want — no impromptu grep/analysis):
- "related to X" → vector KNN; "items in topic Y"; "entities co-occurring with Z";
  "topic(s) of this note" — all indexed, sub-ms. Exposed via the existing
  `/navigate`-style CLI channel.

**Topic / entity node pages:** auto-generated markdown (a derived artifact, like Library
candidates — *not* hand source) cross-referencing items, sub-topics, related entities +
the LLM summary. File-native ⇒ linkable, editable, round-trips. Materialized on re-fit or
on demand.

**Feeds the graph:** topics + entities become graph nodes; `item↔topic`, entity
co-occurrence, and embedding-similarity become edges. *This* is where the System → Graph
view finally shows the serendipitous cross-topic through-lines the explicit-link graph
couldn't — and where the "navigate by topic" experience lives.

---

## 7. Model choices — concrete

| Job | Recommendation | Why |
|-----|----------------|-----|
| Embeddings | **Gemini Embedding 001** (store 1536-dim Matryoshka; multimodal) | #1 MTEB, future-proof for images/video/PDF, cheap at this scale |
| Per-item extraction (entities, candidate topics) | **Gemini Flash** | cheap, fast, structured output, high volume — your instinct |
| Global taxonomy induction + community/topic summaries | **stronger model** (Gemini Pro / Claude) | low frequency, high leverage; quality of labels matters here |
| Local/offline option | Qwen3-Embedding-8B + a local extractor | zero-API / sovereignty if desired |

All via the existing **shell-out CLI convention** (Claude CLI / a `gemini` CLI) or a thin
API client behind the same env-config pattern (`SEMANTIC_*` vars mirroring `LIBRARY_*`).

---

## 8. Phasing

- **P2.0 — Foundations:** `semantic.sqlite` + `sqlite-vec`; chunking; embedding pipeline;
  cold-start backfill; versioning. *Deliverable:* CLI "related items" (vector KNN) works.
- **P2.1 — Entities:** per-item extraction + resolution; entity tables + pages;
  incremental on ingest.
- **P2.2 — Topics:** global clustering + LLM label/merge + hierarchy; topic tables +
  lineage; periodic re-fit job.
- **P2.3 — Surfaces:** topic/entity node pages; CLI query commands; graph integration
  (topic/entity nodes + semantic edges) → "navigate by topic."
- **P2.4 — Evolution:** versioned re-analysis on model upgrade; lineage view; (deferred,
  optional) advisory steering.

---

## 9. Open decisions / risks (to weigh before P2.0)

- **API vs local embeddings** — simplicity/quality (Gemini) vs sovereignty/zero-cost (Qwen3 local).
- **Chunk granularity** — per-item vs per-section vs per-meeting-segment (affects topic resolution + cost).
- **Re-fit cadence & churn tolerance** — how freely topics may merge/split (stability vs freshness).
- **Cold-start cost** — bounded (thousands of items), but confirm budget for full re-embeds on upgrades.
- **Topic pages: materialized markdown vs DB-served only.**
- **Where it surfaces first** — CLI/query, graph nodes, or dedicated "Topics" view.

---

## 10. References

- BERTopic — [best practices](https://maartengr.github.io/BERTopic/getting_started/best_practices/best_practices.html) · [LLM representation](https://maartengr.github.io/BERTopic/getting_started/representation/llm.html) · [online/incremental](https://maartengr.github.io/BERTopic/getting_started/online/online.html)
- [LLM-Assisted Topic Reduction for BERTopic, arXiv 2509.19365](https://arxiv.org/abs/2509.19365)
- [Merging Embedded Topics with Optimal Transport for Online Topic Modeling, arXiv 2504.07711](https://arxiv.org/pdf/2504.07711)
- Microsoft GraphRAG — [2026 guide](https://stackviv.ai/blog/graphrag-knowledge-graphs-rag) · [with graph DBs](https://memgraph.com/blog/how-microsoft-graphrag-works-with-graph-databases)
- [Gemini Embedding paper, arXiv 2503.07891](https://arxiv.org/pdf/2503.07891) · [MTEB leaderboard 2026](https://awesomeagents.ai/leaderboards/embedding-model-leaderboard-mteb-april-2026/) · [embedding model comparison 2026](https://app.ailog.fr/en/blog/news/embedding-models-2026)
