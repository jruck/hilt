"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { recordScopeVisit } from '@/lib/recent-scopes';
import { buildViewUrl, parseViewUrl, ViewPrefix } from '@/lib/url-utils';

const SCOPE_STORAGE_KEY = "hilt-scope";

interface ScopeContextValue {
  scopePath: string;
  setScopePath: (path: string) => void;
  /** Current view mode from URL (null = legacy URL, needs resolution) */
  viewMode: ViewPrefix | null;
  /** Update view mode and push a new history entry */
  setViewMode: (mode: ViewPrefix) => void;
  /** Replace current URL with view prefix (no new history entry — for legacy URL migration) */
  replaceViewMode: (mode: ViewPrefix) => void;
  /** Atomically change both view mode and scope in a single history entry */
  navigateTo: (mode: ViewPrefix, scope: string) => void;
}

const ScopeContext = createContext<ScopeContextValue | null>(null);

export function ScopeProvider({
  children,
  initialScope = "",
  initialViewMode = null,
}: {
  children: ReactNode;
  initialScope?: string;
  initialViewMode?: ViewPrefix | null;
}) {
  const [scopePath, setScopePathInternal] = useState(initialScope);
  const [viewMode, setViewModeInternal] = useState<ViewPrefix | null>(initialViewMode);

  // Refs so callbacks always have the current value without deps
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const scopeRef = useRef(scopePath);
  scopeRef.current = scopePath;

  const setScopePath = useCallback((path: string) => {
    setScopePathInternal(path);
    if (typeof window !== "undefined") {
      localStorage.setItem(SCOPE_STORAGE_KEY, path);
      recordScopeVisit(path);
      const currentView = viewModeRef.current;
      if (currentView) {
        const url = buildViewUrl(currentView, path);
        window.history.pushState({ scope: path }, "", url);
      } else {
        // Legacy: no view prefix yet — just use path
        window.history.pushState({ scope: path }, "", path || "/");
      }
    }
  }, []);

  const setViewMode = useCallback((mode: ViewPrefix) => {
    setViewModeInternal(mode);
    viewModeRef.current = mode;
    if (typeof window !== "undefined") {
      const url = buildViewUrl(mode, scopeRef.current);
      window.history.pushState({ scope: scopeRef.current }, "", url);
    }
  }, []);

  const navigateTo = useCallback((mode: ViewPrefix, scope: string) => {
    setScopePathInternal(scope);
    scopeRef.current = scope;
    setViewModeInternal(mode);
    viewModeRef.current = mode;
    if (typeof window !== "undefined") {
      localStorage.setItem(SCOPE_STORAGE_KEY, scope);
      recordScopeVisit(scope);
      const url = buildViewUrl(mode, scope);
      window.history.pushState({ scope }, "", url);
    }
  }, []);

  const replaceViewMode = useCallback((mode: ViewPrefix) => {
    setViewModeInternal(mode);
    viewModeRef.current = mode;
    if (typeof window !== "undefined") {
      const url = buildViewUrl(mode, scopeRef.current);
      window.history.replaceState({ scope: scopeRef.current }, "", url);
    }
  }, []);

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      const segments = window.location.pathname.split("/").filter(Boolean);
      const { viewMode: v, scope: s } = parseViewUrl(segments);
      setScopePathInternal(s);
      scopeRef.current = s;
      if (v) {
        setViewModeInternal(v);
        viewModeRef.current = v;
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Initialize history state on mount if not already set
  useEffect(() => {
    if (typeof window !== "undefined" && !window.history.state?.scope) {
      if (viewMode) {
        const url = buildViewUrl(viewMode, scopePath);
        window.history.replaceState({ scope: scopePath }, "", url);
      } else {
        window.history.replaceState({ scope: scopePath }, "", window.location.pathname);
      }
    }
  }, []);

  return (
    <ScopeContext.Provider value={{ scopePath, setScopePath, viewMode, setViewMode, replaceViewMode, navigateTo }}>
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
