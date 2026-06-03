/**
 * Reconcile resolved person/project entities to the EXISTING graph nodes (P2.1, spec
 * §B.6) — the "don't double-mint" requirement. src/lib/graph/build.ts already mints
 * authoritative `person:<slug>` (from people notes, with attrs.slug + attrs.aliases) and
 * `project:<slug>` (from each project's index.md, attrs.slug) nodes. A person/project
 * entity must ADOPT the matching graph node's id rather than shadow it; idea/source
 * entities have no pre-existing graph node and mint fresh.
 *
 * Read-only against graph.sqlite, and degrades gracefully when it doesn't exist yet
 * (risk #2): with no graph db, every entity mints fresh with graph_node_id=NULL — the
 * semantic layer still resolves, it just can't bind people/projects to graph nodes until
 * the graph cache is built. We open our OWN read-only handle (fileMustExist) rather than
 * getGraphDb(), which would CREATE the file as a side effect.
 */

import * as fs from "fs";
import Database from "better-sqlite3";
import { getGraphDbPath } from "@/lib/graph/config";
import { personNodeId, projectNodeId } from "@/lib/graph/build";
import { mintBinding, normName, type EntityBinding, type ReconcileBinder } from "./resolve";

interface GraphNodeBinding {
  nodeId: string;
  refPath: string | null;
}

interface GraphNodeRow {
  id: string;
  type: string;
  label: string;
  ref_path: string | null;
  attrs_json: string | null;
}

/** Index of normalized name/slug/alias → graph node binding, built once per pass per type. */
interface BindIndex {
  byNorm: Map<string, GraphNodeBinding>;
}

function parseAttrs(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Build the person + project binding indexes from a read-only graph.sqlite handle. */
function buildIndexes(db: Database.Database): { person: BindIndex; project: BindIndex } {
  const person: BindIndex = { byNorm: new Map() };
  const project: BindIndex = { byNorm: new Map() };

  const add = (idx: BindIndex, key: string, binding: GraphNodeBinding): void => {
    const norm = normName(key);
    if (norm && !idx.byNorm.has(norm)) idx.byNorm.set(norm, binding);
  };

  const rows = db
    .prepare("SELECT id, type, label, ref_path, attrs_json FROM graph_nodes WHERE type IN ('person','project')")
    .all() as GraphNodeRow[];
  for (const row of rows) {
    const attrs = parseAttrs(row.attrs_json);
    const slug = typeof attrs.slug === "string" ? attrs.slug : null;
    const binding: GraphNodeBinding = { nodeId: row.id, refPath: row.ref_path };
    if (row.type === "person") {
      add(person, row.label, binding);
      if (slug) add(person, slug, binding);
      const aliases = Array.isArray(attrs.aliases) ? attrs.aliases : [];
      for (const a of aliases) if (typeof a === "string") add(person, a, binding);
    } else {
      add(project, row.label, binding);
      if (slug) add(project, slug, binding);
    }
  }
  return { person, project };
}

/**
 * Create the reconcile binder for a resolution pass. person/project entities bind to a
 * matching graph node by exact normalized slug/label/alias; idea/source and unmatched
 * person/project mint fresh. The graph db is opened once, read-only, and closed when
 * `close()` is called. Returns a no-op (mint-only) binder when graph.sqlite is absent.
 */
export function createReconcileBinder(): { binder: ReconcileBinder; close: () => void } {
  const graphPath = getGraphDbPath();
  if (!fs.existsSync(graphPath)) {
    // No graph cache yet — everything mints fresh with graph_node_id=NULL (risk #2).
    return { binder: mintBinding, close: () => {} };
  }

  let db: Database.Database;
  try {
    db = new Database(graphPath, { readonly: true, fileMustExist: true });
  } catch {
    return { binder: mintBinding, close: () => {} };
  }

  let indexes: { person: BindIndex; project: BindIndex };
  try {
    indexes = buildIndexes(db);
  } catch {
    db.close();
    return { binder: mintBinding, close: () => {} };
  }

  const binder: ReconcileBinder = (type, canonicalName): EntityBinding => {
    if (type !== "person" && type !== "project") return mintBinding(type, canonicalName);
    const idx = type === "person" ? indexes.person : indexes.project;
    const hit = idx.byNorm.get(normName(canonicalName));
    if (hit) {
      // Adopt the graph node's id — the entity IS the node (guarantees 1:1, makes the
      // later graph-integration step a no-op for this entity).
      return { id: hit.nodeId, graphNodeId: hit.nodeId, refPath: hit.refPath };
    }
    // A named person/project with no graph node mints fresh (graph_node_id=NULL); a later
    // file appearing binds it on the next incremental reconcile (alias add, no new id).
    return mintBinding(type, canonicalName);
  };

  return { binder, close: () => db.close() };
}

/** Convenience: the canonical graph node id a slug would adopt (for callers/tests). */
export function graphNodeIdFor(type: "person" | "project", slug: string): string {
  return type === "person" ? personNodeId(slug) : projectNodeId(slug);
}
