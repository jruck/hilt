"use client";

import { useState, useEffect } from "react";

/**
 * Double-tap Command key to toggle dev mode.
 * Reveals dev tools like Agentation and Next.js dev indicator.
 */
export function useDevMode(): boolean {
  const [devMode, setDevMode] = useState(false);

  useEffect(() => {
    let lastMetaUp = 0;

    function handleKeyUp(e: KeyboardEvent) {
      if (e.key !== "Meta") return;

      const now = Date.now();
      if (now - lastMetaUp < 400) {
        setDevMode((prev) => !prev);
        lastMetaUp = 0;
      } else {
        lastMetaUp = now;
      }
    }

    // Reset timer if any non-Meta key is pressed between taps
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Meta") {
        lastMetaUp = 0;
      }
    }

    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return devMode;
}
