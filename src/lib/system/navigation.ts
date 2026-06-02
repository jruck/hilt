import type { ViewPrefix } from "@/lib/url-utils";

export type SystemMode = "sessions" | "apps" | "stack" | "sync" | "graph";

export function isSystemMode(value: string | null | undefined): value is SystemMode {
  return value === "apps" || value === "stack" || value === "sessions" || value === "sync" || value === "graph";
}

export function systemScopeForMode(mode: SystemMode, stackScope = ""): string {
  if (mode === "stack" && stackScope) return `/stack${stackScope}`;
  return `/${mode}`;
}

export function systemModeFromUrl(viewMode: ViewPrefix | null, scopePath: string): SystemMode {
  if (viewMode === "map") return "sessions";
  if (viewMode === "local-apps") return "apps";
  if (viewMode === "stack") return "stack";
  if (viewMode !== "system") return "sessions";
  const first = scopePath.split("/").filter(Boolean)[0];
  return isSystemMode(first) ? first : "sessions";
}

export function stackScopeFromSystemUrl(viewMode: ViewPrefix | null, scopePath: string): string {
  if (viewMode === "stack") return scopePath;
  if (viewMode !== "system") return "";
  const parts = scopePath.split("/").filter(Boolean);
  if (parts[0] !== "stack") return "";
  return parts.length > 1 ? `/${parts.slice(1).join("/")}` : "";
}
