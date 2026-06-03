/**
 * Topic labeling + merge-reduction prompt + tolerant parsers (P2.2, spec §C.2).
 *
 * Same module shape as src/lib/library/connection-prompt.ts and resolve-prompt.ts: an
 * exported prompt string and defensive parsers that NEVER throw. A cluster the model
 * declines to label is dropped (the orchestrator falls back to a synthetic label); an
 * unjustified merge is dropped exactly as `normalizeConnections` discards a tie with no
 * relationship sentence. The JSON-parse helpers are REUSED from connection-prompt.ts.
 *
 * Two passes, two parsers (the spec's "label, then a second batched reduce"):
 *  - parseTopicLabels  — per-cluster { label, summary, aliases } naming.
 *  - parseTopicMerges  — sibling-set { merge[], into_label, why } reduction; a merge with
 *    no `why` justification or fewer than two members is dropped.
 */

import {
  extractFirstJsonObject,
  stripCodeFences,
  tryParse,
} from "@/lib/library/connection-prompt";
import type { TopicLabel } from "./gemini";

export const TOPIC_LABEL_PROMPT = `You are naming the EMERGENT themes in one person's ("Justin") personal knowledge base, exactly as if he asked you to look across his notes and tell him what he's actually been working on and thinking about. Each input CLUSTER is a set of items (notes, references, meetings) that grouped together by meaning — you are given representative excerpts.

For each cluster, write:
- "label": a SHORT, specific theme name in Justin's practitioner voice (2-5 words, e.g. "Agent tool-use design", not "AI" or "Technology"). Name the SPECIFIC thread, not a broad category.
- "summary": 1-3 honest sentences describing what this theme is actually about — the through-line that connects the items, in his vocabulary. He builds these systems; do not theorize.
- "aliases": optional other phrasings someone might call this theme (for search). Empty is fine.

RULES:
- Name what the cluster genuinely IS from its excerpts — do not invent a grander theme than the evidence supports.
- A specific, narrow label beats a vague umbrella. Two clusters about different things must get different labels.
- If a cluster is genuinely incoherent (no through-line), still give it your best honest label from the excerpts; never refuse.

Return ONLY this JSON, nothing else (one entry per input cluster, echoing its cluster_id):
{ "topics": [ { "cluster_id": "<id as given>", "label": "<short specific name>", "summary": "<1-3 sentences>", "aliases": ["..."] } ] }`;

export const TOPIC_MERGE_PROMPT = `You decide which of these sibling THEMES from one person's knowledge base are actually the SAME theme and should be merged. You are given each theme's label + summary. Two themes that are merely RELATED or adjacent are NOT the same theme — do not merge on shared vocabulary or topic adjacency. Merge only when two labels genuinely name ONE thing at this level of granularity.

Return ONLY this JSON, nothing else:
{ "merges": [ { "merge": ["<cluster_id>", "<cluster_id>", ...], "into_label": "<the surviving theme name>", "why": "<one honest sentence: why these are one theme>" } ] }
A merge with fewer than two members, or without a genuine one-sentence justification, is invalid — omit it. If nothing should merge, return { "merges": [] }. That is a complete, correct answer.`;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asString).filter(Boolean) : [];
}

/** Reuse the connection-prompt parse pipeline: unfence → direct parse → embedded-object fallback. */
function parseObject(raw: string): Record<string, unknown> | null {
  const text = (raw || "").trim();
  if (!text) return null;
  const unfenced = stripCodeFences(text);
  const direct = tryParse(unfenced);
  if (direct) return direct;
  const embedded = extractFirstJsonObject(unfenced) || extractFirstJsonObject(text);
  return embedded ? tryParse(embedded) : null;
}

/**
 * Parse the per-cluster labeling response. Returns one TopicLabel per WELL-FORMED entry
 * (a `cluster_id` + non-empty `label`); a malformed entry or a wholly-unparseable body
 * yields `[]` (the orchestrator then synthesizes a fallback label). Never throws.
 */
export function parseTopicLabels(raw: string): TopicLabel[] {
  const parsed = parseObject(raw);
  if (!parsed) return [];
  const topics = Array.isArray(parsed.topics) ? parsed.topics : [];
  const out: TopicLabel[] = [];
  for (const entry of topics) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const clusterId = asString(record.cluster_id);
    const label = asString(record.label);
    if (!clusterId || !label) continue;
    out.push({ clusterId, label, summary: asString(record.summary) });
  }
  return out;
}

export interface TopicMerge {
  /** Cluster ids to merge (≥2). The first is treated as the survivor when none is named. */
  merge: string[];
  intoLabel: string;
  why: string;
}

/**
 * Parse the sibling-reduction response. Drops any merge group with <2 members or no `why`
 * (mirrors normalizeConnections dropping relationship-less ties). Unparseable ⇒ `[]` (no
 * merges). Never throws.
 */
export function parseTopicMerges(raw: string): TopicMerge[] {
  const parsed = parseObject(raw);
  if (!parsed) return [];
  const merges = Array.isArray(parsed.merges) ? parsed.merges : [];
  const out: TopicMerge[] = [];
  for (const entry of merges) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const members = asStringArray(record.merge);
    const why = asString(record.why);
    // An unjustified merge, or one that names fewer than two themes, is not a merge.
    if (members.length < 2 || !why) continue;
    out.push({ merge: members, intoLabel: asString(record.into_label) || members[0], why });
  }
  return out;
}
