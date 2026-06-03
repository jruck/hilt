/**
 * Entity merge-judge prompt + tolerant parser (P2.1, spec §B.4 Stage 2).
 *
 * The judge is the only quality lever in resolution: given a CLUSTER of same-type
 * candidate mentions, it returns which of them are the SAME real-world entity. It is
 * a separate injectable seam (`MergeJudge`) rather than a method on SemanticLlmClient
 * — tests pass a deterministic fake, exactly the R6 "inject the function like the LLM
 * client" pattern. The real impl shells the same fail-soft Gemini Flash structured
 * call as extraction; an unparseable verdict ⇒ every member is its own entity (no
 * spurious merges), mirroring the connections judge abstaining.
 */

import {
  extractFirstJsonObject,
  stripCodeFences,
  tryParse,
} from "@/lib/library/connection-prompt";
import { getGeminiApiKey } from "./gemini";
import { isSemanticDisabled } from "./config";
import { semanticExtractModel } from "./pipeline";

export const MERGE_PROMPT = `You decide whether candidate entity mentions refer to the SAME real-world entity, for one person's knowledge base. Same type only. Two things that are merely RELATED or commonly co-occur are NOT the same entity (do not merge "OpenAI" and "GPT-4"; do not merge a person with their company). Merge only true referential identity: spelling/handle/abbreviation variants, full-name vs short-name, "the company" vs its name.

Given a CLUSTER of mentions (each with type, name, sample evidence), return ONLY:
{ "groups": [ { "canonical_name": "<best canonical form>",
                "members": ["<name as given>", ...],
                "reason": "<one line: why these are one entity>" } ] }
Every input member must appear in exactly one group; a singleton group is correct and common.`;

export const MERGE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          canonical_name: { type: "string" },
          members: { type: "array", items: { type: "string" } },
          reason: { type: "string" },
        },
        required: ["canonical_name", "members"],
      },
    },
  },
  required: ["groups"],
} as const;

/** One candidate fed to the judge — `name` is the key members refer back to. */
export interface MergeCandidate {
  name: string;
  evidence: string;
}

export interface MergeGroup {
  canonicalName: string;
  members: string[];
  reason: string;
}

/**
 * The injectable judge seam. `type` lets the real impl note same-type-only in the
 * cluster framing; candidates are the same-type mentions blocking proposed. Fail-soft:
 * an empty/abstaining return is interpreted by resolve.ts as "no merge".
 */
export type MergeJudge = (type: string, candidates: MergeCandidate[]) => Promise<MergeGroup[]>;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Tolerant parser for the merge verdict. Returns the well-formed groups; an
 * unparseable/empty body returns `[]` (the caller treats that as no-merge: every
 * member stays its own entity). Never throws.
 */
export function parseMergeJudgment(raw: string): MergeGroup[] {
  const text = (raw || "").trim();
  if (!text) return [];
  const unfenced = stripCodeFences(text);
  const parsed =
    tryParse(unfenced) ??
    (() => {
      const embedded = extractFirstJsonObject(unfenced) || extractFirstJsonObject(text);
      return embedded ? tryParse(embedded) : null;
    })();
  if (!parsed) return [];
  const groups = Array.isArray(parsed.groups) ? parsed.groups : [];
  const out: MergeGroup[] = [];
  for (const entry of groups) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const canonicalName = asString(record.canonical_name);
    const members = Array.isArray(record.members) ? record.members.map(asString).filter(Boolean) : [];
    if (!canonicalName || members.length === 0) continue;
    out.push({ canonicalName, members, reason: asString(record.reason) });
  }
  return out;
}

interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Real Gemini Flash merge-judge. Fail-soft like extraction: SEMANTIC_DISABLED, a
 * missing key, an HTTP error, or an unparseable body all yield `[]` (no merge).
 */
export function createGeminiMergeJudge(opts: { apiKey?: string; model?: string; fetchImpl?: typeof fetch } = {}): MergeJudge {
  const model = opts.model || semanticExtractModel();
  const doFetch = opts.fetchImpl ?? fetch;
  return async (type, candidates) => {
    if (isSemanticDisabled() || candidates.length === 0) return [];
    // Belt-and-suspenders: never fire a live merge call under test (mirrors the embed
    // guard in gemini.ts). Tests inject a fake judge; this only catches a regression
    // that wired the real judge into a unit test.
    if (process.env.NODE_ENV === "test" || process.env.SEMANTIC_FORCE_OFFLINE === "1") return [];
    const key = opts.apiKey ?? getGeminiApiKey();
    if (!key) return [];
    const cluster = candidates.map((c) => ({ type, name: c.name, evidence: c.evidence }));
    const userText = `CLUSTER (all type="${type}"):\n${JSON.stringify(cluster, null, 2)}`;
    const body = {
      systemInstruction: { parts: [{ text: MERGE_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: MERGE_RESPONSE_SCHEMA },
    };
    let res: Response;
    try {
      res = await doFetch(`${GEMINI_BASE}/models/${model}:generateContent?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      return [];
    }
    if (!res.ok) return [];
    let json: GenerateContentResponse;
    try {
      json = (await res.json()) as GenerateContentResponse;
    } catch {
      return [];
    }
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return parseMergeJudgment(text);
  };
}
