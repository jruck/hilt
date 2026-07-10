import type { ViewPrefix } from "@/lib/url-utils";

export type SystemMode = "sessions" | "apps" | "stack" | "sync" | "graph" | "performance";

export function isSystemMode(value: string | null | undefined): value is SystemMode {
  return value === "apps" || value === "stack" || value === "sessions" || value === "sync" || value === "graph" || value === "performance";
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

/**
 * Legacy redirect: Threads and Chats graduated from System sub-modes to the top-level Chats
 * view. Old deep links (`/system/threads/<id>`, `/system/chats/<id>` — stale briefing/doc
 * links) must not dead-end; returns the `/chats` scope remainder, or null when the URL is
 * not a legacy conversation link.
 */
export function legacyConversationScopeFromSystemUrl(viewMode: ViewPrefix | null, scopePath: string): string | null {
  if (viewMode !== "system") return null;
  const parts = scopePath.split("/").filter(Boolean);
  if (parts[0] !== "threads" && parts[0] !== "chats") return null;
  return parts.length > 1 ? `/${parts.slice(1).join("/")}` : "";
}
