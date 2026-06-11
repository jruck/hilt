import type { NextConfig } from "next";

const remoteHost = process.env.NEXT_PUBLIC_REMOTE_HOST
  ?.replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

// Optional base path for gateway mode (Tailscale Serve /hilt -> :3000).
// Normalized to a leading slash with no trailing slash; unset => "" =>
// ordinary unprefixed dev. Keep this in sync with src/lib/base-path.ts.
const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const basePath =
  rawBasePath && rawBasePath !== "/"
    ? `/${rawBasePath.replace(/^\/+|\/+$/g, "")}`
    : "";

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),

  // Dev indicators render in DOM but hidden by CSS.
  // Revealed via double-Command dev mode toggle.

  // Enable standalone output for Electron builds
  // This creates a minimal server that can run without node_modules
  output: "standalone",

  // Allow an isolated build/dist directory (e.g. a parallel `next dev` for graph
  // visual iteration) so it never fights the live :3000 server over `.next`.
  // Unset => ".next" => live server unaffected.
  distDir: process.env.HILT_DIST_DIR || ".next",

  // Enable Turbopack (Next.js 16 default)
  turbopack: {},

  // Keep native local-only modules out of the client/server bundle.
  serverExternalPackages: ["better-sqlite3"],

  // Expose the graph feature flags to the client bundle so the System → Graph
  // sub-mode can gate its tab/render via isGraphEnabled() (one predicate,
  // src/lib/graph/config.ts) and the toolbar can gate the tag/semantic legend rows
  // via isGraphTagsEnabled()/graphSemanticOverlayEnabled(). Unset => inlined as
  // undefined => flag off.
  env: {
    HILT_GRAPH_ENABLED: process.env.HILT_GRAPH_ENABLED,
    HILT_GRAPH_TAGS: process.env.HILT_GRAPH_TAGS,
    HILT_GRAPH_SEMANTIC: process.env.HILT_GRAPH_SEMANTIC,
    // Inline the normalized base path so src/lib/base-path.ts and the
    // ws bootstrap in useEventSocket see a canonical value.
    NEXT_PUBLIC_BASE_PATH: basePath,
  },

  allowedDevOrigins: remoteHost ? [remoteHost] : [],
};

export default nextConfig;
