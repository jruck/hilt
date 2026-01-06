"use client";

import { useState, useCallback } from "react";

const STORAGE_KEY = "claude-kanban-sidebar-collapsed";

// Helper to read from localStorage safely
function getStoredValue(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "true";
  } catch {
    return false;
  }
}

/**
 * Hook for sidebar collapsed/expanded state with localStorage persistence
 * Default: expanded (open)
 */
export function useSidebarState() {
  // Use lazy initializer to read from localStorage without setState in effect
  const [isCollapsed, setIsCollapsed] = useState(() => getStoredValue());
  // Client-side only - will be true after first render
  const [isHydrated] = useState(() => typeof window !== "undefined");

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
