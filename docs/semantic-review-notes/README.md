# Semantic review notes

One markdown file per `SEMANTIC_VERSION` — the card rendered atop the semantic sample lane (the
exact analog of `docs/review-notes/` for the Reference Library). Each file is `# Title` + a
specific "what changed / what we were fixing / what's still open" body.

`npm run semantic:backfill -- sample --review-batch <label>` reads `docs/semantic-review-notes/<SEMANTIC_VERSION>.md`
(H1 = title, full file = body) and carries it into the **sibling** semantic review queue
(`DATA_DIR/semantic-review-queue`). See `docs/SEMANTIC-VERSIONS.md` for the full generation cycle.
