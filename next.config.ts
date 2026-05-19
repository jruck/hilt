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

  // Enable Turbopack (Next.js 16 default)
  turbopack: {},

  // Keep native local-only modules out of the client/server bundle.
  serverExternalPackages: ["better-sqlite3"],

  allowedDevOrigins: remoteHost ? [remoteHost] : [],
};

export default nextConfig;
