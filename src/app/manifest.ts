import type { MetadataRoute } from "next";
import { getBasePath, withBasePath } from "@/lib/base-path";

// Replaces the static public/manifest.json so the PWA start_url/scope and
// icon URLs follow NEXT_PUBLIC_BASE_PATH (e.g. /hilt behind the Tailscale
// Serve gateway). Next serves this at ${basePath}/manifest.webmanifest and
// injects the <link rel="manifest"> automatically.
export default function manifest(): MetadataRoute.Manifest {
  const base = getBasePath();
  return {
    name: "Hilt",
    short_name: "Hilt",
    description: "Bridge, Docs, and Stack for your projects",
    start_url: `${base}/`,
    scope: `${base}/`,
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      {
        src: withBasePath("/apple-touch-icon.png"),
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
