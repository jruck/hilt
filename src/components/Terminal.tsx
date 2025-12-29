"use client";

import { useEffect, useRef, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  terminalId: string;
  sessionId: string;
  projectPath?: string;
  wsUrl: string;
  isNew?: boolean;
  initialPrompt?: string;
  isActive?: boolean;  // Whether this terminal is currently visible
  onExit?: (exitCode: number) => void;
  onTitleChange?: (sessionId: string, title: string) => void;
}

export function Terminal({ terminalId, sessionId, projectPath, wsUrl, isNew, initialPrompt, isActive = true, onExit, onTitleChange }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const spawnedRef = useRef(false);
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  // Use refs for callbacks to avoid re-running effect when they change
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onTitleChangeRef = useRef(onTitleChange);
  onTitleChangeRef.current = onTitleChange;

  const sendMessage = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    // Create terminal
    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"Fira Code", "Cascadia Code", Menlo, Monaco, monospace',
      theme: {
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
      },
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

    // Connect to WebSocket
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!spawnedRef.current) {
        // Spawn the terminal
        ws.send(
          JSON.stringify({
            type: "spawn",
            terminalId,
            sessionId,
            projectPath,
            isNew,
            initialPrompt,
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
            onTitleChangeRef.current?.(sessionId, msg.title);
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
      term.write("\r\n\x1b[33m[Connection closed]\x1b[0m\r\n");
    };

    // Handle terminal input
    term.onData((data) => {
      sendMessage({ type: "data", terminalId, data });
    });

    // Handle resize - skip when terminal is hidden to prevent scroll jumps
    const handleResize = () => {
      // Don't fit if terminal is not active (hidden via CSS)
      if (!isActiveRef.current) return;

      try {
        fitAddon.fit();
        sendMessage({
          type: "resize",
          terminalId,
          cols: term.cols,
          rows: term.rows,
        });
      } catch {
        // Ignore fit errors during resize
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    // Cleanup
    return () => {
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
      spawnedRef.current = false;
    };
  // Note: onExit intentionally excluded - using ref to avoid effect re-runs
  }, [terminalId, sessionId, projectPath, wsUrl, isNew, initialPrompt, sendMessage]);

  // Auto-focus terminal when it becomes active
  useEffect(() => {
    if (isActive && terminalRef.current) {
      // Small delay to ensure DOM is ready after visibility change
      setTimeout(() => {
        terminalRef.current?.focus();
      }, 50);
    }
  }, [isActive]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ minHeight: "300px" }}
    />
  );
}
