'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

const STORAGE_KEY = 'claude-kanban-theme';

// Get the stored theme from localStorage
function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light' || stored === 'system') {
    return stored;
  }
  return 'system';
}

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

function setTheme(theme: Theme) {
  currentTheme = theme;
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, theme);
    applyTheme(resolveTheme(theme));
  }
  listeners.forEach(listener => listener());
}

// Initialize on first load
if (typeof window !== 'undefined') {
  currentTheme = getStoredTheme();
  applyTheme(resolveTheme(currentTheme));

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
    setTheme(newTheme);
  }, []);

  return {
    theme,
    resolvedTheme,
    setTheme: setThemeCallback,
  };
}
