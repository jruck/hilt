/**
 * Client-side binary decoder (`decodeGraphBinary`).
 *
 * Mirrors the server wire contract (src/lib/graph/encode.ts). The renderer fetches
 * `GET /api/system/graph` as an ArrayBuffer and decodes it here into typed-array
 * views the cosmos.gl `Graph` consumes directly. Self-contained (no server imports)
 * so the client bundle never pulls in better-sqlite3 / Node modules.
 *
 * Canonical wire format:
 *   [ HEADER 32 bytes (Uint32 view) ]
 *     magic u32 0x48474C31 ("HGL1"), version u32, nodeCount u32, edgeCount u32,
 *     flags u32 (bit0=hasZ, bit1=includesTags, bit2=isLocal, bit3=truncated), reserved u32 x3
 *   [ POSITIONS  Float32Array(nodeCount * 2) ]   x,y interleaved
 *   [ COLOR_KEYS Uint8Array(nodeCount) ]          enum index into colorKeyTable
 *   [ pad to 4-byte boundary ]
 *   [ EDGES      Float32Array(edgeCount * 2) ]    point ARRAY INDICES (Float32, for setLinks)
 *   [ METALEN u32 ][ META UTF-8 JSON ]            { ids, labels, types, colorKeyTable }
 *
 * On magic/version mismatch we throw GraphFormatError so the caller hard-refreshes
 * rather than rendering garbage. EDGES are always returned as Float32Array.
 */

import { TRANSPORT_FORMAT_VERSION } from "@/lib/graph/config";

/** "HGL1" — guards against rendering garbage from a stale/corrupt buffer. */
const GRAPH_MAGIC = 0x48474c31;
const HEADER_BYTES = 32; // 8 x u32

const FLAG_HAS_Z = 1 << 0;
const FLAG_INCLUDES_TAGS = 1 << 1;
const FLAG_IS_LOCAL = 1 << 2;
const FLAG_TRUNCATED = 1 << 3;

/** Client copy of the format error (server has its own in lib/graph/types). */
export class GraphFormatError extends Error {}

/** Decoded sidecar (index-aligned to positions). `refPaths` intentionally absent. */
export interface GraphSidecar {
  ids: string[];
  labels: string[];
  /** GraphNodeType ordinals (NODE_TYPE_ORDER on the server). */
  types: number[];
  /** Distinct color keys; COLOR_KEYS bytes index into this table. */
  colorKeyTable: string[];
  /** Per-node folder-group index into `folderTable`. Optional (absent in stale buffers). */
  folders?: number[];
  /** Distinct folder-group keys; `folders` indexes into this table. */
  folderTable?: string[];
}

export interface DecodedGraph {
  version: number;
  nodeCount: number;
  edgeCount: number;
  hasZ: boolean;
  includesTags: boolean;
  isLocal: boolean;
  truncated: boolean;
  /** [x0,y0, x1,y1, ...] index-aligned to sidecar. */
  positions: Float32Array;
  colorKeys: Uint8Array;
  /** Point ARRAY INDICES (Float32 for cosmos.gl setLinks). */
  links: Float32Array;
  sidecar: GraphSidecar;
}

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
    sidecar,
  };
}

/**
 * Project a decoded payload down to the nodes whose type ordinal is NOT hidden — the
 * legend's per-type visibility toggles. Pure + index-remapping: positions/colorKeys/
 * sidecar arrays are filtered in lockstep, links keep only pairs with BOTH endpoints
 * visible (remapped to the new indices). Layout positions are preserved per node, so
 * toggling a type never moves anything — it only lifts the veil. No-op (same object)
 * when nothing is hidden.
 */
export function filterDecodedByTypes(decoded: DecodedGraph, hiddenOrdinals: Set<number>): DecodedGraph {
  if (hiddenOrdinals.size === 0) return decoded;
  const comps = decoded.hasZ ? 3 : 2;
  const types = decoded.sidecar.types;

  const oldToNew = new Int32Array(decoded.nodeCount).fill(-1);
  let kept = 0;
  for (let i = 0; i < decoded.nodeCount; i++) {
    if (!hiddenOrdinals.has(types[i] ?? 0)) oldToNew[i] = kept++;
  }
  if (kept === decoded.nodeCount) return decoded;

  const positions = new Float32Array(kept * comps);
  const colorKeys = new Uint8Array(kept);
  const ids = new Array<string>(kept);
  const labels = new Array<string>(kept);
  const newTypes = new Array<number>(kept);
  const folders = decoded.sidecar.folders ? new Array<number>(kept) : undefined;
  for (let i = 0; i < decoded.nodeCount; i++) {
    const ni = oldToNew[i];
    if (ni === -1) continue;
    for (let c = 0; c < comps; c++) positions[ni * comps + c] = decoded.positions[i * comps + c];
    colorKeys[ni] = decoded.colorKeys[i];
    ids[ni] = decoded.sidecar.ids[i];
    labels[ni] = decoded.sidecar.labels[i];
    newTypes[ni] = types[i] ?? 0;
    if (folders && decoded.sidecar.folders) folders[ni] = decoded.sidecar.folders[i];
  }

  const linkPairs: number[] = [];
  for (let e = 0; e < decoded.links.length; e += 2) {
    const a = oldToNew[decoded.links[e]];
    const b = oldToNew[decoded.links[e + 1]];
    if (a === -1 || b === -1 || a === undefined || b === undefined) continue;
    linkPairs.push(a, b);
  }

  return {
    ...decoded,
    nodeCount: kept,
    edgeCount: linkPairs.length / 2,
    positions,
    colorKeys,
    links: Float32Array.from(linkPairs),
    sidecar: {
      ...decoded.sidecar,
      ids,
      labels,
      types: newTypes,
      ...(folders ? { folders } : {}),
    },
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
