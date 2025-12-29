import { WebSocketServer, WebSocket } from "ws";
import { ptyManager } from "../src/lib/pty-manager";
import { getSessionById } from "../src/lib/claude-sessions";

const PORT = parseInt(process.env.WS_PORT || "3001", 10);

interface WSMessage {
  type: "spawn" | "data" | "resize" | "kill";
  terminalId?: string;
  sessionId?: string;
  projectPath?: string;
  isNew?: boolean;
  initialPrompt?: string;
  data?: string;
  cols?: number;
  rows?: number;
}

const wss = new WebSocketServer({ port: PORT });

// Track which WebSocket is connected to which terminal
const wsToTerminal = new Map<WebSocket, string>();
const terminalToWs = new Map<string, Set<WebSocket>>();
// Track last known title per terminal
const terminalTitles = new Map<string, string>();

/**
 * Parse OSC sequences to extract terminal title changes
 */
function extractTitle(data: string): string | null {
  const oscRegex = /\x1b\]([012]);([^\x07\x1b]*?)(?:\x07|\x1b\\)/g;
  let lastTitle: string | null = null;
  let match;

  while ((match = oscRegex.exec(data)) !== null) {
    const code = match[1];
    const title = match[2].trim();
    if ((code === "0" || code === "2") && isClaudeStatusTitle(title)) {
      lastTitle = title;
    }
  }

  return lastTitle;
}

/**
 * Check if a title looks like a Claude Code status (not a shell command)
 */
function isClaudeStatusTitle(title: string): boolean {
  if (!title || title.length === 0) return false;
  if (title.startsWith("claude")) return false;
  if (title.startsWith("zsh")) return false;
  if (title.startsWith("bash")) return false;
  if (title.startsWith("/")) return false;
  if (title.startsWith("~")) return false;
  if (title.includes("--")) return false;
  if (/^[a-f0-9-]{20,}$/i.test(title)) return false;
  if (title.includes(" ") && title.length < 100) return true;
  if (title.length < 30 && /^[a-z][a-z\s]+$/i.test(title)) return true;
  return false;
}

console.log(`WebSocket server running on ws://localhost:${PORT}`);

wss.on("connection", (ws) => {
  console.log("Client connected");

  ws.on("message", async (message) => {
    try {
      const msg: WSMessage = JSON.parse(message.toString());

      switch (msg.type) {
        case "spawn": {
          if (!msg.terminalId || !msg.sessionId) {
            ws.send(
              JSON.stringify({ type: "error", message: "Missing terminalId or sessionId" })
            );
            return;
          }

          let projectPath = msg.projectPath;
          if (!projectPath && !msg.isNew) {
            const session = await getSessionById(msg.sessionId);
            projectPath = session?.projectPath || process.env.HOME || "/";
          }
          projectPath = projectPath || process.env.HOME || "/";

          ptyManager.spawn(msg.terminalId, msg.sessionId, projectPath, msg.isNew, msg.initialPrompt);

          wsToTerminal.set(ws, msg.terminalId);
          if (!terminalToWs.has(msg.terminalId)) {
            terminalToWs.set(msg.terminalId, new Set());
          }
          terminalToWs.get(msg.terminalId)!.add(ws);

          ws.send(JSON.stringify({ type: "spawned", terminalId: msg.terminalId }));
          break;
        }

        case "data": {
          if (!msg.terminalId || msg.data === undefined) return;
          ptyManager.write(msg.terminalId, msg.data);
          break;
        }

        case "resize": {
          if (!msg.terminalId || !msg.cols || !msg.rows) return;
          ptyManager.resize(msg.terminalId, msg.cols, msg.rows);
          break;
        }

        case "kill": {
          if (!msg.terminalId) return;
          ptyManager.kill(msg.terminalId);
          ws.send(JSON.stringify({ type: "killed", terminalId: msg.terminalId }));
          break;
        }
      }
    } catch (err) {
      console.error("Error processing message:", err);
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
    const terminalId = wsToTerminal.get(ws);
    if (terminalId) {
      wsToTerminal.delete(ws);
      const wsSet = terminalToWs.get(terminalId);
      if (wsSet) {
        wsSet.delete(ws);
        if (wsSet.size === 0) {
          ptyManager.kill(terminalId);
          terminalToWs.delete(terminalId);
        }
      }
    }
  });
});

// Forward PTY data to connected WebSockets
ptyManager.on("data", (terminalId: string, data: string) => {
  const wsSet = terminalToWs.get(terminalId);
  if (!wsSet) return;

  // Check for title changes and forward to clients
  const newTitle = extractTitle(data);
  if (newTitle && newTitle !== terminalTitles.get(terminalId)) {
    terminalTitles.set(terminalId, newTitle);
    const titleMsg = JSON.stringify({ type: "title", terminalId, title: newTitle });
    wsSet.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(titleMsg);
      }
    });
  }

  // Forward the data
  const msg = JSON.stringify({ type: "data", terminalId, data });
  wsSet.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  });
});

// Forward PTY exit events
ptyManager.on("exit", (terminalId: string, exitCode: number) => {
  const wsSet = terminalToWs.get(terminalId);
  if (wsSet) {
    const msg = JSON.stringify({ type: "exit", terminalId, exitCode });
    wsSet.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    });
  }
  terminalToWs.delete(terminalId);
  terminalTitles.delete(terminalId);
});

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down WebSocket server...");
  ptyManager.getAll().forEach((session) => {
    ptyManager.kill(session.id);
  });
  wss.close(() => {
    process.exit(0);
  });
});
