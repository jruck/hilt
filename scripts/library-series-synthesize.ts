import path from "path";
import { loadEnvConfig } from "@next/env";
import { reweaveArtifact, buildKbIndex } from "../src/lib/library/connections";
import { listLibraryArtifactDetails } from "../src/lib/library/library";
import { stringifyMarkdown } from "../src/lib/library/markdown";
import { PIPELINE_VERSION } from "../src/lib/library/pipeline";
import { seriesFromRaw, seriesFrontmatter } from "../src/lib/library/series";
import { loadSources } from "../src/lib/library/source-config";
import { atomicWriteFile, isoNow, slugify } from "../src/lib/library/utils";
import type { LibraryArtifactDetail, LibrarySeriesMetadata, LibrarySourceConfig, ReweaveConnection } from "../src/lib/library/types";

loadEnvConfig(process.cwd());

const args = process.argv.slice(2);
const write = args.includes("--write");
const analyze = args.includes("--analyze");
const json = args.includes("--json");

function argValue(name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
}

const vaultPath = argValue("--vault")
  || process.env.BRIDGE_VAULT_PATH
  || process.env.HILT_WORKING_FOLDER
  || process.cwd();
const requestedSeriesId = argValue("--series-id");
const requestedSourceId = argValue("--source");
const timeoutMs = Number(argValue("--timeout-ms") || process.env.LIBRARY_REWEAVE_TIMEOUT_MS || 900_000);

function usage(): never {
  console.error("Usage: npm run library:series:synthesize -- --series-id <id>|--source <source-id> [--write] [--analyze] [--json]");
  process.exit(64);
}

function durationLabel(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = Math.floor(seconds % 60);
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function escapeTable(value: string | null | undefined): string {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function sourceHumanUrl(source: LibrarySourceConfig | undefined): string | null {
  if (!source) return null;
  if (source.url.startsWith("youtube://playlist/")) {
    const playlistId = source.url.slice("youtube://playlist/".length).trim();
    return playlistId ? `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}` : null;
  }
  return /^https?:\/\//.test(source.url) ? source.url : null;
}

function sourceSeries(source: LibrarySourceConfig | undefined): LibrarySeriesMetadata | undefined {
  if (!source) return undefined;
  return seriesFromRaw({
    url: source.url,
    title: source.name,
    date: new Date().toISOString(),
    metadata: {},
  }, source);
}

function defaultParentPath(series: LibrarySeriesMetadata, source: LibrarySourceConfig | undefined): string {
  const configured = argValue("--out") || series.parent_path || null;
  const candidate = configured || `references/series/${slugify(series.id || source?.id || series.title)}.md`;
  if (path.isAbsolute(candidate)) throw new Error(`Parent path must be vault-relative: ${candidate}`);
  let normalized = candidate.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized.endsWith(".md")) normalized = `${normalized}.md`;
  if (normalized.split("/").some((part) => part === "..")) {
    throw new Error(`Unsafe parent path: ${candidate}`);
  }
  return normalized;
}

function childOrder(a: LibraryArtifactDetail, b: LibraryArtifactDetail): number {
  const ai = a.series?.index || Number.MAX_SAFE_INTEGER;
  const bi = b.series?.index || Number.MAX_SAFE_INTEGER;
  return ai - bi || a.title.localeCompare(b.title) || a.path.localeCompare(b.path);
}

function childLink(artifact: LibraryArtifactDetail): string {
  const target = artifact.path.replace(/\.md$/, "");
  return `[[${target}|${artifact.title}]]`;
}

function childContext(artifact: LibraryArtifactDetail): string {
  const keyPoints = artifact.key_points.length
    ? artifact.key_points.map((point) => `- ${point}`).join("\n")
    : "";
  return [
    `# ${artifact.series?.index || "?"}. ${artifact.title}`,
    artifact.url ? `URL: ${artifact.url}` : "",
    `Library path: ${artifact.path}`,
    artifact.summary ? `Summary: ${artifact.summary}` : "",
    keyPoints ? `Key points:\n${keyPoints}` : "",
  ].filter(Boolean).join("\n");
}

function connectionLines(connections: ReweaveConnection[]): string {
  if (!connections.length) return "";
  return connections.map((connection) => {
    const link = connection.target ? `[[${connection.target}|${connection.title}]]` : connection.title;
    return `- ${link} - ${connection.relationship}`;
  }).join("\n");
}

function compactFrontmatter(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactFrontmatter);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => [key, compactFrontmatter(entry)] as const)
      .filter(([, entry]) => entry !== undefined),
  );
}

async function buildAnalysis(series: LibrarySeriesMetadata, source: LibrarySourceConfig | undefined, children: LibraryArtifactDetail[]): Promise<string | null> {
  if (!analyze || !children.length) return null;
  const kbIndex = buildKbIndex(vaultPath);
  const sourceContent = children.map(childContext).join("\n\n---\n\n");
  const intent = [
    "format: video-series",
    source ? `source: ${source.name}` : "",
    `items: ${children.length}`,
    "mode: study / analyze the playlist as one coherent series while preserving item-level distinctions",
  ].filter(Boolean).join("; ");
  const reweave = await reweaveArtifact(kbIndex, {
    title: series.title,
    sourceContent,
    intent,
  }, { vaultPath, timeoutMs });
  if (!reweave?.digest_markdown.trim()) return null;
  const connections = connectionLines([...reweave.connections_first_party, ...reweave.connections_library]);
  return `${reweave.digest_markdown.trim()}${connections ? `\n\n## Connections\n\n${connections}` : ""}`;
}

function buildSeriesMarkdown(input: {
  series: LibrarySeriesMetadata;
  source?: LibrarySourceConfig;
  children: LibraryArtifactDetail[];
  parentPath: string;
  analysisMarkdown: string | null;
}): string {
  const { series, source, children, parentPath, analysisMarkdown } = input;
  const generatedAt = isoNow();
  const totalDuration = children.reduce((sum, child) => sum + (child.video_duration_seconds || 0), 0);
  const tags = Array.from(new Set(children.flatMap((child) => child.tags))).slice(0, 20);
  const childReferences = children.map((child) => ({
    index: child.series?.index || null,
    title: child.title,
    path: child.path,
    url: child.url || undefined,
    status: child.lifecycle_status,
  }));
  const frontmatter = {
    type: "reference",
    pipeline_version: PIPELINE_VERSION,
    title: series.title,
    description: `Parent series note for ${children.length} Library item${children.length === 1 ? "" : "s"} in ${series.title}.`,
    url: series.url || sourceHumanUrl(source) || undefined,
    format: "video-series",
    channel: source?.channel || "youtube",
    source_id: source?.id || undefined,
    source_name: source?.name || undefined,
    library_mode: "study",
    series_role: "parent",
    generated_at: generatedAt,
    child_count: children.length,
    child_references: childReferences.length ? childReferences : undefined,
    tags: tags.length ? tags : undefined,
    ...seriesFrontmatter({ ...series, index: null, parent_path: parentPath }),
  };
  const rows = children.map((child) => [
    String(child.series?.index || ""),
    childLink(child),
    child.lifecycle_status,
    durationLabel(child.video_duration_seconds),
    child.summary || "",
  ]);
  const table = [
    "| # | Item | Status | Duration | Summary |",
    "|---:|---|---|---:|---|",
    ...rows.map((row) => `| ${row.map(escapeTable).join(" | ")} |`),
  ].join("\n");
  const sourceLine = series.url || sourceHumanUrl(source)
    ? `Source playlist: ${series.url || sourceHumanUrl(source)}`
    : "";
  const analysisBlock = analysisMarkdown
    ? `\n\n## Cross-Series Synthesis\n\n${analysisMarkdown}`
    : "\n\n## Cross-Series Synthesis\n\nRun this script with `--analyze --write` after the child notes are digested/reweaved to refresh this section with a whole-series read.";
  const body = `# ${series.title}

## Series Map

${sourceLine}

${children.length} child item${children.length === 1 ? "" : "s"}${totalDuration ? `, ${durationLabel(totalDuration)} total runtime` : ""}.

${table}${analysisBlock}
`;
  return stringifyMarkdown(compactFrontmatter(frontmatter) as Record<string, unknown>, body);
}

async function main(): Promise<void> {
  if (!requestedSeriesId && !requestedSourceId) usage();
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error(`Invalid --timeout-ms: ${timeoutMs}`);

  const source = requestedSourceId
    ? loadSources(vaultPath).find((candidate) => candidate.id === requestedSourceId)
    : undefined;
  if (requestedSourceId && !source) throw new Error(`Source not found: ${requestedSourceId}`);

  const all = listLibraryArtifactDetails(vaultPath, {
    includeCandidates: true,
    status: "all",
    mode: "all",
    limit: 100000,
  }).artifacts;
  const children = all
    .filter((artifact) => artifact.raw_frontmatter.series_role !== "parent")
    .filter((artifact) => requestedSeriesId ? artifact.series?.id === requestedSeriesId : artifact.source_id === requestedSourceId)
    .sort(childOrder);
  const firstSeries = children.find((artifact) => artifact.series)?.series;
  const series = firstSeries
    || sourceSeries(source)
    || (requestedSeriesId ? { id: requestedSeriesId, title: requestedSeriesId } : undefined);
  if (!series) throw new Error("No series metadata found. Pass --series-id or use a source with metadata.series_id.");

  const parentPath = defaultParentPath(series, source);
  const outputPath = path.join(vaultPath, parentPath);
  const analysisMarkdown = await buildAnalysis(series, source, children);
  const markdown = buildSeriesMarkdown({ series, source, children, parentPath, analysisMarkdown });

  const report = {
    write,
    analyze,
    vault: vaultPath,
    series_id: series.id,
    title: series.title,
    source_id: source?.id || null,
    child_count: children.length,
    parent_path: parentPath,
    output_path: outputPath,
    child_paths: children.map((child) => child.path),
  };

  if (write) atomicWriteFile(outputPath, markdown);

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`${write ? "Wrote" : "Would write"} ${parentPath} for ${children.length} child item${children.length === 1 ? "" : "s"}.`);
  if (!write) console.log(markdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
