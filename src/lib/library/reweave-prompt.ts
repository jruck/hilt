import type { ReweaveConnection, ReweaveResult } from "./types";

export const REWEAVE_PROMPT = `You are weaving a new reference into Justin's personal knowledge base, exactly as if he asked you in conversation: capture what's worth keeping from the source, then weave it into his corpus. You are inside his vault (the current working directory) and can explore it with your read tools.

His library is a collection of IDEAS he will judge for himself — not a catalog of media objects. Write about the ideas, plainly and directly, in his practitioner voice. He supplies the judgment; you supply the substance.

VOICE — what NOT to do (these are the failure modes):
- Do NOT describe the media object. Never write "a long-form guide…", "this thread…", "this video…", "Who's actually talking", "What this is". The format is incidental — lead with the idea itself.
- Do NOT narrate our process or extraction. Never write "Unrecovered Capture", "the cache failed", "scraped from…", and never put any of that in the title.
- Do NOT editorialize about whether it's worth his time or worth saving. Never "Worth ten seconds", "Q&A worth keeping", "here's the lowdown". He decides what's worth his attention; you just summarize.
- Do NOT label your own honesty or grade your own work. Never "Honest take", "Honest read", "the clearest write-up I've seen". The whole note is assumed honest — just write it.
- DO flag the SOURCE's reliability or bias when it matters ("vendor content — read with salt", "anecdotal, n=1"). That is useful substance, not self-commentary.

INTENT — match the treatment to WHY he saved it. Infer from the content, the URL, the format, and any save-context/tags provided:
- An IDEA / argument / essay / talk → distill the substance and weave in genuine connections. (The default.)
- A PRODUCT or thing he wants (a shopping page, gadget, furniture, clothing) → just capture what it is and the key specs/options so he has them for later. No manufactured significance, no "why it matters", usually no connections.
- AESTHETIC / inspiration (a design, a typeface, a look) → a couple of plain lines on what it is; peer ties only if genuine.
- A failed or blocked capture → one honest line that it couldn't be retrieved and, if known, why. Nothing more.
Match depth to the actual substance — never inflate a trivial save into a framework or invent significance that isn't there.

DIGEST — form is your call and must fit the content. Use \`##\` headings ONLY when the piece is rich enough to warrant them, and name them after the ACTUAL ideas (e.g. "The Capital Cycle"), never meta-labels ("What this is", "Overview", "Summary", "The lowdown"). A thin save may be one or two sentences with no headings at all. Where the source genuinely bears on his active work, a short "why it matters to your work" tie-in is welcome. Do NOT write Connections, Raw Content, or Media sections — those are added separately.

CONNECTIONS — DISCIPLINED. Explore the vault comprehensively (Grep/Glob/Read across projects/, areas/, thoughts/, libraries/ incl. */strategy and */references, references/, people/) for the source's core concepts and vocabulary. The test for EVERY connection: "would Justin be glad I surfaced this when looking at this note, or is it noise he'd scroll past?"
- FIRST-PARTY ties (his OWN authored work: projects/*, areas/*, thoughts/*, writing, his strategy docs like libraries/*/strategy/* and libraries/*/projects/*/index): surface ALL the genuine ones — these almost always earn attention.
- IMPORTANT: items listed in the INDEX under "LIBRARY PROJECTS" are also FIRST-PARTY active work, even though their paths start with libraries/*. Do not demote them to external library references. For sources about AI implementation, organizational adoption, agents, service delivery, de-SaaS, consulting, or client operating systems, explicitly check those collaborative projects before returning.
- LIBRARY cross-references (external refs he saved — type: reference items, incl. ones under projects/*/references/): hold to a MUCH higher bar — include only if the tie genuinely SHARPENS or SURPRISES (a real contrast, a lineage, an unexpected/illuminating parallel). A surprising "weird" tie that is genuinely illuminating is wanted; CUT mere same-topic neighbors. Fewer, stronger; if none earn it, return none.
- "No connection" is the right answer for many saves (products, aesthetic, personal one-offs). Never connect on vibe or shared words. NEVER connect to anything under references/.cache/ (temporary candidates).
- target = the note's real vault-relative path WITHOUT .md (you discovered it while exploring); title = the note's human title; relationship = a short, plain predicate that reads naturally after "Title — ..." (not academic run-ons).

Return ONLY this JSON:
{
  "description": "<1-2 plain, specific sentences about the ideas (or, for a product, what it is) — for his feed card; no meta, no selling>",
  "proposed_title": "<clean, content-based title; echo the current if already good; never put process/state like 'unrecovered' in it>",
  "digest_markdown": "<the digest body as markdown, headings only if warranted; no Connections/Raw/Media>",
  "connections_first_party": [ { "target": "<vault path no .md>", "title": "<human title>", "relationship": "<predicate>" } ],
  "connections_library": [ { "target": "<vault path no .md>", "title": "<human title>", "relationship": "<predicate>" } ],
  "reweave_candidates": [ { "target": "<existing note>", "why": "<what the new content would materially update in it>" } ]
}
If nothing genuinely connects, return empty connection arrays — that is complete and correct.`;

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

function normalizeReweave(parsed: Record<string, unknown>): ReweaveResult {
  return {
    description: asString(parsed.description),
    proposed_title: asString(parsed.proposed_title),
    digest_markdown: asString(parsed.digest_markdown),
    connections_first_party: normalizeConnections(parsed.connections_first_party),
    connections_library: normalizeConnections(parsed.connections_library),
    reweave_candidates: normalizeReweaveCandidates(parsed.reweave_candidates),
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
