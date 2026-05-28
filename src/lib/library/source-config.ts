import fs from "fs";
import path from "path";
import YAML from "yaml";
import { z } from "zod";
import type { LibraryChannel, LibrarySourceConfig } from "./types";

const sourceConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  channel: z.enum(["rss", "youtube", "twitter", "email", "raindrop", "manual", "fixture"]),
  url: z.string().min(1),
  enabled: z.boolean().default(true),
  cadence: z.enum(["manual", "hourly", "daily", "weekly"]).default("hourly"),
  intent: z.enum(["discovery", "explicit_save"]).default("discovery"),
  signal: z.string().optional(),
  retention: z.object({
    mode: z.enum(["durable", "candidate"]).default("candidate"),
    ttl_days: z.number().int().min(1).max(3650).optional(),
    candidate_ttl_days: z.number().int().min(1).max(3650).optional(),
    auto_promote_threshold: z.number().min(0).max(1).default(0.85),
  }).default({ mode: "candidate", ttl_days: 30, auto_promote_threshold: 0.85 })
    .transform((retention) => {
      const ttl = retention.candidate_ttl_days ?? retention.ttl_days ?? 30;
      return { ...retention, ttl_days: retention.ttl_days ?? ttl, candidate_ttl_days: ttl };
    }),
  auth: z.object({
    required: z.boolean().default(false),
    env: z.union([z.string(), z.array(z.string())]).optional(),
    scopes: z.array(z.string()).default([]),
    stop_on_missing_credential: z.boolean().default(true),
  }).optional(),
  backfill: z.object({
    enabled: z.boolean().default(false),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(500).optional(),
    mode: z.enum(["none", "checkpointed", "full"]).default("none"),
  }).default({ enabled: false, mode: "none" }),
  tags: z.array(z.string()).default([]),
  filters: z.object({
    include_topics: z.array(z.string()).default([]),
    exclude_topics: z.array(z.string()).default([]),
    content_types: z.array(z.string()).optional(),
  }).default({ include_topics: [], exclude_topics: [] }),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  fixtures: z.array(z.object({
    url: z.string(),
    title: z.string(),
    author: z.string().optional(),
    date: z.string(),
    thumbnail: z.string().optional(),
    content: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })).optional(),
});

export type LibrarySourceConfigInput = z.input<typeof sourceConfigSchema>;

export const SOURCES_DIR = path.join("meta", "sources");
export const SOURCE_STATE_FILE = path.join(SOURCES_DIR, ".source-state.json");

export function sourceConfigDir(vaultPath: string): string {
  return path.join(vaultPath, SOURCES_DIR);
}

export function loadSources(vaultPath: string): LibrarySourceConfig[] {
  const dir = sourceConfigDir(vaultPath);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir)
    .filter((name) => (name.endsWith(".yaml") || name.endsWith(".yml")) && !name.startsWith("."))
    .sort();

  return files.map((name) => {
    const filePath = path.join(dir, name);
    const parsed = YAML.parse(fs.readFileSync(filePath, "utf-8")) as LibrarySourceConfigInput;
    const source = sourceConfigSchema.parse(parsed);
    if (source.intent === "explicit_save" && !source.signal && source.channel !== "raindrop") {
      throw new Error(`Source ${source.id} is explicit_save but does not declare a signal`);
    }
    return { ...source, channel: source.channel as LibraryChannel, path: filePath };
  });
}

export interface SourceStateEntry {
  last_checked_at?: string;
  last_success_at?: string;
  last_error?: string;
  cursor?: string;
  backfill_complete_at?: string;
  blocked_reason?: string;
}

export type SourceState = Record<string, SourceStateEntry>;

export function readSourceState(vaultPath: string): SourceState {
  const filePath = path.join(vaultPath, SOURCE_STATE_FILE);
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as SourceState;
  } catch {
    return {};
  }
}

export function writeSourceState(vaultPath: string, state: SourceState): void {
  const filePath = path.join(vaultPath, SOURCE_STATE_FILE);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
}
