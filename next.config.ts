import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide dev indicator toolbar (errors still show)
  devIndicators: false,

  // Enable standalone output for Electron builds
  // This creates a minimal server that can run without node_modules
  output: "standalone",

  // Enable Turbopack (Next.js 16 default)
  turbopack: {},

};

export default nextConfig;
