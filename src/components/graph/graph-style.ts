/**
 * Graph visual styling — color-by-type/area palette, degree -> size, label LOD.
 *
 * Colors are precomputed into the COLOR_KEYS enum on the server and resolved to
 * RGBA here from a fixed palette (re-derived on theme change). North Stars get a
 * permanent emphasis (size floor) regardless of degree. Pushed via setPointColors
 * once per data/theme change — never per frame.
 *
 * `colorKeyTable` entries are either a GraphNodeType ("note", "person", ...) or a
 * contextual `area:<slug>` bucket (contextual-color philosophy: a reference/note/
 * project prefers its owning North-Star area color). Unknown keys fall back to the
 * note color.
 */

export type RGBA = [number, number, number, number];

/**
 * Tailwind palette (v3 hex → 0-255 RGB) — the single source of graph colors so the
 * graph reads as cohesively as the rest of the app. `l` = shade 500 (light theme),
 * `d` = shade 400 (dark theme), both vivid and harmonious. cosmos.gl wants 0-1 RGBA,
 * normalized at buffer-build; these stay 0-255 for legend/CSS reuse.
 */
const TW: Record<string, { l: [number, number, number]; d: [number, number, number] }> = {
  slate:   { l: [100, 116, 139], d: [148, 163, 184] },
  red:     { l: [239, 68, 68],   d: [248, 113, 113] },
  orange:  { l: [249, 115, 22],  d: [251, 146, 60] },
  amber:   { l: [245, 158, 11],  d: [251, 191, 36] },
  yellow:  { l: [234, 179, 8],   d: [250, 204, 21] },
  lime:    { l: [132, 204, 22],  d: [163, 230, 53] },
  green:   { l: [34, 197, 94],   d: [74, 222, 128] },
  emerald: { l: [16, 185, 129],  d: [52, 211, 153] },
  teal:    { l: [20, 184, 166],  d: [45, 212, 191] },
  cyan:    { l: [6, 182, 212],   d: [34, 211, 238] },
  sky:     { l: [14, 165, 233],  d: [56, 189, 248] },
  blue:    { l: [59, 130, 246],  d: [96, 165, 250] },
  indigo:  { l: [99, 102, 241],  d: [129, 140, 248] },
  violet:  { l: [139, 92, 246],  d: [167, 139, 250] },
  purple:  { l: [168, 85, 247],  d: [192, 132, 252] },
  fuchsia: { l: [217, 70, 239],  d: [232, 121, 249] },
  pink:    { l: [236, 72, 153],  d: [244, 114, 182] },
  rose:    { l: [244, 63, 94],   d: [251, 113, 133] },
};

function tw(name: keyof typeof TW | string, theme: "light" | "dark"): RGBA {
  const c = TW[name] ?? TW.slate;
  const [r, g, b] = theme === "dark" ? c.d : c.l;
  return [r, g, b, 1];
}

/** Node type → Tailwind hue. `note` is folder-colored at buffer-build, so this is its fallback. */
const TYPE_HUE: Record<string, keyof typeof TW> = {
  note: "slate",
  reference: "blue",
  candidate: "amber",
  person: "emerald",
  project: "violet",
  north_star: "rose",
  library_cluster: "teal",
  tag: "slate",
};

/**
 * Ordered categorical hues for folder/area grouping — cycled by group index. Hand-spread
 * so adjacent groups read apart, and it's the palette that colors the ~79% of nodes that
 * are notes (by folder) so nothing renders as undifferentiated grey.
 */
const FOLDER_HUES: (keyof typeof TW)[] = [
  "blue", "emerald", "violet", "amber", "rose", "cyan",
  "lime", "fuchsia", "orange", "teal", "indigo", "pink", "sky", "purple",
];

function folderHue(index: number, theme: "light" | "dark"): RGBA {
  const n = FOLDER_HUES.length;
  return tw(FOLDER_HUES[((index % n) + n) % n], theme);
}

/** Resolve a single colorKeyTable entry to RGBA for the given theme. */
export function resolveColorKey(key: string, theme: "light" | "dark"): RGBA {
  if (key in TYPE_HUE) return tw(TYPE_HUE[key], theme);
  if (key.startsWith("area:")) return folderHue(hashString(key), theme);
  return tw("slate", theme);
}

/**
 * Build the per-point RGBA color buffer (Float32Array, 4 components/point) by node type
 * from the COLOR_KEYS enum + the payload's colorKeyTable. Typed entities get their semantic
 * hue; generic `note` nodes get a neutral slate so the people/projects/references pop.
 * Resolved once per data/theme change.
 */
export function buildColorBuffer(
  colorKeys: Uint8Array,
  colorKeyTable: string[],
  theme: "light" | "dark",
): Float32Array {
  // Resolve each distinct table slot once, then fan out per point.
  const resolved: RGBA[] = colorKeyTable.map((key) => resolveColorKey(key, theme));
  const fallback = resolveColorKey("note", theme);
  const out = new Float32Array(colorKeys.length * 4);
  for (let i = 0; i < colorKeys.length; i++) {
    const rgba = resolved[colorKeys[i]] ?? fallback;
    // cosmos.gl 2.6.4 setPointColors expects NORMALIZED 0-1 RGBA (its d.ts example
    // showing 0-255 is misleading — values >1 clamp to white). Normalize RGB here.
    out[i * 4] = rgba[0] / 255;
    out[i * 4 + 1] = rgba[1] / 255;
    out[i * 4 + 2] = rgba[2] / 255;
    out[i * 4 + 3] = rgba[3];
  }
  return out;
}

const MIN_SIZE = 6;
const MAX_SIZE = 32;
/** Single-link leaf nodes are shrunk hard so the connected structure reads over the halo. */
const LEAF_SIZE = 2.5;
/** North Stars (and other hubs) get a size floor regardless of degree. */
const NORTH_STAR_SIZE_FLOOR = 20;

/**
 * Build the per-point size buffer. Size = MIN + (MAX-MIN)*sqrt(degree/maxDegree),
 * with a floor for North Stars (type ordinal 5 in NODE_TYPE_ORDER). Degree is
 * derived from the links buffer (adjacency count) so the sidecar stays lean.
 */
export function buildSizeBuffer(degrees: Uint32Array, typeOrdinals: number[]): Float32Array {
  let maxDegree = 1;
  for (let i = 0; i < degrees.length; i++) {
    if (degrees[i] > maxDegree) maxDegree = degrees[i];
  }
  const out = new Float32Array(degrees.length);
  for (let i = 0; i < degrees.length; i++) {
    // Shrink single-link leaves so they recede behind the connected structure.
    if (degrees[i] <= 1 && typeOrdinals[i] !== 5) { out[i] = LEAF_SIZE; continue; }
    const norm = Math.sqrt(degrees[i] / maxDegree);
    let size = MIN_SIZE + (MAX_SIZE - MIN_SIZE) * norm;
    // north_star ordinal === 5 (NODE_TYPE_ORDER): permanent emphasis.
    if (typeOrdinals[i] === 5 && size < NORTH_STAR_SIZE_FLOOR) size = NORTH_STAR_SIZE_FLOOR;
    out[i] = size;
  }
  return out;
}

/** Compute per-point degree from the links buffer (index pairs). O(edges). */
export function degreesFromLinks(links: Float32Array, nodeCount: number): Uint32Array {
  const degrees = new Uint32Array(nodeCount);
  for (let i = 0; i < links.length; i += 2) {
    const s = links[i];
    const t = links[i + 1];
    if (s >= 0 && s < nodeCount) degrees[s]++;
    if (t >= 0 && t < nodeCount) degrees[t]++;
  }
  return degrees;
}

/**
 * Build the adjacency map (index -> neighbor indices) once from the links buffer,
 * used for O(degree) hover-highlight. Cheaper to keep here than to ask cosmos each hover.
 */
export function buildAdjacency(links: Float32Array, nodeCount: number): Map<number, number[]> {
  const adj = new Map<number, number[]>();
  for (let i = 0; i < links.length; i += 2) {
    const s = links[i];
    const t = links[i + 1];
    if (s < 0 || s >= nodeCount || t < 0 || t >= nodeCount) continue;
    (adj.get(s) ?? adj.set(s, []).get(s)!).push(t);
    (adj.get(t) ?? adj.set(t, []).get(t)!).push(s);
  }
  return adj;
}

/** Label LOD thresholds keyed off zoom level. Higher thresholds on mobile (text soup). */
export interface LabelLOD {
  /** Below this zoom, show no labels (avoid global-graph text soup). */
  hideBelow: number;
  /** Above this zoom, show all on-screen labels. */
  allAbove: number;
}

export function labelLODForDevice(aggressive: boolean): LabelLOD {
  return aggressive ? { hideBelow: 2.0, allAbove: 6.0 } : { hideBelow: 1.2, allAbove: 4.0 };
}

/**
 * Theme-aware edge color. Subtle but legible on the warm light canvas (cosmos' default
 * link color washes out against `--bg-primary`). Alpha multiplies per-link alpha.
 */
export function resolveLinkColor(theme: "light" | "dark"): string {
  return theme === "dark" ? "rgba(148, 163, 184, 0.22)" : "rgba(71, 85, 105, 0.30)";
}

/** Detect the active theme from the document root (re-read on theme change). */
export function currentTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
