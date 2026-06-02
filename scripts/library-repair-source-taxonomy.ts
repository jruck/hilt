import fs from "fs";
import path from "path";
import { loadEnvConfig } from "@next/env";
import { parseMarkdownFile, stringifyMarkdown } from "../src/lib/library/markdown";
import { loadSources } from "../src/lib/library/source-config";
import { artifactTaxonomy, semanticTags, uniqueTags } from "../src/lib/library/taxonomy";
import type { LibrarySourceConfig, RawArtifact } from "../src/lib/library/types";
import { atomicWriteFile, canonicalUrl, dateOnly, walkMarkdown } from "../src/lib/library/utils";

loadEnvConfig(process.cwd());

const vaultPath = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd();
const args = process.argv.slice(2);
const write = args.includes("--write");

function argValue(name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
}

function numberArg(name: string, fallback: number): number {
  const value = Number(argValue(name));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function manualSource(): LibrarySourceConfig {
  return {
    id: "manual",
    name: "Manual",
    channel: "manual",
    url: "manual://reference-intake",
    enabled: true,
    cadence: "manual",
    intent: "explicit_save",
    library_mode: "study",
    retention: { mode: "durable", ttl_days: 30, candidate_ttl_days: 30, auto_promote_threshold: 0.85 },
    backfill: { enabled: false, mode: "none" },
    tags: [],
    filters: { include_topics: [], exclude_topics: [] },
    metadata: {},
    path: "",
  };
}

interface RaindropTaxonomy {
  source_tags: string[];
  source_collection: string | null;
  source_collection_id: string | null;
}

function collectionId(value: unknown): string | null {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const id = record.$id || record.id || record._id;
    if (typeof id === "string" || typeof id === "number") return String(id);
  }
  if (typeof value === "string" || typeof value === "number") return String(value);
  return null;
}

async function raindropGet<T>(token: string, url: string): Promise<T | null> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) return null;
  return response.json() as Promise<T>;
}

async function fetchRaindropCollections(token: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const endpoints = [
    "https://api.raindrop.io/rest/v1/collections",
    "https://api.raindrop.io/rest/v1/collections/childrens",
  ];
  for (const endpoint of endpoints) {
    const json = await raindropGet<{ items?: Array<Record<string, unknown>> }>(token, endpoint);
    for (const item of json?.items || []) {
      const id = collectionId(item._id ?? item.$id ?? item.id);
      const title = typeof item.title === "string" ? item.title : typeof item.name === "string" ? item.name : "";
      if (id && title.trim()) names.set(id, title.trim());
    }
  }
  return names;
}

async function fetchRaindropTaxonomy(): Promise<{ map: Map<string, RaindropTaxonomy>; checked: boolean; message: string | null }> {
  const token = process.env.RAINDROP_TOKEN;
  if (!token) return { map: new Map(), checked: false, message: "RAINDROP_TOKEN missing; live Raindrop tags were not fetched." };
  const perPage = numberArg("--per-page", 50);
  const maxPages = numberArg("--max-pages", 30);
  const collectionNames = await fetchRaindropCollections(token);
  const map = new Map<string, RaindropTaxonomy>();

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL("https://api.raindrop.io/rest/v1/raindrops/0");
    url.searchParams.set("sort", "-created");
    url.searchParams.set("perpage", String(perPage));
    url.searchParams.set("page", String(page));
    const json = await raindropGet<{ items?: Array<Record<string, unknown>> }>(token, url.toString());
    const items = json?.items || [];
    for (const item of items) {
      const link = typeof item.link === "string" ? item.link : "";
      if (!link) continue;
      const id = collectionId(item.collection);
      const title = id ? collectionNames.get(id) || null : null;
      map.set(canonicalUrl(link), {
        source_tags: uniqueTags(Array.isArray(item.tags) ? item.tags : []),
        source_collection: title,
        source_collection_id: id,
      });
    }
    if (items.length < perPage) break;
  }

  return { map, checked: true, message: null };
}

function relevantMarkdownFiles(): string[] {
  const refs = path.join(vaultPath, "references");
  const candidates = path.join(vaultPath, "references", ".cache", "library-candidates");
  return [
    ...walkMarkdown(refs).filter((filePath) => !filePath.includes(`${path.sep}.archive${path.sep}`)),
    ...walkMarkdown(candidates, { includeHidden: true }),
  ];
}

function sourceFor(id: string | null, sources: LibrarySourceConfig[]): LibrarySourceConfig {
  if (!id || id === "manual") return manualSource();
  return sources.find((source) => source.id === id) || {
    ...manualSource(),
    id,
    name: id,
    channel: id.includes("twitter") ? "twitter" : id.includes("raindrop") ? "raindrop" : "manual",
  };
}

function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>, keys: string[]): string[] {
  return keys.filter((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null));
}

async function main() {
  const sourceFilter = argValue("--source");
  const sources = loadSources(vaultPath);
  const shouldFetchRaindrop = !sourceFilter || sourceFor(sourceFilter, sources).channel === "raindrop";
  const raindrop = shouldFetchRaindrop
    ? await fetchRaindropTaxonomy()
    : {
        map: new Map<string, RaindropTaxonomy>(),
        checked: false,
        message: `Raindrop lookup skipped for source filter ${sourceFilter}.`,
      };
  const files = relevantMarkdownFiles();
  const changes: Array<{ path: string; title: string; source_id: string; changed: string[]; live_taxonomy: boolean }> = [];
  let scanned = 0;

  for (const filePath of files) {
    const parsed = parseMarkdownFile(filePath);
    if (parsed.data.type !== "reference" && parsed.data.type !== "reference-candidate") continue;
    const sourceId = typeof parsed.data.source_id === "string" ? parsed.data.source_id : "manual";
    if (sourceFilter && sourceId !== sourceFilter) continue;
    scanned += 1;

    const source = sourceFor(sourceId, sources);
    const url = typeof parsed.data.url === "string" ? parsed.data.url : "";
    const live = source.channel === "raindrop" && url ? raindrop.map.get(canonicalUrl(url)) : undefined;
    const metadata: Record<string, unknown> = {
      tags: live?.source_tags || parsed.data.source_tags || [],
      source_tags: live?.source_tags || parsed.data.source_tags || [],
      source_collection: live?.source_collection || parsed.data.source_collection,
      source_collection_id: live?.source_collection_id || parsed.data.source_collection_id,
      source_folder: parsed.data.source_folder || source.metadata.folder_name,
      source_folder_id: parsed.data.source_folder_id || source.metadata.folder_id,
      library_mode: parsed.data.library_mode,
    };
    const raw: RawArtifact = {
      url,
      title: typeof parsed.data.title === "string" ? parsed.data.title : parsed.body.match(/^#\s+(.+)$/m)?.[1] || path.basename(filePath, ".md"),
      author: typeof parsed.data.author === "string" ? parsed.data.author : undefined,
      date: typeof parsed.data.published === "string" ? parsed.data.published : typeof parsed.data.captured === "string" ? parsed.data.captured : dateOnly(),
      thumbnail: typeof parsed.data.thumbnail === "string" ? parsed.data.thumbnail : undefined,
      content: parsed.body,
      metadata,
    };
    const taxonomy = artifactTaxonomy(raw, source);
    const next: Record<string, unknown> = {
      ...parsed.data,
      tags: semanticTags(Array.isArray(parsed.data.tags) ? parsed.data.tags : []),
      source_tags: taxonomy.source_tags.length ? taxonomy.source_tags : undefined,
      source_collection: taxonomy.source_collection || undefined,
      source_collection_id: taxonomy.source_collection_id || undefined,
      source_folder: taxonomy.source_folder || undefined,
      source_folder_id: taxonomy.source_folder_id || undefined,
      library_mode: taxonomy.library_mode,
    };
    for (const key of ["tags", "source_tags", "source_collection", "source_collection_id", "source_folder", "source_folder_id"]) {
      if (Array.isArray(next[key]) && next[key].length === 0) delete next[key];
      if (next[key] === undefined || next[key] === null || next[key] === "") delete next[key];
    }
    const changed = changedKeys(parsed.data, next, ["tags", "source_tags", "source_collection", "source_collection_id", "source_folder", "source_folder_id", "library_mode"]);
    if (!changed.length) continue;
    changes.push({
      path: path.relative(vaultPath, filePath).split(path.sep).join("/"),
      title: raw.title,
      source_id: sourceId,
      changed,
      live_taxonomy: Boolean(live),
    });
    if (write) atomicWriteFile(filePath, stringifyMarkdown(next, parsed.body));
  }

  console.log(JSON.stringify({
    dry_run: !write,
    scanned,
    changed: changes.length,
    raindrop_checked: raindrop.checked,
    note: raindrop.message,
    changes,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
