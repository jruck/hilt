import type { LibrarySeriesMetadata, LibrarySourceConfig, RawArtifact } from "./types";

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveIntegerField(value: unknown): number | undefined {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return undefined;
  return Math.floor(parsed);
}

function compactSeries(input: {
  id?: string;
  title?: string;
  url?: string;
  index?: number;
  total?: number;
  parentPath?: string;
}): LibrarySeriesMetadata | undefined {
  if (!input.id) return undefined;
  return {
    id: input.id,
    title: input.title || input.id,
    url: input.url || null,
    index: input.index ?? null,
    total: input.total ?? null,
    parent_path: input.parentPath || null,
  };
}

export function seriesFromRaw(raw: RawArtifact, source: LibrarySourceConfig): LibrarySeriesMetadata | undefined {
  const metadata = raw.metadata || {};
  return compactSeries({
    id: stringField(metadata.series_id) || stringField(source.metadata.series_id),
    title: stringField(metadata.series_title)
      || stringField(source.metadata.series_title)
      || stringField(metadata.playlist_title)
      || stringField(source.metadata.playlist_title),
    url: stringField(metadata.series_url)
      || stringField(source.metadata.series_url)
      || stringField(metadata.playlist_url)
      || stringField(source.metadata.playlist_url),
    index: positiveIntegerField(metadata.series_index) || positiveIntegerField(metadata.playlist_index),
    total: positiveIntegerField(metadata.series_total)
      || positiveIntegerField(source.metadata.series_total)
      || positiveIntegerField(metadata.playlist_total)
      || positiveIntegerField(source.metadata.playlist_total),
    parentPath: stringField(metadata.series_parent)
      || stringField(source.metadata.series_parent)
      || stringField(metadata.series_parent_path)
      || stringField(source.metadata.series_parent_path),
  });
}

export function seriesFromFrontmatter(data: Record<string, unknown>): LibrarySeriesMetadata | undefined {
  const nested = data.series && typeof data.series === "object" ? data.series as Record<string, unknown> : {};
  return compactSeries({
    id: stringField(data.series_id) || stringField(nested.id),
    title: stringField(data.series_title) || stringField(nested.title),
    url: stringField(data.series_url) || stringField(nested.url),
    index: positiveIntegerField(data.series_index) || positiveIntegerField(nested.index),
    total: positiveIntegerField(data.series_total) || positiveIntegerField(nested.total),
    parentPath: stringField(data.series_parent)
      || stringField(data.series_parent_path)
      || stringField(nested.parent_path)
      || stringField(nested.parent),
  });
}

export function seriesFrontmatter(series: LibrarySeriesMetadata | undefined): Record<string, unknown> {
  if (!series) return {};
  return {
    series_id: series.id,
    series_title: series.title,
    series_url: series.url || undefined,
    series_index: series.index || undefined,
    series_total: series.total || undefined,
    series_parent: series.parent_path || undefined,
  };
}
