'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

// Get the system preference
function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Resolve the actual theme (dark or light) from the setting
function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === 'system') {
    return getSystemTheme();
  }
  return theme;
}

// Apply theme class to document
function applyTheme(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.remove('dark', 'light');
  root.classList.add(resolved);
}

// Store for external sync
let currentTheme: Theme = 'system';
let serverFetchDone = false;
const listeners: Set<() => void> = new Set();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Theme {
  return currentTheme;
}

function getServerSnapshot(): Theme {
  return 'system';
}

function setThemeInternal(theme: Theme, persist: boolean = true) {
  currentTheme = theme;
  if (typeof window !== 'undefined') {
    applyTheme(resolveTheme(theme));

    if (persist) {
      // Persist to server
      fetch('/api/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'theme', value: theme }),
      }).catch(() => {
        // Silently fail if API is unavailable
      });
    }
  }
  listeners.forEach(listener => listener());
}

// Initialize on first load - fetch from server
if (typeof window !== 'undefined') {
  // Apply system theme immediately to avoid flash
  applyTheme(resolveTheme('system'));

  // Fetch persisted theme from server
  if (!serverFetchDone) {
    serverFetchDone = true;
    fetch('/api/preferences?key=theme')
      .then(res => res.json())
      .then(data => {
        if (data.value && (data.value === 'dark' || data.value === 'light' || data.value === 'system')) {
          setThemeInternal(data.value, false); // Don't persist back to server
        }
      })
      .catch(() => {
        // Silently fail if API is unavailable
      });
  }

  // Listen for system preference changes
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', () => {
    if (currentTheme === 'system') {
      applyTheme(resolveTheme('system'));
      listeners.forEach(listener => listener());
    }
  });
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const resolvedTheme = resolveTheme(theme);

  // Ensure theme is applied on mount (handles hydration)
  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  const setThemeCallback = useCallback((newTheme: Theme) => {
    setThemeInternal(newTheme, true);
  }, []);

  return {
    theme,
    resolvedTheme,
    setTheme: setThemeCallback,
  };
}
