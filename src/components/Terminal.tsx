"use client";

import { useEffect, useRef, useCallback } from "react";
import { Terminal as XTerm, ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useTheme } from "@/hooks/useTheme";
import * as tauri from "@/lib/tauri";
import "@xterm/xterm/css/xterm.css";

// Terminal color themes
const darkTerminalTheme: ITheme = {
  background: "#0a0a0a",
  foreground: "#fafafa",
  cursor: "#fafafa",
  cursorAccent: "#0a0a0a",
  selectionBackground: "#3f3f46",
  black: "#18181b",
  red: "#ef4444",
  green: "#22c55e",
  yellow: "#eab308",
  blue: "#3b82f6",
  magenta: "#a855f7",
  cyan: "#06b6d4",
  white: "#fafafa",
  brightBlack: "#52525b",
  brightRed: "#f87171",
  brightGreen: "#4ade80",
  brightYellow: "#facc15",
  brightBlue: "#60a5fa",
  brightMagenta: "#c084fc",
  brightCyan: "#22d3ee",
  brightWhite: "#ffffff",
};

const lightTerminalTheme: ITheme = {
  background: "#ffffff",
  foreground: "#1f2937",
  cursor: "#1f2937",
  cursorAccent: "#ffffff",
  selectionBackground: "#bfdbfe",
  black: "#1f2937",
  red: "#dc2626",
  green: "#16a34a",
  yellow: "#ca8a04",
  blue: "#2563eb",
  magenta: "#9333ea",
  cyan: "#0891b2",
  white: "#f3f4f6",
  brightBlack: "#6b7280",
  brightRed: "#ef4444",
  brightGreen: "#22c55e",
  brightYellow: "#eab308",
  brightBlue: "#3b82f6",
  brightMagenta: "#a855f7",
  brightCyan: "#06b6d4",
  brightWhite: "#ffffff",
};

interface PlanEvent {
  event: "created" | "updated";
  slug: string;
  path: string;
  content: string;
}

interface TerminalProps {
  terminalId: string;
  sessionId: string;
  projectPath?: string;
  isNew?: boolean;
  initialPrompt?: string;
  isActive?: boolean;  // Whether this terminal tab is currently selected
  isDrawerOpen?: boolean;  // Whether the drawer containing this terminal is open
  onExit?: (exitCode: number) => void;
  onTitleChange?: (sessionId: string, title: string) => void;
  onContextProgress?: (sessionId: string, progress: number) => void;
  onPlanEvent?: (plan: PlanEvent) => void;
}

export function Terminal({ terminalId, sessionId, projectPath, isNew, initialPrompt, isActive = true, isDrawerOpen = true, onExit, onTitleChange, onContextProgress, onPlanEvent }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const spawnedRef = useRef(false);
  const { resolvedTheme } = useTheme();

  // Refs for values accessed in callbacks - updated via effects to avoid render-time mutations
  const isActiveRef = useRef(isActive);
  const isDrawerOpenRef = useRef(isDrawerOpen);
  const sessionIdRef = useRef(sessionId);
  const isNewRef = useRef(isNew);
  const initialPromptRef = useRef(initialPrompt);
  const onExitRef = useRef(onExit);
  const onTitleChangeRef = useRef(onTitleChange);
  const onContextProgressRef = useRef(onContextProgress);
  const onPlanEventRef = useRef(onPlanEvent);

  // Sync refs with props - must be in effect, not during render
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);
  useEffect(() => { isDrawerOpenRef.current = isDrawerOpen; }, [isDrawerOpen]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { onExitRef.current = onExit; }, [onExit]);
  useEffect(() => { onTitleChangeRef.current = onTitleChange; }, [onTitleChange]);
  useEffect(() => { onContextProgressRef.current = onContextProgress; }, [onContextProgress]);
  useEffect(() => { onPlanEventRef.current = onPlanEvent; }, [onPlanEvent]);

  const sendData = useCallback(async (data: string) => {
    try {
      await tauri.writeTerminal(terminalId, data);
    } catch (err) {
      console.error("Failed to write to terminal:", err);
    }
  }, [terminalId]);

  const sendResize = useCallback(async (cols: number, rows: number) => {
    try {
      await tauri.resizeTerminal(terminalId, cols, rows);
    } catch (err) {
      console.error("Failed to resize terminal:", err);
    }
  }, [terminalId]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Create terminal with theme-appropriate colors
    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"Fira Code", "Cascadia Code", Menlo, Monaco, monospace',
      theme: resolvedTheme === "dark" ? darkTerminalTheme : lightTerminalTheme,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(containerRef.current);

    // Delay fit to ensure container has dimensions
    setTimeout(() => {
      try {
        fitAddon.fit();
      } catch {
        // Ignore fit errors on initial render
      }
    }, 50);

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Set up Tauri event listeners
    const unlisteners: Array<() => void> = [];

    // Listen for PTY data
    tauri.onPtyData((event) => {
      if (event.terminalId === terminalId) {
        term.write(event.data);
      }
    }).then(fn => unlisteners.push(fn));

    // Listen for PTY exit
    tauri.onPtyExit((event) => {
      if (event.terminalId === terminalId) {
        term.write(`\r\n\x1b[33m[Process exited with code ${event.exitCode}]\x1b[0m\r\n`);
        onExitRef.current?.(event.exitCode);
      }
    }).then(fn => unlisteners.push(fn));

    // Listen for title changes
    tauri.onPtyTitle((event) => {
      if (event.terminalId === terminalId) {
        onTitleChangeRef.current?.(sessionIdRef.current, event.title);
      }
    }).then(fn => unlisteners.push(fn));

    // Listen for context progress
    tauri.onPtyContext((event) => {
      if (event.terminalId === terminalId) {
        onContextProgressRef.current?.(sessionIdRef.current, event.progress);
      }
    }).then(fn => unlisteners.push(fn));

    // Listen for plan changes
    tauri.onPlanChanged((event) => {
      if (event.event !== "removed") {
        onPlanEventRef.current?.({
          event: event.event as "created" | "updated",
          slug: event.slug,
          path: event.path,
          content: event.content || "",
        });
      }
    }).then(fn => unlisteners.push(fn));

    // Listen for spawn confirmation
    tauri.onPtySpawned((event) => {
      if (event.terminalId === terminalId) {
        // Send initial size
        sendResize(term.cols, term.rows);
      }
    }).then(fn => unlisteners.push(fn));

    // Spawn the terminal
    if (!spawnedRef.current) {
      tauri.spawnTerminal(
        terminalId,
        sessionIdRef.current,
        projectPath || "",
        isNewRef.current || false,
        initialPromptRef.current
      ).then(() => {
        spawnedRef.current = true;
      }).catch((err) => {
        term.write(`\r\n\x1b[31mError: ${err}\x1b[0m\r\n`);
      });
    }

    // Handle terminal input
    term.onData((data) => {
      sendData(data);
    });

    // Handle resize - skip when terminal is hidden to prevent scroll jumps
    const handleResize = () => {
      // Don't fit if terminal is not active or drawer is closed
      if (!isActiveRef.current || !isDrawerOpenRef.current) return;

      try {
        fitAddon.fit();
        sendResize(term.cols, term.rows);
      } catch {
        // Ignore fit errors during resize
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    // Cleanup
    return () => {
      resizeObserver.disconnect();
      // Kill the terminal process
      tauri.killTerminal(terminalId).catch(() => {
        // Ignore errors on cleanup
      });
      // Clean up event listeners
      for (const unlisten of unlisteners) {
        unlisten();
      }
      term.dispose();
      spawnedRef.current = false;
    };
  // Note: sessionId, isNew, initialPrompt intentionally excluded - using refs to avoid effect re-runs
  // - sessionId can change from temp ID to real UUID when the session is created
  // - isNew changes from true to false when the real session is matched
  // - initialPrompt is only used once at spawn time
  // We don't want any of these changes to recreate the terminal
  }, [terminalId, projectPath, sendData, sendResize, resolvedTheme]);

  // Auto-focus terminal and scroll to bottom when it becomes visible
  useEffect(() => {
    if (isActive && isDrawerOpen && terminalRef.current && fitAddonRef.current) {
      // Small delay to ensure DOM is ready after visibility change
      setTimeout(() => {
        try {
          // Re-fit the terminal to its container
          fitAddonRef.current?.fit();
          // Scroll to the bottom
          terminalRef.current?.scrollToBottom();
          // Focus the terminal
          terminalRef.current?.focus();
        } catch {
          // Ignore errors during reactivation
        }
      }, 50);
    }
  }, [isActive, isDrawerOpen]);

  // Update terminal theme when app theme changes
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = resolvedTheme === "dark" ? darkTerminalTheme : lightTerminalTheme;
    }
  }, [resolvedTheme]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ minHeight: "300px" }}
    />
  );
}
