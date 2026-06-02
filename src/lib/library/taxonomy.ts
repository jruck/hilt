import type { LibraryMode, LibraryModeFilter, LibrarySourceConfig, RawArtifact } from "./types";

const SYSTEM_TAGS = new Set([
  "article",
  "bookmark",
  "bookmarks",
  "candidate",
  "email",
  "fixture",
  "link",
  "manual",
  "newsletter",
  "podcast",
  "raindrop",
  "reference",
  "rss",
  "source",
  "superhuman",
  "tweet",
  "twitter",
  "video",
  "x",
  "youtube",
]);

const KEEP_TERMS = new Set([
  "clothing",
  "clothes",
  "wardrobe",
  "fashion",
  "style",
  "shoe",
  "shoes",
  "shirt",
  "shirts",
  "t-shirt",
  "tee",
  "pants",
  "jacket",
  "coat",
  "furniture",
  "chair",
  "chairs",
  "sofa",
  "couch",
  "ottoman",
  "table",
  "desk",
  "lamp",
  "rug",
  "decor",
  "wishlist",
  "shopping",
  "shop",
  "store",
  "recipe",
  "recipes",
  "restaurant",
  "restaurants",
  "hotel",
  "hotels",
]);

const KEEP_HOST_TERMS = [
  "westelm",
  "ugmonk",
  "everybody.world",
  "shop.",
  "store.",
];

function normalizeTag(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const tag = String(value).trim().replace(/^#/, "");
  return tag || null;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

export function uniqueTags(values: unknown[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const tag = normalizeTag(value);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(tag);
  }
  return output;
}

export function semanticTags(values: unknown[]): string[] {
  return uniqueTags(values).filter((tag) => !SYSTEM_TAGS.has(tag.toLowerCase()));
}

function metadataString(metadata: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function metadataId(metadata: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function collectionInfo(metadata: Record<string, unknown>): { label: string | null; id: string | null } {
  const explicitLabel = metadataString(metadata, ["source_collection", "collection_title", "collection_name"]);
  const explicitId = metadataId(metadata, ["source_collection_id", "collection_id"]);
  const collection = metadata.collection;
  if (collection && typeof collection === "object") {
    const record = collection as Record<string, unknown>;
    const label = explicitLabel || metadataString(record, ["title", "name"]);
    const id = explicitId || metadataId(record, ["$id", "id", "_id"]);
    return { label: label || null, id: id || null };
  }
  return { label: explicitLabel || null, id: explicitId || null };
}

export interface ArtifactTaxonomy {
  semantic_tags: string[];
  source_tags: string[];
  source_collection: string | null;
  source_collection_id: string | null;
  source_folder: string | null;
  source_folder_id: string | null;
  library_mode: LibraryMode;
}

function modeFromMetadata(metadata: Record<string, unknown>): LibraryMode | null {
  const value = metadata.library_mode || metadata.capture_mode || metadata.mode;
  return value === "keep" || value === "study" ? value : null;
}

function sourceDefaultMode(source: LibrarySourceConfig): LibraryMode | null {
  return source.library_mode === "keep" || source.library_mode === "study" ? source.library_mode : null;
}

function looksLikeKeep(raw: RawArtifact, sourceTags: string[], sourceCollection: string | null, sourceFolder: string | null): boolean {
  const taxonomyTerms = uniqueTags([
    ...sourceTags,
    sourceCollection,
    sourceFolder,
  ]).map((tag) => tag.toLowerCase());
  if (taxonomyTerms.some((tag) => KEEP_TERMS.has(tag))) return true;

  const titleWords = (raw.title.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || []);
  if (titleWords.some((word) => KEEP_TERMS.has(word))) return true;

  try {
    const host = new URL(raw.url).hostname.toLowerCase();
    return KEEP_HOST_TERMS.some((term) => host.includes(term));
  } catch {
    return false;
  }
}

export function artifactTaxonomy(raw: RawArtifact, source: LibrarySourceConfig): ArtifactTaxonomy {
  const rawSourceTags = uniqueTags([
    ...toStringArray(raw.metadata.source_tags),
    ...toStringArray(raw.metadata.tags),
  ]);
  const sourceTags = semanticTags(rawSourceTags);
  const collection = collectionInfo(raw.metadata);
  const rawSourceFolder = metadataString(raw.metadata, ["source_folder", "folder_name"]);
  const sourceFolder = source.channel === "email"
    ? friendlyNewsletterSender(rawSourceFolder) || rawSourceFolder
    : rawSourceFolder;
  const sourceFolderId = metadataId(raw.metadata, ["source_folder_id", "folder_id"]);
  const semantic = semanticTags([
    ...source.tags,
    ...toStringArray(raw.metadata.semantic_tags),
  ]);
  const explicitMode = modeFromMetadata(raw.metadata) || sourceDefaultMode(source);
  const libraryMode = explicitMode || (looksLikeKeep(raw, sourceTags, collection.label, sourceFolder) ? "keep" : "study");

  return {
    semantic_tags: semantic,
    source_tags: sourceTags,
    source_collection: collection.label,
    source_collection_id: collection.id,
    source_folder: sourceFolder,
    source_folder_id: sourceFolderId,
    library_mode: libraryMode,
  };
}

export function validLibraryModeFilter(value: string | null | undefined): LibraryModeFilter {
  if (value === "all" || value === "keep") return value;
  return "study";
}

export function validLibraryMode(value: unknown): LibraryMode {
  return value === "keep" ? "keep" : "study";
}

function titleCaseNewsletterPart(value: string): string {
  return value
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((part) => part.length <= 2 ? part.toUpperCase() : `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function friendlyNewsletterSender(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const bracketEmail = text.match(/<([^<>@\s]+@[^<>@\s]+)>/);
  const rawEmail = bracketEmail?.[1] || text.match(/[^\s<>]+@[^\s<>]+/)?.[0] || "";
  if (!rawEmail) return text;

  const email = rawEmail.toLowerCase();
  const known: Record<string, string> = {
    "swyx+ainews@substack.com": "AI News",
    "swyx@substack.com": "swyx",
    "email@stratechery.com": "Stratechery",
    "blog@tomtunguz.com": "Tomasz Tunguz",
    "founders@sacra.com": "Sacra",
    "semianalysis@substack.com": "SemiAnalysis",
    "lenny@substack.com": "Lenny",
    "noahpinion@substack.com": "Noahpinion",
    "austinscholar@substack.com": "Austin Scholar",
  };
  if (known[email]) return known[email];

  const [local, domain] = email.split("@");
  if (!local || !domain) return text;
  if (domain === "substack.com") return titleCaseNewsletterPart(local.split("+")[1] || local);
  const baseDomain = domain.replace(/^news\./, "").replace(/\.(com|co|io|org|net)$/i, "");
  if (local === "email" || local === "reply" || local === "newsletter" || local === "news" || local === "blog") {
    return titleCaseNewsletterPart(baseDomain);
  }
  return titleCaseNewsletterPart(local.split("+")[0]);
}

export function artifactDisplayTags(input: {
  source_tags?: string[];
  source_collection?: string | null;
  source_folder?: string | null;
  tags?: string[];
}): string[] {
  return uniqueTags([
    ...(input.source_collection ? [input.source_collection] : []),
    ...(input.source_folder ? [input.source_folder] : []),
    ...(input.source_tags || []),
    ...(input.tags || []),
  ]).filter((tag) => !SYSTEM_TAGS.has(tag.toLowerCase()));
}
