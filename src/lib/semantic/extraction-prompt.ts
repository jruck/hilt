/**
 * Per-item entity-extraction prompt + tolerant parser (P2.1, spec §B.2).
 *
 * Same module shape as src/lib/library/connection-prompt.ts: an exported prompt
 * string and a defensive parser that NEVER throws — a wholly-unparseable response
 * abstains to `[]`, exactly as `parseConnectionJudgment` abstains. The JSON-parse
 * helpers (stripCodeFences / extractFirstJsonObject / tryParse) are REUSED from
 * connection-prompt.ts rather than re-implemented (spec task 1.1).
 *
 * The four buckets map onto the established `ExtractedEntity` seam (gemini.ts):
 * person | project | idea | source — the prompt names the idea bucket "concept"
 * in Justin's voice, and the parser folds `concept`→`idea` so the in-memory type
 * stays the one every downstream module (db schema, resolve, reconcile) already
 * uses. Salience is emitted as {primary,secondary,mention} by the model and
 * normalized to the numeric 0..1 the schema stores.
 */

import {
  extractFirstJsonObject,
  stripCodeFences,
  tryParse,
} from "@/lib/library/connection-prompt";
import type { ExtractedEntity } from "./gemini";

export const EXTRACTION_PROMPT = `You extract the typed entities a single item is ABOUT, for one person's ("Justin") personal knowledge base. Return only entities genuinely present or centrally discussed — not every noun. Empty buckets are correct and common.

Four entity types (use EXACTLY these \`type\` values):
- "person"  — people, authors, creators, channels, hosts (a named human or named channel/byline)
- "project" — Justin's projects, areas, or concrete tasks/initiatives (things he is DOING)
- "concept" — ideas, concepts, themes, arguments, mental models (things being THOUGHT ABOUT)
- "source"  — tools, products, orgs, companies, publications, services (named external things)

RULES:
- Extract the entity's most CANONICAL surface form as \`name\` (e.g. "Anthropic", not "anthropic's"); list other surface forms seen in THIS item in \`aliases\` (handles, abbreviations, "the company").
- \`salience\` ∈ {primary, secondary, mention}: primary = the item is substantially about it; mention = named in passing. Be strict; most items have 0-2 primary entities.
- \`evidence\` = one short quoted/paraphrased span from the item that justifies the entity. If you cannot ground it in the text, DO NOT emit it.
- Do NOT invent. Do NOT split one thing into near-duplicates. Do NOT emit generic words ("technology", "ideas") as concepts — a concept must be a NAMED, specific idea.
- Prefer specific over broad ("retrieval-augmented generation" over "AI").

Return ONLY this JSON, nothing else:
{ "entities": [ {
    "type": "person" | "project" | "concept" | "source",
    "name": "<canonical surface form>",
    "aliases": ["<other surface forms in this item>"],
    "salience": "primary" | "secondary" | "mention",
    "evidence": "<one grounding span from the item>"
} ] }
If nothing qualifies: { "entities": [] }. That is a complete, correct answer.`;

/**
 * The OpenAPI-subset schema handed to Gemini as `responseSchema` so structured
 * output is provider-enforced (defense layer 1; parseExtractionOutput is layer 2).
 */
export const EXTRACTION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["person", "project", "concept", "source"] },
          name: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
          salience: { type: "string", enum: ["primary", "secondary", "mention"] },
          evidence: { type: "string" },
        },
        required: ["type", "name", "salience", "evidence"],
      },
    },
  },
  required: ["entities"],
} as const;

const TYPE_ALIASES: Record<string, ExtractedEntity["type"]> = {
  person: "person",
  project: "project",
  // The prompt names the idea bucket "concept"; the established seam calls it "idea".
  concept: "idea",
  idea: "idea",
  source: "source",
};

const SALIENCE_SCORE: Record<string, number> = {
  primary: 1,
  secondary: 0.6,
  mention: 0.3,
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Normalize a salience value (string label or raw number) to 0..1. */
function normalizeSalience(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }
  const label = asString(value).toLowerCase();
  return SALIENCE_SCORE[label] ?? SALIENCE_SCORE.mention;
}

function normalizeAliases(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>([name.toLowerCase()]);
  const out: string[] = [];
  for (const entry of value) {
    const alias = asString(entry);
    if (!alias) continue;
    const key = alias.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}

/**
 * Normalize one raw entity record, or null to DROP it. Mirrors normalizeConnections'
 * drop-on-missing-signal discipline: an unknown `type`, a blank `name`, or missing
 * `evidence` means the model didn't ground the entity — drop it rather than invent.
 */
function normalizeEntity(entry: unknown): ExtractedEntity | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const type = TYPE_ALIASES[asString(record.type).toLowerCase()];
  if (!type) return null; // unknown/missing type ⇒ drop
  const name = asString(record.name);
  if (!name) return null; // blank name ⇒ drop
  const evidence = asString(record.evidence);
  if (!evidence) return null; // ungrounded ⇒ drop
  return {
    type,
    name,
    aliases: normalizeAliases(record.aliases, name),
    salience: normalizeSalience(record.salience),
    evidence,
  };
}

/**
 * Tolerant parser for the extraction response. Handles raw JSON, fenced JSON, and
 * JSON embedded in prose; drops malformed/unknown entities; on a wholly-unparseable
 * response returns `[]` (abstain), never throws. Exact spirit of parseConnectionJudgment.
 */
export function parseExtractionOutput(raw: string): ExtractedEntity[] {
  const text = (raw || "").trim();
  if (!text) return [];

  const unfenced = stripCodeFences(text);
  const parsed =
    tryParse(unfenced) ??
    (() => {
      const embedded = extractFirstJsonObject(unfenced) || extractFirstJsonObject(text);
      return embedded ? tryParse(embedded) : null;
    })();
  if (!parsed) return []; // no JSON at all ⇒ abstain

  const entities = Array.isArray(parsed.entities) ? parsed.entities : [];
  const out: ExtractedEntity[] = [];
  for (const entry of entities) {
    const normalized = normalizeEntity(entry);
    if (normalized) out.push(normalized);
  }
  return out;
}
