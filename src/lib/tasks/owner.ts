/**
 * Owner-prefix parsing for loop item titles (render-level only).
 *
 * The meeting-actions loop prefixes non-justin owners into the TITLE — `[unclear] …` /
 * `[other:Name] …` — so TEXT surfaces (the loop artifact markdown, the briefing source) carry
 * the ownership signal inline. In the APP the bracket is noise: this parser strips it from the
 * displayed title so surfaces can render a small owner chip instead. The loop script and the
 * markdown keep the prefix — this is a display bridge, not a data change.
 */

export type OwnerTag = { kind: "unclear" } | { kind: "other"; name: string };

export interface ParsedOwnerTitle {
  /** The title with any leading owner prefix removed (unchanged when there is none). */
  title: string;
  /** null = Justin's own commitment (the loop writes no prefix for owner "justin"). */
  owner: OwnerTag | null;
}

/** Only the two prefixes the loop actually writes — a generic `[anything]` (footnote markers,
 * editorial brackets) must pass through untouched. */
const OWNER_PREFIX = /^\[(unclear|other:([^\]]+))\]\s+/;

export function parseOwnerPrefix(rawTitle: string): ParsedOwnerTitle {
  const match = rawTitle.match(OWNER_PREFIX);
  if (!match) return { title: rawTitle, owner: null };
  const title = rawTitle.slice(match[0].length);
  if (match[1] === "unclear") return { title, owner: { kind: "unclear" } };
  return { title, owner: { kind: "other", name: match[2].trim() } };
}

/** Chip copy — label + plain-language tooltip (why this is shown, what acting on it does). */
export function ownerChip(owner: OwnerTag | null): { label: string; title: string } | null {
  if (!owner) return null;
  if (owner.kind === "unclear") {
    return {
      label: "owner unclear",
      title: "The extractor couldn't tell whose commitment this is — your verdict also teaches it",
    };
  }
  return {
    label: `owner: ${owner.name}`,
    title: "Someone else said they'd do this — shown because it may need your attention",
  };
}
