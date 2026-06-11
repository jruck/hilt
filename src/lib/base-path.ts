/**
 * Base-path helpers for serving Hilt behind a path-routing gateway
 * (e.g. Tailscale Serve mapping /hilt -> localhost:3000).
 *
 * NEXT_PUBLIC_BASE_PATH is inlined at build time (normalized in
 * next.config.ts). Unset => "" => every helper is a no-op, so ordinary
 * unprefixed dev/Electron behavior is unchanged.
 */

/** Normalized base path: leading slash, no trailing slash, "" when unset. */
export function getBasePath(): string {
  const raw = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  if (!raw || raw === "/") return "";
  return `/${raw.replace(/^\/+|\/+$/g, "")}`;
}

/**
 * Prefix an app-owned root-relative URL with the base path.
 *
 * Only paths starting with a single "/" are prefixed. External URLs
 * (http(s)://, protocol-relative //), data:/blob: URLs, hashes, relative
 * paths, and already-prefixed paths pass through untouched.
 */
export function withBasePath(path: string): string {
  const base = getBasePath();
  if (!base) return path;
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  if (path === base || path.startsWith(`${base}/`)) return path;
  return `${base}${path}`;
}
