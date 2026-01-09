"use client";

import { useEffect, useRef, useCallback } from "react";
import { Terminal as XTerm, ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useTheme } from "@/hooks/useTheme";
import "@xterm/xterm/css/xterm.css";

// Import Electron types (available when running in Electron)
/// <reference path="../../electron/types.d.ts" />

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

interface RalphEvent {
  event: "iteration" | "complete";
  current?: number;
  max?: number;
  success?: boolean;
}

interface TerminalProps {
  terminalId: string;
  sessionId: string;
  projectPath?: string;
  wsUrl?: string;  // Optional - only used for WebSocket mode
  isNew?: boolean;
  initialPrompt?: string;
  isActive?: boolean;  // Whether this terminal tab is currently selected
  isDrawerOpen?: boolean;  // Whether the drawer containing this terminal is open
  onExit?: (exitCode: number) => void;
  onTitleChange?: (sessionId: string, title: string) => void;
  onContextProgress?: (sessionId: string, progress: number) => void;
  onPlanEvent?: (plan: PlanEvent) => void;
  onRalphEvent?: (sessionId: string, ralph: RalphEvent) => void;
}

/**
 * Detect if running in Electron environment
 */
function isElectron(): boolean {
  return typeof window !== "undefined" && window.electronAPI?.isElectron === true;
}

export function Terminal({ terminalId, sessionId, projectPath, wsUrl, isNew, initialPrompt, isActive = true, isDrawerOpen = true, onExit, onTitleChange, onContextProgress, onPlanEvent, onRalphEvent }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const spawnedRef = useRef(false);
  const cleanupFunctionsRef = useRef<(() => void)[]>([]);
  const intentionalCloseRef = useRef(false);  // Track if close was intentional (cleanup)
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
  const onRalphEventRef = useRef(onRalphEvent);

  // Sync refs with props - must be in effect, not during render
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);
  useEffect(() => { isDrawerOpenRef.current = isDrawerOpen; }, [isDrawerOpen]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { onExitRef.current = onExit; }, [onExit]);
  useEffect(() => { onTitleChangeRef.current = onTitleChange; }, [onTitleChange]);
  useEffect(() => { onContextProgressRef.current = onContextProgress; }, [onContextProgress]);
  useEffect(() => { onPlanEventRef.current = onPlanEvent; }, [onPlanEvent]);
  useEffect(() => { onRalphEventRef.current = onRalphEvent; }, [onRalphEvent]);

  // Send message function - works for both Electron IPC and WebSocket
  const sendMessage = useCallback((type: string, data: Record<string, unknown>) => {
    if (isElectron()) {
      // Electron IPC mode
      const api = window.electronAPI!.pty;
      switch (type) {
        case "data":
          api.write({ terminalId, data: data.data as string });
          break;
        case "resize":
          api.resize({ terminalId, cols: data.cols as number, rows: data.rows as number });
          break;
        case "kill":
          api.kill({ terminalId });
          break;
      }
    } else if (wsRef.current?.readyState === WebSocket.OPEN) {
      // WebSocket mode
      wsRef.current.send(JSON.stringify({ type, terminalId, ...data }));
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

    // Setup transport based on environment
    if (isElectron()) {
      // Electron IPC transport
      setupElectronTransport(term, fitAddon);
    } else {
      // WebSocket transport (browser mode)
      setupWebSocketTransport(term);
    }

    // Handle terminal input
    term.onData((data) => {
      sendMessage("data", { data });
    });

    // Handle resize - skip when terminal is hidden to prevent scroll jumps
    const handleResize = () => {
      // Don't fit if terminal is not active or drawer is closed
      if (!isActiveRef.current || !isDrawerOpenRef.current) return;

      try {
        fitAddon.fit();
        sendMessage("resize", { cols: term.cols, rows: term.rows });
      } catch {
        // Ignore fit errors during resize
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    // Cleanup
    return () => {
      resizeObserver.disconnect();
      // Clean up Electron IPC listeners
      cleanupFunctionsRef.current.forEach(cleanup => cleanup());
      cleanupFunctionsRef.current = [];
      // Clean up WebSocket - mark as intentional to prevent reconnection attempts
      intentionalCloseRef.current = true;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      term.dispose();
      spawnedRef.current = false;
    };
  // Note: sessionId, isNew, initialPrompt intentionally excluded - using refs to avoid effect re-runs
  // We don't want any of these changes to recreate the terminal
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId, projectPath, wsUrl, sendMessage]);

  /**
   * Setup Electron IPC transport
   */
  function setupElectronTransport(term: XTerm, fitAddon: FitAddon) {
    const api = window.electronAPI!.pty;

    // Setup event listeners
    const cleanupData = api.onData((event) => {
      if (event.terminalId === terminalId) {
        term.write(event.data);
      }
    });
    cleanupFunctionsRef.current.push(cleanupData);

    const cleanupExit = api.onExit((event) => {
      if (event.terminalId === terminalId) {
        term.write(`\r\n\x1b[33m[Process exited with code ${event.exitCode}]\x1b[0m\r\n`);
        onExitRef.current?.(event.exitCode);
      }
    });
    cleanupFunctionsRef.current.push(cleanupExit);

    const cleanupTitle = api.onTitle((event) => {
      if (event.terminalId === terminalId) {
        onTitleChangeRef.current?.(sessionIdRef.current, event.title);
      }
    });
    cleanupFunctionsRef.current.push(cleanupTitle);

    const cleanupContext = api.onContext((event) => {
      if (event.terminalId === terminalId) {
        onContextProgressRef.current?.(sessionIdRef.current, event.progress);
      }
    });
    cleanupFunctionsRef.current.push(cleanupContext);

    const cleanupPlan = api.onPlan((event) => {
      onPlanEventRef.current?.({
        event: event.event,
        slug: event.slug,
        path: event.path,
        content: event.content,
      });
    });
    cleanupFunctionsRef.current.push(cleanupPlan);

    // Spawn the terminal
    if (!spawnedRef.current) {
      api.spawn({
        terminalId,
        sessionId: sessionIdRef.current,
        projectPath,
        isNew: isNewRef.current,
        initialPrompt: initialPromptRef.current,
      }).then(() => {
        // Send initial size after spawn
        api.resize({ terminalId, cols: term.cols, rows: term.rows });
      });
      spawnedRef.current = true;
    }
  }

  /**
   * Setup WebSocket transport (for browser dev mode)
   */
  function setupWebSocketTransport(term: XTerm) {
    if (!wsUrl) {
      term.write("\r\n\x1b[31mNo WebSocket URL provided and not running in Electron.\x1b[0m\r\n");
      term.write("\x1b[90mRun: npm run ws-server\x1b[0m\r\n");
      return;
    }

    // Connect to WebSocket
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!spawnedRef.current) {
        // Spawn the terminal - use sessionIdRef for current value
        // (sessionId may have been updated from temp ID to real UUID)
        ws.send(
          JSON.stringify({
            type: "spawn",
            terminalId,
            sessionId: sessionIdRef.current,
            projectPath,
            isNew: isNewRef.current,
            initialPrompt: initialPromptRef.current,
          })
        );
        spawnedRef.current = true;
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "data":
            term.write(msg.data);
            break;
          case "exit":
            term.write(`\r\n\x1b[33m[Process exited with code ${msg.exitCode}]\x1b[0m\r\n`);
            onExitRef.current?.(msg.exitCode);
            break;
          case "spawned":
            // Send initial size
            ws.send(
              JSON.stringify({
                type: "resize",
                terminalId,
                cols: term.cols,
                rows: term.rows,
              })
            );
            break;
          case "error":
            term.write(`\r\n\x1b[31mError: ${msg.message}\x1b[0m\r\n`);
            break;
          case "title":
            onTitleChangeRef.current?.(sessionIdRef.current, msg.title);
            break;
          case "context":
            onContextProgressRef.current?.(sessionIdRef.current, msg.progress);
            break;
          case "plan":
            onPlanEventRef.current?.({
              event: msg.event,
              slug: msg.slug,
              path: msg.path,
              content: msg.content,
            });
            break;
          case "ralph":
            onRalphEventRef.current?.(sessionIdRef.current, {
              event: msg.event,
              current: msg.current,
              max: msg.max,
              success: msg.success,
            });
            break;
        }
      } catch (err) {
        console.error("Error parsing WS message:", err);
      }
    };

    ws.onerror = () => {
      term.write("\r\n\x1b[31mWebSocket connection error. Is the terminal server running?\x1b[0m\r\n");
      term.write("\x1b[90mRun: npm run ws-server\x1b[0m\r\n");
    };

    ws.onclose = () => {
      // Skip reconnection if this was an intentional close (component unmounting)
      if (intentionalCloseRef.current) {
        return;
      }
      term.write("\r\n\x1b[33m[Connection closed - attempting to reconnect...]\x1b[0m\r\n");
      // Attempt to reconnect with exponential backoff
      attemptReconnect(term, 1);
    };
  }

  /**
   * Attempt to reconnect to the WebSocket server with exponential backoff
   */
  function attemptReconnect(term: XTerm, attempt: number) {
    const MAX_ATTEMPTS = 5;
    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // 1s, 2s, 4s, 8s, 10s

    if (attempt > MAX_ATTEMPTS) {
      term.write("\r\n\x1b[31m[Failed to reconnect after 5 attempts]\x1b[0m\r\n");
      term.write("\x1b[90mCheck if the server is running: npm run ws-server\x1b[0m\r\n");
      return;
    }

    setTimeout(() => {
      if (!wsUrl) return;

      term.write(`\x1b[90m[Reconnect attempt ${attempt}/${MAX_ATTEMPTS}...]\x1b[0m\r\n`);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        term.write("\x1b[32m[Reconnected!]\x1b[0m\r\n");
        // Re-spawn the terminal (server may have restarted)
        spawnedRef.current = false;
        ws.send(
          JSON.stringify({
            type: "spawn",
            terminalId,
            sessionId: sessionIdRef.current,
            projectPath,
            isNew: false, // Always resume on reconnect
            initialPrompt: undefined,
          })
        );
        spawnedRef.current = true;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case "data":
              term.write(msg.data);
              break;
            case "exit":
              term.write(`\r\n\x1b[33m[Process exited with code ${msg.exitCode}]\x1b[0m\r\n`);
              onExitRef.current?.(msg.exitCode);
              break;
            case "spawned":
              ws.send(
                JSON.stringify({
                  type: "resize",
                  terminalId,
                  cols: term.cols,
                  rows: term.rows,
                })
              );
              break;
            case "error":
              term.write(`\r\n\x1b[31mError: ${msg.message}\x1b[0m\r\n`);
              break;
            case "title":
              onTitleChangeRef.current?.(sessionIdRef.current, msg.title);
              break;
            case "context":
              onContextProgressRef.current?.(sessionIdRef.current, msg.progress);
              break;
            case "plan":
              onPlanEventRef.current?.({
                event: msg.event,
                slug: msg.slug,
                path: msg.path,
                content: msg.content,
              });
              break;
            case "ralph":
              onRalphEventRef.current?.(sessionIdRef.current, {
                event: msg.event,
                current: msg.current,
                max: msg.max,
                success: msg.success,
              });
              break;
          }
        } catch (err) {
          console.error("Error parsing WS message:", err);
        }
      };

      ws.onerror = () => {
        // Will trigger onclose, which will retry
      };

      ws.onclose = () => {
        // Skip reconnection if intentionally closed
        if (intentionalCloseRef.current) {
          return;
        }
        // Try again with next attempt
        attemptReconnect(term, attempt + 1);
      };
    }, delay);
  }

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
