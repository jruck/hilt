import type { ConnectionJudgment, ConnectionSuggestion } from "./types";

export const CONNECTION_PROMPT = `You are weaving a new reference into a personal knowledge base for one person ("Justin"), exactly as if he asked you in conversation to reweave a summary into his notes and find genuine connections.

You are given an INDEX of his active work (north stars, projects, areas, people, and the kinds of references he collects), then a NEW reference. Decide whether the reference GENUINELY connects to something specific in his work.

RULES:
- "No connection" is a correct, expected, common answer. Much of what he saves is aesthetic, personal, or one-off and ties to nothing he is actively doing. Do NOT force a connection. Never connect on shared generic words, broad topic adjacency, or vibe.
- Propose a connection ONLY when you can (a) name a SPECIFIC target — a project, area, person, active writing/essay theme, or a prior reference topic from the index — AND (b) state the relationship in ONE honest, directional sentence. If you cannot write that sentence, there is no connection.
- These directional relationship types ALL count as genuine connections: extends / builds on; supports / is evidence for; contradicts / challenges / complicates; IS the canonical, baseline, or foundational source the target reacts to, critiques, or builds from; is a peer / alternative / competitor of; provides a counterexample or concrete data point; is source material for an active writing theme. A reference that merely RESTATES the baseline a note argues against STILL CONNECTS (as that baseline).
- Distinguish CONNECTING from REWEAVING. Connecting = a directional relationship exists (the bar above). Reweaving = the new content would MATERIALLY UPDATE the neighbor note (add a fact/argument/data point that changes it). Many references connect WITHOUT reweaving. List reweave candidates separately and sparingly; never invent them.
- Prefer FEW, high-signal connections (0-5). Never pad to a quota. Reasons must be relationship claims, not topic labels ("extends X with a delivery-rate counterexample", not "related to AI").
- Use his vocabulary and a practitioner voice — he builds these systems, he does not theorize about them.

Return ONLY this JSON, nothing else:
{
  "connects": true | false,
  "reasoning": "<one specific line: why it connects, or why it does not>",
  "connections": [
    { "target": "<slug/path from the index, or null for a theme-level tie>", "label": "<human label>", "relationship": "<one specific, directional sentence>" }
  ],
  "reweave_candidates": [ { "target": "<existing note>", "why": "<what the new content would update in it>" } ]
}
If it does not connect: connects=false, empty connections, one-line reasoning. That is a complete, correct answer.`;

const ABSTAIN: ConnectionJudgment = {
  connects: false,
  reasoning: "",
  connections: [],
  reweave_candidates: [],
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNullableTarget(value: unknown): string | null {
  const text = asString(value);
  return text ? text : null;
}

function normalizeConnections(value: unknown): ConnectionSuggestion[] {
  if (!Array.isArray(value)) return [];
  const connections: ConnectionSuggestion[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const relationship = asString(record.relationship);
    // A connection without an honest, directional relationship sentence is not a connection.
    if (!relationship) continue;
    const label = asString(record.label) || asString(record.target) || relationship;
    connections.push({
      target: asNullableTarget(record.target),
      label,
      relationship,
    });
  }
  return connections;
}

function normalizeReweaveCandidates(value: unknown): ConnectionJudgment["reweave_candidates"] {
  if (!Array.isArray(value)) return [];
  const candidates: NonNullable<ConnectionJudgment["reweave_candidates"]> = [];
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

function normalizeJudgment(parsed: Record<string, unknown>): ConnectionJudgment {
  const connections = normalizeConnections(parsed.connections);
  const reweaveCandidates = normalizeReweaveCandidates(parsed.reweave_candidates);
  // Trust an explicit connects:false; otherwise derive from whether any connection survived validation.
  const connects = parsed.connects === false
    ? false
    : parsed.connects === true
      ? connections.length > 0
      : connections.length > 0;
  return {
    connects,
    reasoning: asString(parsed.reasoning),
    connections: connects ? connections : [],
    reweave_candidates: reweaveCandidates,
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
 * Tolerant parser for the connection judgment. Handles raw JSON, JSON inside ```json fences,
 * JSON embedded in surrounding prose, and a plain-prose "this doesn't connect" answer.
 * On anything unparseable, abstains (connects:false, empty arrays).
 */
export function parseConnectionJudgment(raw: string): ConnectionJudgment {
  const text = (raw || "").trim();
  if (!text) return { ...ABSTAIN };

  const unfenced = stripCodeFences(text);
  const direct = tryParse(unfenced);
  if (direct) return normalizeJudgment(direct);

  const embedded = extractFirstJsonObject(unfenced) || extractFirstJsonObject(text);
  if (embedded) {
    const parsed = tryParse(embedded);
    if (parsed) return normalizeJudgment(parsed);
  }

  // Plain-prose answer with no JSON. A bare "doesn't connect" is a complete, correct abstain.
  return { ...ABSTAIN, reasoning: text.replace(/\s+/g, " ").slice(0, 280) };
}
