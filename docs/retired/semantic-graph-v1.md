# Semantic Graph v1 — Retired 2026-07-18

Hilt's first semantic knowledge graph is no longer part of the live app. The
System Graph view, graph links, graph/semantic APIs and runners, Gemini-backed
embeddings and extraction, and active graph databases were removed after a
one-time historical Library recommendation bake-off.

The replacement is scoring configuration **s3**, the deterministic
**explicit-context hybrid**. It combines bounded lexical matching against
current tasks, projects, areas, and people with Hilt's existing readable
connection suggestions and attention judgment. Worth, substance, freshness,
archive rules, cooldowns, and the Claude recommendation editor remain.

## Time capsule

- Source branch: `archive/semantic-graph-v1`
- Immutable tag: `archive/semantic-graph-v1-2026-07-18`
- Archive commit: `f14f4024cdfad2ef6cbd84aff6b04a5573f02bfe`
- Private local capsule:
  `/Users/jruck/.hilt/data/archives/semantic-graph-v1-2026-07-18/`

The private capsule contains checksum-verified SQLite snapshots, the complete
26-checkpoint/137-episode bake-off, editor prompts and responses, a manifest,
and a complete Git bundle. It contains personal data and must not be pushed.

Use the archived branch and capsule for future semantic/vector research in an
isolated worktree and isolated `DATA_DIR`. Keep `SEMANTIC_OFFLINE=1`; do not
restore schedules or paid Gemini calls without a new design, cost ceiling, and
explicit approval.

This retirement does not remove readable Library Connections, attention
judgments, display tags, YouTube ingestion, the System Sessions map, or the
local work map. Those are separate systems.
