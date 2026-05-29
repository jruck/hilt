export interface LegacyReferenceBodyCleanup {
  data: Record<string, unknown>;
  body: string;
  removedNavigation: boolean;
  removedMetadataKeys: string[];
  addedFrontmatterKeys: string[];
  movedLeadingMedia: boolean;
}

const TOP_METADATA_KEYS = new Set([
  "source",
  "author",
  "publisher",
  "date",
  "published",
  "captured",
  "summarized",
  "format",
  "tweet",
]);

const NAVIGATION_PATTERN = /^\s*(?:<-|←)\s+\[\[index\|References\]\]\s*$/;
const HORIZONTAL_RULE_PATTERN = /^\s*---+\s*$/;

function normalizeKey(value: string): string {
  return value.trim().replace(/:$/, "").toLowerCase();
}

function metadataLine(line: string): { key: string; value: string } | null {
  const match = line.match(/^\s*\*\*([^*]+?)\*\*:?\s*(.+?)\s*$/);
  if (!match) return null;
  const key = normalizeKey(match[1]);
  if (!TOP_METADATA_KEYS.has(key)) return null;
  return { key, value: match[2].trim() };
}

function firstUrl(value: string): string | null {
  const markdownLink = value.match(/\[[^\]]+]\((https?:\/\/[^)]+)\)/);
  if (markdownLink) return markdownLink[1].trim();
  const bareUrl = value.match(/https?:\/\/\S+/);
  return bareUrl?.[0].replace(/[),.;]+$/, "") || null;
}

function dateOnly(value: string): string | null {
  const parsed = new Date(value.trim());
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function hasValue(data: Record<string, unknown>, key: string): boolean {
  const value = data[key];
  if (typeof value === "string") return value.trim().length > 0;
  return value !== null && value !== undefined && value !== "";
}

function addIfMissing(
  data: Record<string, unknown>,
  key: string,
  value: unknown,
  added: string[],
): void {
  if (value === null || value === undefined || value === "") return;
  if (hasValue(data, key)) return;
  data[key] = value;
  added.push(key);
}

function translatedMetadata(data: Record<string, unknown>, metadata: Map<string, string>): { data: Record<string, unknown>; added: string[] } {
  const next = { ...data };
  const added: string[] = [];
  const sourceUrl = metadata.has("source") ? firstUrl(metadata.get("source") || "") : null;
  const tweetUrl = metadata.has("tweet") ? firstUrl(metadata.get("tweet") || "") : null;

  addIfMissing(next, "url", sourceUrl, added);
  addIfMissing(next, "author", metadata.get("author"), added);
  addIfMissing(next, "publisher", metadata.get("publisher"), added);
  addIfMissing(next, "published", dateOnly(metadata.get("published") || metadata.get("date") || ""), added);
  addIfMissing(next, "captured", dateOnly(metadata.get("captured") || metadata.get("summarized") || ""), added);
  addIfMissing(next, "format", metadata.get("format"), added);
  addIfMissing(next, "tweet_url", tweetUrl, added);

  return { data: next, added };
}

function trimBlankEdges(lines: string[]): string[] {
  const next = [...lines];
  while (next[0] !== undefined && !next[0].trim()) next.shift();
  while (next[next.length - 1] !== undefined && !next[next.length - 1].trim()) next.pop();
  return next;
}

function moveLeadingMediaAfterHeading(body: string): { body: string; moved: boolean } {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const h1Index = lines.findIndex((line) => /^#\s+/.test(line));
  if (h1Index <= 0) return { body, moved: false };

  const beforeHeading = lines.slice(0, h1Index);
  const mediaIndex = beforeHeading.findIndex((line) => line.trim().toLowerCase() === "## media");
  if (mediaIndex === -1) return { body, moved: false };
  if (beforeHeading.slice(0, mediaIndex).some((line) => line.trim())) return { body, moved: false };

  const mediaLines = trimBlankEdges(beforeHeading.slice(mediaIndex));
  if (!mediaLines.length) return { body, moved: false };

  const afterHeading = lines.slice(h1Index + 1);
  while (afterHeading[0] !== undefined && !afterHeading[0].trim()) afterHeading.shift();
  const nextBody = [lines[h1Index], "", ...mediaLines, "", ...afterHeading].join("\n").trimEnd() + "\n";
  return { body: nextBody, moved: true };
}

export function stripLegacyReferenceBodyCruft(body: string): string {
  return cleanupLegacyReferenceBody({}, body).body;
}

export function cleanupLegacyReferenceBody(data: Record<string, unknown>, body: string): LegacyReferenceBodyCleanup {
  const normalizedBody = body.replace(/\r\n/g, "\n");
  const lines = normalizedBody.split("\n");
  const h1Index = lines.findIndex((line) => /^#\s+/.test(line));
  if (h1Index === -1) {
    return { data, body, removedNavigation: false, removedMetadataKeys: [], addedFrontmatterKeys: [], movedLeadingMedia: false };
  }

  let scanEnd = h1Index + 1;
  let removedNavigation = false;
  let sawMetadata = false;
  const metadata = new Map<string, string>();

  for (let index = h1Index + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      scanEnd = index + 1;
      continue;
    }
    if (/^##\s+/.test(line)) break;
    if (NAVIGATION_PATTERN.test(line)) {
      removedNavigation = true;
      scanEnd = index + 1;
      continue;
    }
    const parsedMetadata = metadataLine(line);
    if (parsedMetadata) {
      sawMetadata = true;
      metadata.set(parsedMetadata.key, parsedMetadata.value);
      scanEnd = index + 1;
      continue;
    }
    if (HORIZONTAL_RULE_PATTERN.test(line) && (removedNavigation || sawMetadata)) {
      scanEnd = index + 1;
      continue;
    }
    break;
  }

  if (!removedNavigation && !sawMetadata) {
    const moved = moveLeadingMediaAfterHeading(body);
    return {
      data,
      body: moved.body,
      removedNavigation: false,
      removedMetadataKeys: [],
      addedFrontmatterKeys: [],
      movedLeadingMedia: moved.moved,
    };
  }

  const before = lines.slice(0, h1Index + 1);
  const after = lines.slice(scanEnd);
  while (after[0] !== undefined && !after[0].trim()) after.shift();

  const nextBody = [...before, "", ...after].join("\n").trimEnd() + "\n";
  const moved = moveLeadingMediaAfterHeading(nextBody);
  const translated = translatedMetadata(data, metadata);
  return {
    data: translated.data,
    body: moved.body,
    removedNavigation,
    removedMetadataKeys: Array.from(metadata.keys()),
    addedFrontmatterKeys: translated.added,
    movedLeadingMedia: moved.moved,
  };
}
