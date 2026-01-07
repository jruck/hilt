import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export for Tauri
  output: "export",

  // Disable image optimization for static export
  images: {
    unoptimized: true,
  },

  // Ensure trailing slashes for static hosting
  trailingSlash: true,
};

export default nextConfig;
