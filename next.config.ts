import type { NextConfig } from "next";

const remoteHost = process.env.NEXT_PUBLIC_REMOTE_HOST
  ?.replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

const nextConfig: NextConfig = {
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

  // Expose the graph feature flag to the client bundle so the System → Graph
  // sub-mode can gate its tab/render via isGraphEnabled() (one predicate,
  // src/lib/graph/config.ts). Unset => inlined as undefined => flag off.
  env: {
    HILT_GRAPH_ENABLED: process.env.HILT_GRAPH_ENABLED,
  },

  allowedDevOrigins: remoteHost ? [remoteHost] : [],
};

export default nextConfig;
