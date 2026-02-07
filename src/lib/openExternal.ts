/**
 * Opens an external URL in a way that works well with PWA/Add to Home Screen.
 * On iOS standalone mode, this prevents the in-app Safari browser overlay.
 */
export function openExternal(url: string) {
  // Check if running as installed PWA (standalone mode)
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

  if (isStandalone) {
    // In PWA mode, use location.href to open in Safari proper
    // This exits the PWA but avoids the awkward in-app browser
    window.location.href = url;
  } else {
    // Normal browser: open in new tab
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
