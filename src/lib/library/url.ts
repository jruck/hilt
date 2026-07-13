import { buildViewUrl } from "@/lib/url-utils";

export type LibraryDensity = "feed" | "list";
export type LibraryRanking = "recent" | "for-you" | "new" | "updated";
export type LibraryStatusFilter = "all" | "saved" | "candidate";
export type LibraryModeControl = "study" | "keep";

export const LIBRARY_CHANNEL_SOURCE_PREFIX = "channel:";

export function libraryChannelSource(channel: string): string {
  return `${LIBRARY_CHANNEL_SOURCE_PREFIX}${channel}`;
}

export function librarySourceChannel(source: string | null | undefined): string | null {
  return source?.startsWith(LIBRARY_CHANNEL_SOURCE_PREFIX)
    ? source.slice(LIBRARY_CHANNEL_SOURCE_PREFIX.length) || null
    : null;
}

export function libraryConcreteSource(source: string | null | undefined): string | null {
  return librarySourceChannel(source) ? null : source || null;
}

export interface LibraryUrlControls {
  density: LibraryDensity;
  ranking: LibraryRanking;
  status: LibraryStatusFilter;
  mode: LibraryModeControl;
  source: string | null;
  tag: string | null;
  attention: boolean;
}

export interface LibraryUrlContext {
  recommendationEpisodeId?: string | null;
}

export const defaultLibraryUrlControls: LibraryUrlControls = {
  density: "feed",
  ranking: "recent",
  status: "all",
  mode: "study",
  source: null,
  tag: null,
  attention: false,
};

function validDensity(value: string | null): LibraryDensity {
  return value === "list" ? "list" : "feed";
}

function validRanking(value: string | null): LibraryRanking {
  if (value === "for-you" || value === "new" || value === "updated") return value;
  return "recent";
}

function validStatus(value: string | null): LibraryStatusFilter {
  if (value === "saved" || value === "candidate") return value;
  return "all";
}

function validMode(value: string | null): LibraryModeControl {
  if (value === "keep") return value;
  return "study";
}

export function parseLibraryControls(search: string): LibraryUrlControls {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return {
    density: validDensity(params.get("view")),
    ranking: validRanking(params.get("rank")),
    status: validStatus(params.get("status")),
    mode: validMode(params.get("mode")),
    source: params.get("source") || null,
    tag: params.get("tag") || null,
    attention: params.get("attention") === "true",
  };
}

export function buildLibrarySearch(controls: LibraryUrlControls, context: LibraryUrlContext = {}): string {
  const params = new URLSearchParams();
  if (controls.density !== defaultLibraryUrlControls.density) params.set("view", controls.density);
  if (controls.ranking !== defaultLibraryUrlControls.ranking) params.set("rank", controls.ranking);
  if (controls.status !== defaultLibraryUrlControls.status) params.set("status", controls.status);
  if (controls.mode !== defaultLibraryUrlControls.mode) params.set("mode", controls.mode);
  if (controls.source) params.set("source", controls.source);
  if (controls.tag) params.set("tag", controls.tag);
  if (controls.attention) params.set("attention", "true");
  if (context.recommendationEpisodeId) params.set("rec", context.recommendationEpisodeId);
  const search = params.toString();
  return search ? `?${search}` : "";
}

export function recommendationEpisodeIdFromSearch(search: string): string | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const value = params.get("rec");
  return value && /^rec-[a-z0-9][a-z0-9-]*$/i.test(value) ? value : null;
}

export function libraryItemScope(id: string): string {
  return `/item/${encodeURIComponent(id)}`;
}

export function libraryItemIdFromScope(scope: string): string | null {
  const [kind, id] = scope.split("/").filter(Boolean);
  if (kind !== "item" || !id) return null;
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

export function buildLibraryUrl(scope: string, controls: LibraryUrlControls = defaultLibraryUrlControls, context: LibraryUrlContext = {}): string {
  return `${buildViewUrl("library", scope)}${buildLibrarySearch(controls, context)}`;
}

export function buildLibraryItemUrl(id: string, controls: LibraryUrlControls = defaultLibraryUrlControls, context: LibraryUrlContext = {}): string {
  return buildLibraryUrl(libraryItemScope(id), controls, context);
}
