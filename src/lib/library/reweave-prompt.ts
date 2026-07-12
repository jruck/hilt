import type { ReweaveConnection, ReweaveResult } from "./types";
import { CAPTURE_VOICE } from "./capture-voice";

export const REWEAVE_PROMPT = `You are weaving a new reference into Justin's personal knowledge base, exactly as if he asked you in conversation: capture what's worth keeping from the source, then weave it into his corpus. You are inside his vault (the current working directory) and can explore it with your read tools.

${CAPTURE_VOICE}

DIGEST — write the capture body following the voice above. Do NOT write Connections, Raw Content, or Media sections — those are added separately. Where the source genuinely bears on his active work, a short "why it matters to your work" tie-in is welcome.

CARD DESCRIPTION — this is the stable, source-facing explanation shown in ordinary Library feeds. Say only what the source is, argues, demonstrates, or contains. Keep it evergreen: never mention Justin, his work, current timing, why he should read it, or whether it deserves attention. Recommendation context is written later by a separate editorial pass.

CONNECTIONS — DISCIPLINED. Explore the vault comprehensively (Grep/Glob/Read across projects/, areas/, thoughts/, libraries/ incl. */strategy and */references, references/, people/) for the source's core concepts and vocabulary. The test for EVERY connection: "would Justin be glad I surfaced this when looking at this note, or is it noise he'd scroll past?"
- FIRST-PARTY ties (his OWN authored work: projects/*, areas/*, thoughts/*, writing, his strategy docs like libraries/*/strategy/* and libraries/*/projects/*/index): surface ALL the genuine ones — these almost always earn attention.
- IMPORTANT: items listed in the INDEX under "LIBRARY PROJECTS" are also FIRST-PARTY active work, even though their paths start with libraries/*. Do not demote them to external library references. For sources about AI implementation, organizational adoption, agents, service delivery, de-SaaS, consulting, or client operating systems, explicitly check those collaborative projects before returning.
- LIBRARY cross-references (external refs he saved — type: reference items, incl. ones under projects/*/references/): hold to a MUCH higher bar — include only if the tie genuinely SHARPENS or SURPRISES (a real contrast, a lineage, an unexpected/illuminating parallel). A surprising "weird" tie that is genuinely illuminating is wanted; CUT mere same-topic neighbors. **Default to NONE or one; two is already a lot.** First-party ties always lead and outweigh these — never let library cross-refs crowd them out or pad the list.
- DEDUPE against the digest: the Connections list is for ties the digest body did NOT already draw. If you already made the point in the body (e.g. a "why it matters to your work" line that names a project), do not repeat it as a connection.
- "No connection" is the right answer for many saves (products, aesthetic, personal one-offs). Never connect on vibe or shared words. NEVER connect to anything under references/.cache/ (temporary candidates).
- target = the note's real vault-relative path WITHOUT .md (you discovered it while exploring); title = the note's human title; relationship = a short, plain predicate that reads naturally after "Title — ..." (not academic run-ons).

ATTENTION JUDGMENT — you just read this source AND explored Justin's vault, so judge directly: how much
does this deserve his limited attention right now? "high" = he should genuinely read/act on this soon
(it materially bears on active work or sharpens how he builds/thinks); "medium" = worth having woven in,
no urgency; "low" = fine to keep but he need never look at it again. Judge the SOURCE's value to HIS
practice — not how well the digest came out. Be willing to say "low"; most saves are.

Return ONLY this JSON:
{
  "description": "<1-2 evergreen, source-centric sentences about what it argues or contains (or, for a product, what it is); no personal relevance, timing, recommendation language, meta, or selling>",
  "proposed_title": "<clean, content-based title; echo the current if already good; never put process/state like 'unrecovered' in it>",
  "digest_markdown": "<the digest body as markdown, headings only if warranted; no Connections/Raw/Media>",
  "connections_first_party": [ { "target": "<vault path no .md>", "title": "<human title>", "relationship": "<predicate>" } ],
  "connections_library": [ { "target": "<vault path no .md>", "title": "<human title>", "relationship": "<predicate>" } ],
  "reweave_candidates": [ { "target": "<existing note>", "why": "<what the new content would materially update in it>" } ],
  "attention_judgment": { "tier": "<high|medium|low>", "reason": "<one plain line: why this tier, for Justin specifically>" }
}
If nothing genuinely connects, return empty connection arrays — that is complete and correct.`;

const CONNECTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    target: { type: "string" },
    title: { type: "string" },
    relationship: { type: "string" },
  },
  required: ["target", "title", "relationship"],
} as const;

/**
 * Claude's native structured-output contract for the reweave pass. Prompt-only JSON occasionally
 * contained an unescaped quote inside digest prose, which made an otherwise complete connection
 * pass unparseable and silently deferred it. Keeping the schema beside the prompt makes the wire
 * contract explicit and prevents prose punctuation from invalidating the result.
 */
export const REWEAVE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    description: { type: "string" },
    proposed_title: { type: "string" },
    digest_markdown: { type: "string" },
    connections_first_party: { type: "array", items: CONNECTION_SCHEMA },
    connections_library: { type: "array", items: CONNECTION_SCHEMA },
    reweave_candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          target: { type: "string" },
          why: { type: "string" },
        },
        required: ["target", "why"],
      },
    },
    attention_judgment: {
      type: "object",
      additionalProperties: false,
      properties: {
        tier: { type: "string", enum: ["high", "medium", "low"] },
        reason: { type: "string" },
      },
      required: ["tier", "reason"],
    },
  },
  required: [
    "description",
    "proposed_title",
    "digest_markdown",
    "connections_first_party",
    "connections_library",
    "reweave_candidates",
    "attention_judgment",
  ],
} as const;

const EMPTY_RESULT: ReweaveResult = {
  description: "",
  proposed_title: "",
  digest_markdown: "",
  connections_first_party: [],
  connections_library: [],
  reweave_candidates: [],
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Normalize a connection target: strip a trailing ".md", reject empty targets and any path
 * that points into the temporary candidate cache (references/.cache/). Returns null when the
 * target should be dropped.
 */
function normalizeTarget(value: unknown): string | null {
  let target = asString(value);
  if (!target) return null;
  if (target.endsWith(".md")) target = target.slice(0, -".md".length);
  if (!target) return null;
  if (target.includes("/.cache/")) return null;
  return target;
}

function normalizeConnections(value: unknown): ReweaveConnection[] {
  if (!Array.isArray(value)) return [];
  const connections: ReweaveConnection[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const target = normalizeTarget(record.target);
    // A connection without a target (or pointing into the candidate cache) is dropped.
    if (!target) continue;
    const relationship = asString(record.relationship);
    // A connection without an honest predicate is not a connection.
    if (!relationship) continue;
    const title = asString(record.title) || target;
    connections.push({ target, title, relationship });
  }
  return connections;
}

function normalizeReweaveCandidates(value: unknown): ReweaveResult["reweave_candidates"] {
  if (!Array.isArray(value)) return [];
  const candidates: NonNullable<ReweaveResult["reweave_candidates"]> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const target = asString(record.target);
    const why = asString(record.why);
    if (!target || !why) continue;
    candidates.push({ target, why });
  }
  return candidates;
}

function normalizeAttentionJudgment(value: unknown): ReweaveResult["attention_judgment"] {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const tier = record.tier === "high" || record.tier === "medium" || record.tier === "low" ? record.tier : null;
  if (!tier) return undefined;
  return { tier, reason: asString(record.reason) };
}

function normalizeReweave(parsed: Record<string, unknown>): ReweaveResult {
  return {
    description: asString(parsed.description),
    proposed_title: asString(parsed.proposed_title),
    digest_markdown: asString(parsed.digest_markdown),
    connections_first_party: normalizeConnections(parsed.connections_first_party),
    connections_library: normalizeConnections(parsed.connections_library),
    reweave_candidates: normalizeReweaveCandidates(parsed.reweave_candidates),
    attention_judgment: normalizeAttentionJudgment(parsed.attention_judgment),
  };
}

function stripCodeFences(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : raw.trim();
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function tryParse(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Tolerant parser for the reweave output. Handles raw JSON, JSON inside ```json fences, and
 * JSON embedded in surrounding prose, mirroring parseConnectionJudgment's brace-balanced
 * extraction. Normalizes connection targets (drops empties and references/.cache/ paths, strips
 * trailing .md, requires a non-empty relationship) and coerces missing fields to safe defaults.
 * On anything unparseable, returns the empty result.
 */
export function parseReweaveOutput(raw: string): ReweaveResult {
  const text = (raw || "").trim();
  if (!text) return { ...EMPTY_RESULT };

  const unfenced = stripCodeFences(text);
  const direct = tryParse(unfenced);
  if (direct) return normalizeReweave(direct);

  const embedded = extractFirstJsonObject(unfenced) || extractFirstJsonObject(text);
  if (embedded) {
    const parsed = tryParse(embedded);
    if (parsed) return normalizeReweave(parsed);
  }

  return { ...EMPTY_RESULT };
}
