import type { ConnectionSuggestion, LibraryLifecycle } from "./types";
import { DEFAULT_SCORING_CONFIG, type LibraryScoringConfig } from "./scoring-config";

/**
 * L3 — the "food-taster" eval. For a STUDY item it computes a continuous **worth** score (how much this
 * should compete for attention right now) from two sovereign dimensions plus a freshness decay:
 *
 *     worth = relevance × substance × freshness_decay
 *
 * - **relevance** — does this bear on the practice? Vault-grounded connections (first-party ties dominate)
 *   + a light topical-fit signal, re-weighted on read against the *current* active context.
 * - **substance** — how much worthwhile material the source carries. Model-judged at reweave when
 *   available; otherwise a structural proxy from format/length/duration. NOT the digest's verbosity.
 * - **freshness** — a gentle decay multiplier (floors at 0.6), never a standalone score.
 *
 * It is cheap (pure arithmetic over stored data) and DYNAMIC — recompute as context shifts, never stamped.
 * Disposition (study/keep) is orthogonal and lives in `library_mode`, not here — the eval only scores
 * study items. The eval never moves files; it only suggests a `lifecycle` of `to_archive` (a
 * non-destructive review flag) for genuinely low-worth items, and only ones it has actually analyzed.
 */

export type { LibraryLifecycle } from "./types";

/** First-party = the user's own authored work, classified by the connection target path. */
function isFirstParty(target?: string | null): boolean {
  if (!target) return false;
  return /^(projects|areas|thoughts|people|writing)\//.test(target)
    || /^libraries\/[^/]+\/strategy\//.test(target)
    || /^libraries\/[^/]+\/projects\//.test(target);
}

export interface SubstanceSignals {
  format?: string | null;
  /** Length of the extracted SOURCE (not the digest). */
  sourceChars?: number | null;
  videoDurationSeconds?: number | null;
  /** Distinct findings the digest pulled — a proxy for how much signal the source carried. */
  findingsCount?: number | null;
}

const FORMAT_BASE: Record<string, number> = {
  tweet: 0.2, "tweet-thread": 0.4, link: 0.3, bookmark: 0.3, newsletter: 0.45, article: 0.55,
  "x-article": 0.5, video: 0.55, "long-form-guide": 0.8, book: 0.85, "podcast-notes": 0.6,
  "video-workshop-transcript": 0.72, "slide-deck": 0.5, document: 0.5, image: 0.15,
};

/**
 * Structural substance proxy — used only when a model-judged grade isn't present. Reflects the SOURCE
 * (format + length + duration + findings), so a long padded post doesn't beat a dense short one purely
 * on length, but a tweet never out-scores a 2-hour talk. A model grade always overrides this.
 */
export function structuralSubstance(s: SubstanceSignals): number {
  let v = FORMAT_BASE[(s.format || "").toLowerCase()] ?? 0.4;
  const chars = s.sourceChars || 0;
  if (chars > 12000) v += 0.2; else if (chars > 5000) v += 0.12; else if (chars > 1500) v += 0.05;
  const dur = s.videoDurationSeconds || 0;
  if (dur > 3600) v += 0.15; else if (dur > 1200) v += 0.08;
  const findings = s.findingsCount || 0;
  if (findings >= 6) v += 0.1; else if (findings >= 3) v += 0.05;
  return Math.max(0.05, Math.min(1, Number(v.toFixed(3))));
}

function freshnessDecay(createdAt: string): number {
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return 0.8;
  const days = (Date.now() - t) / 86_400_000;
  if (days <= 7) return 1.0;
  if (days <= 30) return 0.95;
  if (days <= 90) return 0.85;
  if (days <= 365) return 0.7;
  return 0.6;
}

// Worth below this, on an item we've actually analyzed, suggests `to_archive` (a review flag — never a
// move). Conservative; calibrated against the real corpus. NOTE (v2): the live value comes from the
// vault's versioned scoring config (meta/library-scoring.json) — this export remains as the default.
export const TO_ARCHIVE_WORTH = DEFAULT_SCORING_CONFIG.to_archive_worth;

export interface EvalInputs {
  /** Woven ties (LLM-judged). */
  connections: ConnectionSuggestion[];
  /** Topical fit to active projects/areas (0..~0.45): MAX of token-overlap and, for embedded
   *  saved refs, embedding cosine (semantic-relevance.ts). Capped at 0.3 in the relevance term. */
  contextFit: number;
  /** Top matched context label, for the "why". */
  contextLabel?: string | null;
  createdAt: string;
  /** Substance 0–1 — a model grade if present, else `structuralSubstance(...)`. */
  substance: number;
  /** The connection judge demonstrably ran (e.g. `reconnected_at` set). Gates `to_archive`. */
  analyzed?: boolean;
}

export interface WorthResult {
  worth: number;
  relevance: number;
  substance: number;
  freshness: number;
  /** Suggested lifecycle. `archived` is a manual state and is never produced here. */
  lifecycle: Exclude<LibraryLifecycle, "archived">;
  why: string;
}

export function evaluateArtifact(input: EvalInputs, config: LibraryScoringConfig = DEFAULT_SCORING_CONFIG): WorthResult {
  const firstParty = input.connections.filter((c) => isFirstParty(c.target));
  const fp = firstParty.length;
  const other = input.connections.length - fp;
  const r = config.relevance;
  // Diminishing returns on ties so heavily-connected items don't all pin at the ceiling.
  const relevance = Number(Math.min(1, r.first_party_coeff * Math.sqrt(fp) + r.other_coeff * other + Math.min(r.context_fit_cap, Math.max(0, input.contextFit))).toFixed(3));
  const substance = Math.max(0, Math.min(1, input.substance));
  const freshness = freshnessDecay(input.createdAt);
  const worth = Number((relevance * substance * freshness).toFixed(3));

  // Never flag an item we haven't actually analyzed — absence of ties there means "unknown", not "low".
  const analyzed = input.analyzed === true || input.connections.length > 0;
  const lifecycle: WorthResult["lifecycle"] = analyzed && worth < config.to_archive_worth ? "to_archive" : "active";

  return { worth, relevance, substance, freshness, lifecycle, why: buildWhy(firstParty, relevance, substance, freshness, input) };
}

function buildWhy(firstParty: ConnectionSuggestion[], relevance: number, substance: number, freshness: number, input: EvalInputs): string {
  const parts: string[] = [];
  const top = firstParty.slice(0, 2).map((c) => c.label).filter(Boolean).join(", ");
  if (top) parts.push(`relevance ${relevance} (${top}${firstParty.length > 2 ? ` +${firstParty.length - 2}` : ""})`);
  else if (input.contextLabel) parts.push(`relevance ${relevance} (topical: ${input.contextLabel})`);
  else parts.push(`relevance ${relevance}`);
  parts.push(`substance ${substance}`);
  if (freshness < 0.85) parts.push("aging");
  return parts.join(" · ");
}
