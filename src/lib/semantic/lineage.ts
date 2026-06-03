/**
 * Topic lineage detection (P2.2, spec §C.5) — pure set math, no model.
 *
 * After a global re-fit, we compare the PRIOR item→topic membership against the NEW
 * membership and emit `topic_lineage` ops so old items re-home and through-lines surface
 * retroactively. This is the "balanced evolution" record: a topic that barely moved keeps
 * its id (carry); genuine structural change is logged as split/merge/birth/death.
 *
 * The diff is membership-only and independent of the warm-start id inheritance in
 * topics.ts: warm-start decides which NEW cluster INHERITS a prior id (so identity is
 * stable); lineage records the MEMBERSHIP fact (where members actually went). The two
 * agree on a clean carry and diverge exactly on splits/merges, which is the point.
 *
 * Edge rule: prior topic P and new topic N are "linked" when their member overlap, as a
 * fraction of the smaller set, clears `overlapFloor`. Classification is then by the
 * degree of each side in that bipartite link graph:
 *   - P linked to exactly one N, and that N linked to exactly one P  → carry  (1:1, stable)
 *   - P linked to ≥2 Ns                                              → split  (one op per child N)
 *   - N linked to ≥2 Ps                                              → merge  (one op per parent P)
 *   - N linked to no P                                               → birth  (new theme)
 *   - P linked to no N                                               → death  (theme dissolved)
 */

export type LineageOp = "carry" | "split" | "merge" | "birth" | "death";

export interface LineageEvent {
  op: LineageOp;
  oldTopicId: string | null; // null for birth
  newTopicId: string | null; // null for death
  /** Overlap fraction (|P∩N| / min(|P|,|N|)) for the linked pair; null for birth/death. */
  score: number | null;
}

export type Membership = Map<string, Set<string>>;

export interface LineageOptions {
  /** Min overlap fraction (of the smaller set) to call two topics "the same lineage". Default 0.5. */
  overlapFloor?: number;
}

/** Build a {topicId → Set<itemId>} membership map from flat (itemId, topicId) rows. */
export function membershipFromRows(rows: Array<{ item_id: string; topic_id: string }>): Membership {
  const m: Membership = new Map();
  for (const r of rows) {
    let set = m.get(r.topic_id);
    if (!set) {
      set = new Set();
      m.set(r.topic_id, set);
    }
    set.add(r.item_id);
  }
  return m;
}

function overlapFraction(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const x of small) if (large.has(x)) inter += 1;
  return inter / small.size;
}

/**
 * Diff prior vs new membership into lineage events. Deterministic: prior topics are
 * processed in sorted id order, links in sorted new-id order. A carry emits a single
 * `carry` row (audit); split/merge emit one row per child/parent; birth/death one each.
 */
export function diffLineage(prior: Membership, next: Membership, opts: LineageOptions = {}): LineageEvent[] {
  const floor = opts.overlapFloor ?? 0.5;
  const priorIds = [...prior.keys()].sort();
  const nextIds = [...next.keys()].sort();

  // Build the bipartite link graph (prior → [{newId, score}]) and its inverse degree.
  const linksFromPrior = new Map<string, Array<{ newId: string; score: number }>>();
  const newInDegree = new Map<string, number>();
  for (const id of nextIds) newInDegree.set(id, 0);

  for (const p of priorIds) {
    const pset = prior.get(p)!;
    const links: Array<{ newId: string; score: number }> = [];
    for (const n of nextIds) {
      const score = overlapFraction(pset, next.get(n)!);
      if (score >= floor) {
        links.push({ newId: n, score });
        newInDegree.set(n, (newInDegree.get(n) ?? 0) + 1);
      }
    }
    links.sort((a, b) => b.score - a.score || (a.newId < b.newId ? -1 : 1));
    linksFromPrior.set(p, links);
  }

  const events: LineageEvent[] = [];

  for (const p of priorIds) {
    const links = linksFromPrior.get(p)!;
    if (links.length === 0) {
      events.push({ op: "death", oldTopicId: p, newTopicId: null, score: null });
      continue;
    }
    if (links.length >= 2) {
      for (const l of links) events.push({ op: "split", oldTopicId: p, newTopicId: l.newId, score: l.score });
      continue;
    }
    // Exactly one new cluster linked. If that cluster also has ≥2 prior parents it's a
    // merge (handled below); otherwise this is a clean 1:1 carry.
    const only = links[0];
    if ((newInDegree.get(only.newId) ?? 0) >= 2) continue; // merge, emitted in the merge pass
    events.push({ op: "carry", oldTopicId: p, newTopicId: only.newId, score: only.score });
  }

  // Merge pass: any new cluster with ≥2 prior parents collapses them.
  for (const n of nextIds) {
    if ((newInDegree.get(n) ?? 0) < 2) continue;
    const parents: Array<{ oldId: string; score: number }> = [];
    for (const p of priorIds) {
      const link = linksFromPrior.get(p)!.find((l) => l.newId === n);
      if (link) parents.push({ oldId: p, score: link.score });
    }
    parents.sort((a, b) => b.score - a.score || (a.oldId < b.oldId ? -1 : 1));
    for (const par of parents) events.push({ op: "merge", oldTopicId: par.oldId, newTopicId: n, score: par.score });
  }

  // Birth pass: any new cluster no prior topic linked into is a new theme.
  for (const n of nextIds) {
    if ((newInDegree.get(n) ?? 0) === 0) {
      events.push({ op: "birth", oldTopicId: null, newTopicId: n, score: null });
    }
  }

  return events;
}
