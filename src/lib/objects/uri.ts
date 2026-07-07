/**
 * `hilt:` URI grammar (v3 unit B5) — markdown carries object references as ordinary links:
 * `[display text](hilt:kind/id)`. Parsing splits on the FIRST "/" after the scheme because
 * meeting/project ids are vault-relative paths that themselves contain "/".
 *
 * Encoding contract: buildHiltUri percent-encodes each "/"-separated id segment (spaces,
 * unicode, parens stay markdown-safe) while preserving the "/" separators; parseHiltUri
 * decodes per segment. Un-encoded ids (hand-written links with literal spaces) still parse —
 * decodeURIComponent is a no-op on them — and malformed % sequences degrade to the literal id.
 */
import type { ObjectKind, ObjectRef } from "./types";

export const OBJECT_KINDS: readonly ObjectKind[] = ["meeting", "task", "person", "project", "library"];

const KIND_SET: ReadonlySet<string> = new Set(OBJECT_KINDS);

export function isObjectKind(value: unknown): value is ObjectKind {
  return typeof value === "string" && KIND_SET.has(value);
}

export function parseHiltUri(href: string): ObjectRef | null {
  if (typeof href !== "string" || !href.startsWith("hilt:")) return null;
  const rest = href.slice("hilt:".length);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  const kind = rest.slice(0, slash);
  if (!isObjectKind(kind)) return null;
  const rawId = rest.slice(slash + 1);
  if (!rawId) return null;
  return { kind, id: decodeIdSegments(rawId) };
}

export function buildHiltUri(ref: ObjectRef): string {
  return `hilt:${ref.kind}/${encodeIdSegments(ref.id)}`;
}

/** Encode per path segment so id-internal "/" separators survive as real slashes. */
function encodeIdSegments(id: string): string {
  return id.split("/").map(encodeURIComponent).join("/");
}

function decodeIdSegments(rawId: string): string {
  try {
    return rawId.split("/").map(decodeURIComponent).join("/");
  } catch {
    // Malformed % sequence (e.g. a hand-written "50%" in an id) — treat the id literally.
    return rawId;
  }
}
