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

const distDir = process.env.HILT_DIST_DIR || ".next";
const standaloneBuild =
  process.env.HILT_STANDALONE_BUILD === "1" ||
  process.env.HILT_STANDALONE_BUILD === "true";

const generatedBuildDirs = [
  ".next",
  ".next-prod",
  ".next-gateway",
  ".next-devtest",
  ".next-prod-test",
  ".next-graph-dev",
  ".next-graph-live",
];

const traceExcludes = generatedBuildDirs.flatMap((dir) =>
  dir === distDir
    ? [`./${dir}/standalone/**/*`, `./${dir}/dev/cache/**/*`, `./${dir}/cache/**/*`]
    : [`./${dir}/**/*`]
);

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),

  // Dev indicators render in DOM but hidden by CSS.
  // Revealed via double-Command dev mode toggle.

  // Standalone output is only for rare distribution-style builds. The daily
  // source-launcher app serves a normal production build from .next-prod.
  ...(standaloneBuild
    ? {
        output: "standalone" as const,
        outputFileTracingExcludes: {
          "/*": [
            ...traceExcludes,
            "./dist/**/*",
            "./release/**/*",
            "./data/**/*",
            "./docs/demo/.hilt-data/**/*",
            "./worktrees/**/*",
            "./worktree-*/*",
            "./.git/**/*",
            "./.claude/**/*",
            "./.obsidian/**/*",
          ],
        },
      }
    : {}),

  // Allow an isolated build/dist directory (e.g. a parallel `next dev` for graph
  // visual iteration) so it never fights the live :3000 server over `.next`.
  // Unset => ".next" => live server unaffected.
  distDir,

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
