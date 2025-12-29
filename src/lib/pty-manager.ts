import * as pty from "@cdktf/node-pty-prebuilt-multiarch";
import { EventEmitter } from "events";
import * as fs from "fs";

export interface TerminalSession {
  id: string;
  sessionId: string;
  pty: pty.IPty;
  projectPath: string;
}

class PtyManager extends EventEmitter {
  private terminals: Map<string, TerminalSession> = new Map();

  /**
   * Spawn a new terminal for a Claude Code session
   */
  spawn(
    terminalId: string,
    sessionId: string,
    projectPath: string,
    isNew?: boolean,
    initialPrompt?: string
  ): TerminalSession {
    // Kill existing terminal with same ID if exists
    if (this.terminals.has(terminalId)) {
      this.kill(terminalId);
    }

    // Validate and fallback cwd if directory doesn't exist
    let cwd = projectPath || process.env.HOME || "/";
    try {
      if (!fs.existsSync(cwd)) {
        console.log(`Directory ${cwd} doesn't exist, falling back to HOME`);
        cwd = process.env.HOME || "/";
      }
    } catch {
      cwd = process.env.HOME || "/";
    }

    console.log(`Spawning terminal ${terminalId} for session ${sessionId} in ${cwd}`);

    const shell = process.env.SHELL || "/bin/zsh";

    const ptyProcess = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        FORCE_COLOR: "3",
      } as { [key: string]: string },
    });

    const session: TerminalSession = {
      id: terminalId,
      sessionId,
      pty: ptyProcess,
      projectPath,
    };

    this.terminals.set(terminalId, session);

    // Track if we've sent the initial prompt (for new sessions)
    let promptSent = false;
    let watchingForReady = false;
    let outputBuffer = "";

    // Handle data output
    ptyProcess.onData((data: string) => {
      this.emit("data", terminalId, data);

      // For new sessions with initial prompt, watch for Claude Code ready state
      // Only start watching after we've given Claude time to start
      if (isNew && initialPrompt && !promptSent && watchingForReady) {
        outputBuffer += data;

        // Claude Code is ready when we see specific patterns in its output:
        // 1. The welcome box with "Claude Code" text
        // 2. Box-drawing characters (╭, ╰, │)
        // 3. The > prompt at the end
        const hasClaudeCode = outputBuffer.includes("Claude") || outputBuffer.includes("claude");
        const hasBoxChars = outputBuffer.includes("╭") || outputBuffer.includes("╰") || outputBuffer.includes("│");
        const hasPromptChar = outputBuffer.includes(">") && outputBuffer.length > 100;

        // Ready when we have Claude-specific content and enough output
        const isReady = (hasClaudeCode && hasBoxChars) ||
                        (hasPromptChar && outputBuffer.length > 300) ||
                        outputBuffer.includes("Press Enter");

        if (isReady) {
          console.log(`Claude Code ready! (buffer: ${outputBuffer.length} chars, hasClaudeCode: ${hasClaudeCode}, hasBoxChars: ${hasBoxChars})`);
          promptSent = true;
          // Small delay to ensure Claude has fully initialized its input handler
          setTimeout(() => {
            // Send prompt, then Enter key to submit
            ptyProcess.write(initialPrompt);
            setTimeout(() => {
              ptyProcess.write("\r");
            }, 100);
          }, 200);
        }
      }
    });

    // Handle process exit
    ptyProcess.onExit(({ exitCode }) => {
      console.log(`Terminal ${terminalId} exited with code ${exitCode}`);
      this.emit("exit", terminalId, exitCode);
      this.terminals.delete(terminalId);
    });

    // Send the claude command after shell initializes
    setTimeout(() => {
      if (isNew && initialPrompt) {
        console.log(`Starting new claude session with prompt`);
        ptyProcess.write(`claude\r`);

        // Start watching for ready state after Claude has had time to start
        // This delay ensures we don't match shell prompt characters
        setTimeout(() => {
          console.log(`Now watching for Claude Code ready state`);
          outputBuffer = ""; // Clear any shell output that accumulated
          watchingForReady = true;
        }, 1500);

        // Fallback: if Claude doesn't show ready indicator after 10 seconds, send anyway
        setTimeout(() => {
          if (!promptSent) {
            console.log(`Fallback: sending prompt after timeout`);
            promptSent = true;
            ptyProcess.write(initialPrompt);
            setTimeout(() => {
              ptyProcess.write("\r");
            }, 100);
          }
        }, 10000);
      } else {
        console.log(`Sending claude resume command for session ${sessionId}`);
        ptyProcess.write(`claude --resume ${sessionId}\r`);
      }
    }, 200);

    return session;
  }

  /**
   * Write data to a terminal
   */
  write(terminalId: string, data: string): boolean {
    const session = this.terminals.get(terminalId);
    if (!session) {
      console.log(`Cannot write to terminal ${terminalId} - not found`);
      return false;
    }
    try {
      session.pty.write(data);
      return true;
    } catch (err) {
      console.error(`Error writing to terminal ${terminalId}:`, err);
      return false;
    }
  }

  /**
   * Resize a terminal
   */
  resize(terminalId: string, cols: number, rows: number): boolean {
    const session = this.terminals.get(terminalId);
    if (!session) return false;
    try {
      session.pty.resize(cols, rows);
      return true;
    } catch (err) {
      console.error(`Error resizing terminal ${terminalId}:`, err);
      return false;
    }
  }

  /**
   * Kill a terminal
   */
  kill(terminalId: string): boolean {
    const session = this.terminals.get(terminalId);
    if (!session) return false;

    console.log(`Killing terminal ${terminalId}`);

    try {
      session.pty.kill();
    } catch (err) {
      console.error(`Error killing terminal ${terminalId}:`, err);
    }

    this.terminals.delete(terminalId);
    return true;
  }

  /**
   * Get a terminal session
   */
  get(terminalId: string): TerminalSession | undefined {
    return this.terminals.get(terminalId);
  }

  /**
   * Get all active terminals
   */
  getAll(): TerminalSession[] {
    return Array.from(this.terminals.values());
  }

  /**
   * Check if a terminal exists
   */
  has(terminalId: string): boolean {
    return this.terminals.has(terminalId);
  }
}

// Singleton instance
export const ptyManager = new PtyManager();
