import { buildViewUrl } from "@/lib/url-utils";

export type LibraryDensity = "feed" | "list";
export type LibraryRanking = "recent" | "for-you" | "new";
export type LibraryStatusFilter = "all" | "saved" | "candidate";

export interface LibraryUrlControls {
  density: LibraryDensity;
  ranking: LibraryRanking;
  status: LibraryStatusFilter;
  source: string | null;
}

export const defaultLibraryUrlControls: LibraryUrlControls = {
  density: "feed",
  ranking: "recent",
  status: "all",
  source: null,
};

function validDensity(value: string | null): LibraryDensity {
  return value === "list" ? "list" : "feed";
}

function validRanking(value: string | null): LibraryRanking {
  if (value === "for-you" || value === "new") return value;
  return "recent";
}

function validStatus(value: string | null): LibraryStatusFilter {
  if (value === "saved" || value === "candidate") return value;
  return "all";
}

export function parseLibraryControls(search: string): LibraryUrlControls {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return {
    density: validDensity(params.get("view")),
    ranking: validRanking(params.get("rank")),
    status: validStatus(params.get("status")),
    source: params.get("source") || null,
  };
}

export function buildLibrarySearch(controls: LibraryUrlControls): string {
  const params = new URLSearchParams();
  if (controls.density !== defaultLibraryUrlControls.density) params.set("view", controls.density);
  if (controls.ranking !== defaultLibraryUrlControls.ranking) params.set("rank", controls.ranking);
  if (controls.status !== defaultLibraryUrlControls.status) params.set("status", controls.status);
  if (controls.source) params.set("source", controls.source);
  const search = params.toString();
  return search ? `?${search}` : "";
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

export function buildLibraryUrl(scope: string, controls: LibraryUrlControls = defaultLibraryUrlControls): string {
  return `${buildViewUrl("library", scope)}${buildLibrarySearch(controls)}`;
}

export function buildLibraryItemUrl(id: string, controls: LibraryUrlControls = defaultLibraryUrlControls): string {
  return buildLibraryUrl(libraryItemScope(id), controls);
}
