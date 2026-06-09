/**
 * Gemini client + the injectable SemanticLlmClient seam (ruling R7).
 *
 * ONE interface — embed / extractEntities / labelTopics — with one real fetch-based
 * implementation here and a deterministic fake in test-helpers.ts. Every pipeline
 * stage takes a `SemanticLlmClient`, so tests inject the fake and never touch the
 * network (no-live-calls.test.ts enforces it).
 *
 * Key resolution (same source the library's `summarize` path uses, so this "just
 * works" with the key already on the machine — see ~/.summarize/config.json):
 *   1. process.env GEMINI_API_KEY → GOOGLE_GENERATIVE_AI_API_KEY → GOOGLE_API_KEY
 *   2. fallback: `~/.summarize/config.json` `env` block (the summarize CLI stores the
 *      Gemini key there and injects it into the process env at run time).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { extractModelText, resolveClaudeBin, runClaude } from "@/lib/library/connections";
import { isSemanticDisabled, isSemanticLabelDisabled, semanticDim, semanticRefitTimeoutMs } from "./config";
import { EXTRACTION_PROMPT, EXTRACTION_RESPONSE_SCHEMA, parseExtractionOutput } from "./extraction-prompt";
import { SEMANTIC_EMBEDDING_MODEL, semanticExtractModel, semanticTaxonomyModel } from "./pipeline";
import { TOPIC_LABEL_PROMPT, parseTopicLabels } from "./topic-label-prompt";
import { l2normalize } from "./vector";

export interface ExtractedEntity {
  type: "person" | "project" | "idea" | "source";
  name: string;
  aliases: string[];
  salience: number; // 0..1
  evidence?: string;
}

export interface TopicLabelInput {
  clusterId: string;
  sampleTexts: string[];
}

export interface TopicLabel {
  clusterId: string;
  label: string;
  summary: string;
}

/** The single seam every pipeline stage depends on (real impl here; fake in tests). */
export interface SemanticLlmClient {
  /** Embed texts → unit-normalized vectors (length = semanticDim()), index-aligned. */
  embed(texts: string[]): Promise<Float32Array[]>;
  /** Extract typed entities from one item's text (P2.1). */
  extractEntities(text: string): Promise<ExtractedEntity[]>;
  /** Name + summarize topic clusters (P2.2). */
  labelTopics(inputs: TopicLabelInput[]): Promise<TopicLabel[]>;
}

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const EMBED_BATCH = 100; // batchEmbedContents per-request ceiling

export function getGeminiApiKey(): string | null {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    keyFromSummarizeConfig()
  );
}

let cachedSummarizeKey: string | null | undefined;

/** Path to the summarize CLI config that holds the shared Gemini key (override for tests). */
function summarizeConfigPath(): string {
  return process.env.SUMMARIZE_CONFIG_PATH || path.join(os.homedir(), ".summarize", "config.json");
}

/**
 * Read the Gemini key from `~/.summarize/config.json` `env` block — the same store the
 * library's summarize path uses. Cached; absent/unreadable/malformed config → null
 * (never throws). Set SEMANTIC_NO_SUMMARIZE_KEY=1 to opt out of this fallback.
 */
function keyFromSummarizeConfig(): string | null {
  if (process.env.SEMANTIC_NO_SUMMARIZE_KEY === "1") return null;
  if (cachedSummarizeKey !== undefined) return cachedSummarizeKey;
  cachedSummarizeKey = null;
  try {
    const cfg = JSON.parse(fs.readFileSync(summarizeConfigPath(), "utf8")) as { env?: Record<string, string> };
    const env = cfg.env ?? {};
    cachedSummarizeKey = env.GEMINI_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY || env.GOOGLE_API_KEY || null;
  } catch {
    /* no config / unreadable → no key from this source */
  }
  return cachedSummarizeKey;
}

/** True under `node --test` / NODE_ENV=test — used to hard-block accidental live calls. */
function isTestEnv(): boolean {
  return process.env.NODE_ENV === "test" || process.env.SEMANTIC_FORCE_OFFLINE === "1";
}

interface GeminiClientOptions {
  apiKey?: string;
  model?: string;
  extractModel?: string;
  taxonomyModel?: string;
  dim?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Real Gemini-backed client. embed() is implemented; extract/label are wired in
 * P2.1/P2.2. Refuses to make live calls under test (use createFakeSemanticClient).
 */
export function createGeminiClient(opts: GeminiClientOptions = {}): SemanticLlmClient {
  const model = opts.model || SEMANTIC_EMBEDDING_MODEL;
  const dim = opts.dim ?? semanticDim();
  const doFetch = opts.fetchImpl ?? fetch;

  function requireKey(): string {
    if (isTestEnv()) {
      throw new Error("Gemini live calls are blocked under test — inject createFakeSemanticClient().");
    }
    const key = opts.apiKey ?? getGeminiApiKey();
    if (!key) {
      throw new Error(
        "No Gemini API key. Set GEMINI_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY / GOOGLE_API_KEY), or store it in ~/.summarize/config.json (env block).",
      );
    }
    return key;
  }

  async function embedBatch(key: string, texts: string[]): Promise<Float32Array[]> {
    const body = {
      requests: texts.map((t) => ({
        model: `models/${model}`,
        content: { parts: [{ text: t }] },
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: dim,
      })),
    };
    const res = await withRetry(() =>
      doFetch(`${GEMINI_BASE}/models/${model}:batchEmbedContents?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    if (!res.ok) throw new Error(`Gemini embed failed: ${res.status} ${await safeText(res)}`);
    const json = (await res.json()) as { embeddings?: Array<{ values: number[] }> };
    const out = json.embeddings ?? [];
    if (out.length !== texts.length) {
      throw new Error(`Gemini embed returned ${out.length} vectors for ${texts.length} inputs`);
    }
    return out.map((e) => l2normalize(Float32Array.from(e.values)));
  }

  const extractModel = opts.extractModel || semanticExtractModel();

  /**
   * One Gemini Flash structured-output call for one item's text. Fail-soft like the
   * Library's judges: SEMANTIC_DISABLED, a missing key at runtime, an HTTP error, a
   * timeout, or an unparseable body all yield `[]` (abstain) rather than throwing —
   * one poison item must never stall a thousands-item backfill. The only hard throw
   * is the under-test live-call guard in requireKey(), which fires before any fetch.
   */
  async function extractOnce(text: string): Promise<ExtractedEntity[]> {
    if (isSemanticDisabled()) return [];
    if (!text.trim()) return [];
    const key = requireKey();
    const body = {
      systemInstruction: { parts: [{ text: EXTRACTION_PROMPT }] },
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: EXTRACTION_RESPONSE_SCHEMA,
      },
    };
    let res: Response;
    try {
      res = await withRetry(() =>
        doFetch(`${GEMINI_BASE}/models/${extractModel}:generateContent?key=${key}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    } catch {
      return []; // network error ⇒ abstain
    }
    if (!res.ok) return []; // 4xx/5xx ⇒ abstain (skip this item, do not stall the batch)
    let json: GenerateContentResponse;
    try {
      json = (await res.json()) as GenerateContentResponse;
    } catch {
      return [];
    }
    const raw = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return parseExtractionOutput(raw);
  }

  const taxonomyModel = opts.taxonomyModel || semanticTaxonomyModel();

  /**
   * One labeling call over ALL clusters (the low-frequency global pass). Dispatches by
   * SEMANTIC_TAXONOMY_MODEL (ruling R7): a `claude:` prefix shells the Claude CLI via the
   * library's runner; anything else POSTs Gemini. Fail-soft like extraction — SEMANTIC_-
   * LABEL_DISABLED, a missing key, an HTTP/CLI error, or an unparseable body all yield `[]`
   * (the orchestrator then synthesizes fallback labels), never a throw. Hard-blocks live
   * calls under test (tests inject the fake labeler via createFakeSemanticClient).
   */
  async function labelTopicsOnce(inputs: TopicLabelInput[]): Promise<TopicLabel[]> {
    if (inputs.length === 0) return [];
    if (isSemanticDisabled() || isSemanticLabelDisabled()) return [];
    if (isTestEnv()) return []; // belt-and-suspenders: never fire a live label call under test
    const userText = buildLabelUserText(inputs);

    if (taxonomyModel.startsWith("claude:")) {
      const model = taxonomyModel.slice("claude:".length).trim();
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "hilt-semantic-topics-"));
      const promptPath = path.join(dir, "prompt.txt");
      try {
        await fs.promises.writeFile(promptPath, TOPIC_LABEL_PROMPT, "utf-8");
        const args = [
          "-p",
          userText,
          "--append-system-prompt-file",
          promptPath,
          "--output-format",
          "json",
        ];
        if (model) args.push("--model", model);
        const stdout = await runClaude(resolveClaudeBin(), args, semanticRefitTimeoutMs());
        return parseTopicLabels(extractModelText(stdout));
      } catch {
        return [];
      } finally {
        await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    }

    const key = opts.apiKey ?? getGeminiApiKey();
    if (!key) return [];
    const body = {
      systemInstruction: { parts: [{ text: TOPIC_LABEL_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: { responseMimeType: "application/json" },
    };
    let res: Response;
    try {
      res = await withRetry(() =>
        doFetch(`${GEMINI_BASE}/models/${taxonomyModel}:generateContent?key=${key}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
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
    const raw = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return parseTopicLabels(raw);
  }

  return {
    async embed(texts) {
      if (texts.length === 0) return [];
      const key = requireKey();
      const result: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += EMBED_BATCH) {
        result.push(...(await embedBatch(key, texts.slice(i, i + EMBED_BATCH))));
      }
      return result;
    },
    extractEntities: extractOnce,
    labelTopics: labelTopicsOnce,
  };
}

/** Render the per-cluster excerpts into the user message handed to the labeler. */
function buildLabelUserText(inputs: TopicLabelInput[]): string {
  const blocks = inputs.map((c) => {
    const samples = c.sampleTexts
      .filter(Boolean)
      .slice(0, 8)
      .map((t) => `  - ${t.replace(/\s+/g, " ").slice(0, 280)}`)
      .join("\n");
    return `CLUSTER ${c.clusterId}:\n${samples || "  (no excerpts)"}`;
  });
  return `Name each of these ${inputs.length} clusters. Echo each cluster_id exactly.\n\n${blocks.join("\n\n")}`;
}

interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

/**
 * Retry 429/5xx with exponential backoff, honoring a `Retry-After` header when present.
 * Rides out per-minute rate throttling (RPM) instead of crashing the run on the first
 * 429; a persistent daily-quota 429 (RPD) eventually exhausts the retries and surfaces.
 * Backoff: Retry-After seconds, else 2/4/8/16/32s (capped 60s). No jitter (deterministic).
 */
async function withRetry(fn: () => Promise<Response>, maxRetries = 5): Promise<Response> {
  let res = await fn();
  for (let attempt = 1; attempt <= maxRetries && (res.status === 429 || res.status >= 500); attempt++) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(120_000, retryAfter * 1000)
      : Math.min(60_000, 1000 * 2 ** attempt);
    await new Promise((r) => setTimeout(r, waitMs));
    res = await fn();
  }
  return res;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "";
  }
}
