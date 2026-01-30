import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide dev indicator toolbar (errors still show)
  devIndicators: false,

  // Enable standalone output for Electron builds
  // This creates a minimal server that can run without node_modules
  output: "standalone",

  // Enable Turbopack (Next.js 16 default)
  turbopack: {},

  // Webpack configuration for Electron compatibility
  webpack: (config, { isServer }) => {
    // Handle native modules in Electron
    if (isServer) {
      config.externals = config.externals || [];
      // These modules are handled by Electron main process
      config.externals.push({
        "@cdktf/node-pty-prebuilt-multiarch": "commonjs @cdktf/node-pty-prebuilt-multiarch",
      });
    }

    return config;
  },
};

export default nextConfig;
