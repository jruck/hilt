"use client";

import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "claude-kanban-sidebar-collapsed";

/**
 * Hook for sidebar collapsed/expanded state with localStorage persistence
 * Default: expanded (open)
 */
export function useSidebarState() {
  // Start with default value (expanded) to match server render
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  // Hydrate from localStorage after mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "true") {
        setIsCollapsed(true);
      }
    } catch {
      // Silently fail if localStorage is unavailable
    }
    setIsHydrated(true);
  }, []);

  // Persist state changes to localStorage
  const setCollapsed = useCallback((collapsed: boolean) => {
    setIsCollapsed(collapsed);
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {
      // Silently fail if localStorage is unavailable
    }
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
