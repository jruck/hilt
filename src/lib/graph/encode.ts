/**
 * Binary payload encoder/decoder — the durable wire contract (Phase 0).
 *
 * The renderer is the replaceable half; this format is the durable investment.
 * The server lays out positions once and ships a compact binary buffer; the
 * client loads it into GPU buffers and renders, freezing at rest.
 *
 * Canonical wire format (the ONE binary layout; GraphPayload is the DECODED shape):
 *
 *   [ HEADER 32 bytes (Uint32 view) ]
 *     magic        u32   0x48474C31  // "HGL1"
 *     version      u32   TRANSPORT_FORMAT_VERSION
 *     nodeCount    u32
 *     edgeCount    u32
 *     flags        u32   bit0=hasZ, bit1=includesTags, bit2=isLocal, bit3=truncated
 *     reserved     u32 x3
 *   [ POSITIONS    Float32Array(nodeCount * 2) ]   // x,y interleaved (x3 if hasZ)
 *   [ COLOR_KEYS   Uint8Array(nodeCount) ]          // enum index into colorKeyTable
 *   [ pad to 4-byte boundary ]
 *   [ EDGES        Float32Array(edgeCount * 2) ]    // [srcIdx,tgtIdx,...] point ARRAY INDICES (Float32)
 *   [ EDGE_KINDS   Uint8Array(edgeCount) ]          // v2: enum index into edgeKindTable (per edge)
 *   [ pad to 4-byte boundary ]
 *   [ METALEN      u32 ]                            // byte length of the JSON tail
 *   [ META         UTF-8 JSON ]
 *     { "ids":[...], "labels":[...], "types":[...uint], "colorKeyTable":[...string],
 *       "edgeKindTable":[...string] }               // v2
 *
 * Corrected, non-negotiable facts (baked in everywhere):
 *  - EDGES is Float32Array, NOT Uint32Array. cosmos.gl `setLinks` and
 *    `setPointPositions` both consume Float32Array. (Float32 mantissa is 24 bits,
 *    so indices are exact only to 2^24 (~16.7M) — fine for this vault.)
 *  - `types` is interned to a numeric enum (the GraphNodeType ordinal), NOT strings.
 *  - `refPaths` is DROPPED from the bulk sidecar — it is resolved lazily via
 *    GET /node/:id at click time, not for every node.
 *  - COLOR_KEYS is a 1-byte-per-node enum into the per-payload `colorKeyTable`
 *    (so dynamic `area:<slug>` keys cost ~1 byte/node, not a full string each).
 *  - Three distinct versions, distinct names: TRANSPORT_FORMAT_VERSION (header),
 *    LAYOUT_VERSION (graph_meta), cosmos.gl version (package.json). Never conflated.
 */

import * as path from "path";
import { LAYOUT_VERSION, TRANSPORT_FORMAT_VERSION } from "./config";
import { getAllNodePositions, type GraphSelection, type NodePositionRow } from "./db";
import type { GraphNode } from "./types";
import { GraphFormatError } from "./types";

/** "HGL1" — magic guarding against rendering garbage from a bad/stale buffer. */
export const GRAPH_MAGIC = 0x48474c31;

const HEADER_BYTES = 32; // 8 x u32

/** Header flag bits. */
export const FLAG_HAS_Z = 1 << 0;
export const FLAG_INCLUDES_TAGS = 1 << 1;
export const FLAG_IS_LOCAL = 1 << 2;
export const FLAG_TRUNCATED = 1 << 3;

/**
 * Stable ordinal for each node type — the `types` sidecar enum. Index is the
 * GraphNodeType order; the client maps ordinal -> type -> CSS color token. Append
 * ONLY (never reorder) — appending is back-compatible under the format version.
 */
export const NODE_TYPE_ORDER = [
  "note",
  "reference",
  "candidate",
  "person",
  "project",
  "north_star",
  "library_cluster",
  "tag",
  "topic", // ordinal 8 — semantic overlay (append-only; no TRANSPORT_FORMAT_VERSION bump)
  "entity", // ordinal 9 — semantic overlay
] as const;

const TYPE_TO_ORDINAL = new Map<string, number>(NODE_TYPE_ORDER.map((t, i) => [t, i]));

/** Decoded sidecar (index-aligned to positions). `refPaths` intentionally absent. */
export interface GraphSidecar {
  ids: string[];
  labels: string[];
  /** GraphNodeType ordinals (NODE_TYPE_ORDER). */
  types: number[];
  /** Distinct color keys; COLOR_KEYS bytes index into this table. */
  colorKeyTable: string[];
  /** Per-node folder-group index into `folderTable` (top-level vault folder). */
  folders: number[];
  /** Distinct folder-group keys; `folders` indexes into this table. */
  folderTable: string[];
  /** v2: distinct edge kinds; EDGE_KINDS bytes index into this table (per-payload interning). */
  edgeKindTable: string[];
}

/** Fully decoded binary payload (mirrors GraphPayload + the wire-only extras). */
export interface DecodedGraph {
  version: number;
  nodeCount: number;
  edgeCount: number;
  hasZ: boolean;
  includesTags: boolean;
  isLocal: boolean;
  truncated: boolean;
  positions: Float32Array;
  colorKeys: Uint8Array;
  /** Point ARRAY INDICES (Float32 for cosmos.gl setLinks). */
  links: Float32Array;
  /** v2: per-edge kind (index into sidecar.edgeKindTable), lockstep with link pairs. */
  edgeKinds: Uint8Array;
  sidecar: GraphSidecar;
}

export interface EncodeOptions {
  isLocal?: boolean;
  includesTags?: boolean;
  /** Vault root for deriving the per-node folder-group (top-level folder). */
  vaultRoot?: string;
}

/**
 * Top-level vault folder for a node (the folder-clustering group key). Persons group
 * as "people"; synthetic/pathless nodes group by type; otherwise the first path
 * segment under the vault root (e.g. "meetings", "projects", "references").
 */
export function folderGroupOf(node: GraphNode, vaultRoot: string | undefined): string {
  if (node.type === "person") return "people";
  const rp = node.refPath;
  if (!rp || !rp.startsWith("/")) return node.type;
  if (vaultRoot && rp.startsWith(vaultRoot)) {
    const rel = path.relative(vaultRoot, rp).split(path.sep).join("/");
    const top = rel.split("/")[0];
    if (top && top !== "..") return top;
  }
  return path.basename(path.dirname(rp)) || node.type;
}

/**
 * Encode a selection (nodes + induced edges) into the canonical binary buffer.
 * Positions are looked up from `node_positions`; any node missing a persisted
 * position falls back to (0,0) (the route flags `dirty` in /meta; the client
 * gates the canvas on built_at, so it never renders seeded-initial coords).
 */
export function encodeGraphBinary(selection: GraphSelection, opts: EncodeOptions = {}): ArrayBuffer {
  const { nodes, edges } = selection;
  const positionsById = getAllNodePositions();
  return encodeFromParts(nodes, edges, positionsById, {
    isLocal: opts.isLocal ?? false,
    includesTags: opts.includesTags ?? false,
    truncated: selection.truncated,
    vaultRoot: opts.vaultRoot,
  });
}

/**
 * Pure encoder — positions supplied explicitly (testable without a DB read).
 * Assigns a deterministic index per node in the order `nodes` is given (callers
 * pass a stable id-sorted order), then remaps edges to those indices, dropping
 * any edge whose endpoint is not in the node set (defensive — selection induces).
 */
export function encodeFromParts(
  nodes: GraphNode[],
  edges: GraphSelection["edges"],
  positionsById: Map<string, NodePositionRow>,
  flags: { isLocal: boolean; includesTags: boolean; truncated: boolean; vaultRoot?: string },
): ArrayBuffer {
  const nodeCount = nodes.length;

  // Index assignment (the index-vs-id map the sidecar materializes).
  const indexById = new Map<string, number>();
  for (let i = 0; i < nodeCount; i++) indexById.set(nodes[i].id, i);

  // Positions (2D v1 — hasZ stays false; positions are x,y interleaved).
  const positions = new Float32Array(nodeCount * 2);
  for (let i = 0; i < nodeCount; i++) {
    const pos = positionsById.get(nodes[i].id);
    positions[i * 2] = sanitizeFloat(pos?.x);
    positions[i * 2 + 1] = sanitizeFloat(pos?.y);
  }

  // Color keys interned to a per-payload table (dynamic area:<slug> keys included).
  const colorKeyTable: string[] = [];
  const colorKeyIndex = new Map<string, number>();
  const colorKeys = new Uint8Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    const key = nodes[i].colorKey ?? nodes[i].type;
    let idx = colorKeyIndex.get(key);
    if (idx === undefined) {
      idx = colorKeyTable.length;
      // Uint8 ceiling: clamp the table at 255 distinct keys; overflow shares slot 0.
      if (idx > 255) idx = 0;
      else {
        colorKeyTable.push(key);
        colorKeyIndex.set(key, idx);
      }
    }
    colorKeys[i] = idx;
  }

  // Edges -> index pairs (drop any edge whose endpoint left the selection), with the
  // edge KIND interned per payload (v2) in lockstep — the client's edge-kind mixer.
  const indexPairs: number[] = [];
  const edgeKindTable: string[] = [];
  const edgeKindIndex = new Map<string, number>();
  const kindBytes: number[] = [];
  for (const edge of edges) {
    const s = indexById.get(edge.source);
    const t = indexById.get(edge.target);
    if (s === undefined || t === undefined) continue;
    indexPairs.push(s, t);
    let k = edgeKindIndex.get(edge.kind);
    if (k === undefined) {
      k = edgeKindTable.length;
      // Uint8 ceiling (10 kinds today; defensive vs. far-future growth): overflow shares slot 0.
      if (k > 255) k = 0;
      else {
        edgeKindTable.push(edge.kind);
        edgeKindIndex.set(edge.kind, k);
      }
    }
    kindBytes.push(k);
  }
  const edgeCount = indexPairs.length / 2;
  const links = new Float32Array(indexPairs);
  const edgeKinds = new Uint8Array(kindBytes);

  // Folder-group per node, interned into a small table (folder-clustering hint).
  const folderTable: string[] = [];
  const folderIndex = new Map<string, number>();
  const folders = new Array<number>(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    const key = folderGroupOf(nodes[i], flags.vaultRoot);
    let idx = folderIndex.get(key);
    if (idx === undefined) {
      idx = folderTable.length;
      folderTable.push(key);
      folderIndex.set(key, idx);
    }
    folders[i] = idx;
  }

  // Sidecar (refPaths dropped; types interned to ordinals).
  const sidecar: GraphSidecar = {
    ids: nodes.map((n) => n.id),
    labels: nodes.map((n) => n.label),
    types: nodes.map((n) => TYPE_TO_ORDINAL.get(n.type) ?? 0),
    colorKeyTable,
    folders,
    folderTable,
    edgeKindTable,
  };
  const metaBytes = new TextEncoder().encode(JSON.stringify(sidecar));

  // ---- Lay out the buffer ----
  const positionsBytes = positions.byteLength;
  const colorBytes = colorKeys.byteLength;
  const padAfterColors = (4 - ((HEADER_BYTES + positionsBytes + colorBytes) % 4)) % 4;
  const edgesBytes = links.byteLength;
  const edgeKindBytes = edgeKinds.byteLength;
  const padAfterKinds =
    (4 - ((HEADER_BYTES + positionsBytes + colorBytes + padAfterColors + edgesBytes + edgeKindBytes) % 4)) % 4;
  const total =
    HEADER_BYTES + positionsBytes + colorBytes + padAfterColors + edgesBytes + edgeKindBytes + padAfterKinds + 4 + metaBytes.byteLength;

  const buffer = new ArrayBuffer(total);
  const u32 = new Uint32Array(buffer, 0, 8);
  u32[0] = GRAPH_MAGIC;
  u32[1] = TRANSPORT_FORMAT_VERSION;
  u32[2] = nodeCount;
  u32[3] = edgeCount;
  let flagBits = 0;
  if (flags.includesTags) flagBits |= FLAG_INCLUDES_TAGS;
  if (flags.isLocal) flagBits |= FLAG_IS_LOCAL;
  if (flags.truncated) flagBits |= FLAG_TRUNCATED;
  u32[4] = flagBits;
  // u32[5..7] reserved (zero).

  const bytes = new Uint8Array(buffer);
  let offset = HEADER_BYTES;
  bytes.set(new Uint8Array(positions.buffer, positions.byteOffset, positionsBytes), offset);
  offset += positionsBytes;
  bytes.set(colorKeys, offset);
  offset += colorBytes + padAfterColors;
  bytes.set(new Uint8Array(links.buffer, links.byteOffset, edgesBytes), offset);
  offset += edgesBytes;
  bytes.set(edgeKinds, offset);
  offset += edgeKindBytes + padAfterKinds;
  new DataView(buffer).setUint32(offset, metaBytes.byteLength, true);
  offset += 4;
  bytes.set(metaBytes, offset);

  return buffer;
}

/**
 * Decode the canonical buffer back to typed arrays + sidecar. Validates magic +
 * version (throws GraphFormatError so the client hard-refreshes rather than
 * rendering garbage). EDGES are returned as Float32Array for setLinks. Used by the
 * `fmt=json` debug path, the round-trip test, and (mirrored) the client decoder.
 */
export function decodeGraphBinary(buffer: ArrayBuffer): DecodedGraph {
  if (buffer.byteLength < HEADER_BYTES) {
    throw new GraphFormatError(`Graph buffer too small: ${buffer.byteLength} bytes`);
  }
  const u32 = new Uint32Array(buffer, 0, 8);
  const magic = u32[0];
  if (magic !== GRAPH_MAGIC) {
    throw new GraphFormatError(`Bad graph magic: 0x${magic.toString(16)}`);
  }
  const version = u32[1];
  if (version !== TRANSPORT_FORMAT_VERSION) {
    throw new GraphFormatError(`Unsupported graph format version: ${version}`);
  }
  const nodeCount = u32[2];
  const edgeCount = u32[3];
  const flagBits = u32[4];
  const hasZ = (flagBits & FLAG_HAS_Z) !== 0;
  const includesTags = (flagBits & FLAG_INCLUDES_TAGS) !== 0;
  const isLocal = (flagBits & FLAG_IS_LOCAL) !== 0;
  const truncated = (flagBits & FLAG_TRUNCATED) !== 0;

  const componentsPerNode = hasZ ? 3 : 2;
  let offset = HEADER_BYTES;

  const positionsLen = nodeCount * componentsPerNode;
  const positions = readFloat32(buffer, offset, positionsLen);
  offset += positionsLen * 4;

  const colorKeys = new Uint8Array(buffer.slice(offset, offset + nodeCount));
  offset += nodeCount;
  offset += (4 - (offset % 4)) % 4; // skip pad to 4-byte boundary

  const edgesLen = edgeCount * 2;
  const links = readFloat32(buffer, offset, edgesLen);
  offset += edgesLen * 4;

  const edgeKinds = new Uint8Array(buffer.slice(offset, offset + edgeCount));
  offset += edgeCount;
  offset += (4 - (offset % 4)) % 4; // skip pad to 4-byte boundary

  const metaLen = new DataView(buffer).getUint32(offset, true);
  offset += 4;
  const metaJson = new TextDecoder().decode(new Uint8Array(buffer, offset, metaLen));
  let sidecar: GraphSidecar;
  try {
    sidecar = JSON.parse(metaJson) as GraphSidecar;
  } catch {
    throw new GraphFormatError("Graph sidecar JSON parse failed");
  }

  return {
    version,
    nodeCount,
    edgeCount,
    hasZ,
    includesTags,
    isLocal,
    truncated,
    positions,
    colorKeys,
    links,
    edgeKinds,
    sidecar,
  };
}

/** Read a Float32Array view honoring byte alignment (slices when misaligned). */
function readFloat32(buffer: ArrayBuffer, byteOffset: number, length: number): Float32Array {
  if (length === 0) return new Float32Array(0);
  if (byteOffset % 4 === 0) {
    return new Float32Array(buffer, byteOffset, length);
  }
  return new Float32Array(buffer.slice(byteOffset, byteOffset + length * 4));
}

/** Coerce undefined/NaN/Infinity coordinates to 0 — never ship non-finite floats. */
function sanitizeFloat(value: number | null | undefined): number {
  return value != null && Number.isFinite(value) ? value : 0;
}

/** Response headers carrying the wire/layout versions + counts (route helper). */
export function graphPayloadHeaders(decodedCounts: {
  nodeCount: number;
  edgeCount: number;
  truncated: boolean;
}): Record<string, string> {
  return {
    "Content-Type": "application/octet-stream",
    "X-Graph-Format-Version": String(TRANSPORT_FORMAT_VERSION),
    "X-Graph-Layout-Version": String(LAYOUT_VERSION),
    "X-Graph-Node-Count": String(decodedCounts.nodeCount),
    "X-Graph-Edge-Count": String(decodedCounts.edgeCount),
    "X-Graph-Truncated": decodedCounts.truncated ? "1" : "0",
    "Cache-Control": "no-store",
  };
}
