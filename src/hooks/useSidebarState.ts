"use client";

import { useState, useCallback, useEffect, useRef } from "react";

/**
 * Hook for sidebar collapsed/expanded state with server-side persistence
 * Default: expanded (open)
 */
export function useSidebarState() {
  // Start with default value (expanded) to match server render
  const [isCollapsed, setIsCollapsedState] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const initialFetchDone = useRef(false);

  // Fetch initial state from server
  useEffect(() => {
    if (initialFetchDone.current) return;
    initialFetchDone.current = true;

    fetch("/api/preferences?key=sidebarCollapsed")
      .then((res) => res.json())
      .then((data) => {
        if (data.value !== undefined) {
          setIsCollapsedState(data.value);
        }
      })
      .catch(() => {
        // Silently fail if API is unavailable
      })
      .finally(() => {
        setIsHydrated(true);
      });
  }, []);

  // Persist state changes to server
  const setCollapsed = useCallback((collapsed: boolean) => {
    setIsCollapsedState(collapsed);
    fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "sidebarCollapsed", value: collapsed }),
    }).catch(() => {
      // Silently fail if API is unavailable
    });
  }, []);

  const toggle = useCallback(() => {
    setCollapsed(!isCollapsed);
  }, [isCollapsed, setCollapsed]);

  return {
    isCollapsed,
    setCollapsed,
    toggle,
    isHydrated,
  };
}
