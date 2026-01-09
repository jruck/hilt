"use client";

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { recordScopeVisit } from '@/lib/recent-scopes';

const SCOPE_STORAGE_KEY = "hilt-scope";

interface ScopeContextValue {
  scopePath: string;
  setScopePath: (path: string) => void;
}

const ScopeContext = createContext<ScopeContextValue | null>(null);

export function ScopeProvider({
  children,
  initialScope = ""
}: {
  children: ReactNode;
  initialScope?: string;
}) {
  const [scopePath, setScopePathInternal] = useState(initialScope);

  const setScopePath = useCallback((path: string) => {
    setScopePathInternal(path);
    if (typeof window !== "undefined") {
      localStorage.setItem(SCOPE_STORAGE_KEY, path);
      recordScopeVisit(path);
      // Update URL without triggering Next.js navigation - pure history API
      window.history.pushState({ scope: path }, "", path || "/");
    }
  }, []);

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      // Get scope from state or parse from URL
      const newScope = event.state?.scope ?? window.location.pathname;
      setScopePathInternal(newScope);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Initialize history state on mount if not already set
  useEffect(() => {
    if (typeof window !== "undefined" && !window.history.state?.scope) {
      window.history.replaceState({ scope: scopePath }, "", window.location.pathname);
    }
  }, []);

  return (
    <ScopeContext.Provider value={{ scopePath, setScopePath }}>
      {children}
    </ScopeContext.Provider>
  );
}

export function useScope() {
  const context = useContext(ScopeContext);
  if (!context) {
    throw new Error("useScope must be used within ScopeProvider");
  }
  return context;
}
