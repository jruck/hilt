import { SidecarConfig, SidecarState } from "./chat-types";
import { spawn, ChildProcess } from "child_process";
import http from "http";

const DEFAULT_PORT = 8765;
const HEALTH_CHECK_TIMEOUT_MS = 10_000;
const HEALTH_CHECK_INTERVAL_MS = 500;
const GRACEFUL_SHUTDOWN_MS = 3_000;
const MAX_RESTART_COUNT = 3;

export class PipecatSidecar extends EventTarget {
  private config: SidecarConfig;
  private process: ChildProcess | null = null;
  private _state: SidecarState = "stopped";
  private _port: number;
  private restartCount = 0;
  private intentionallyStopped = false;
  private stdoutLog: string[] = [];
  private stderrLog: string[] = [];
  private healthCheckTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: SidecarConfig) {
    super();
    this.config = config;
    this._port = config.port ?? DEFAULT_PORT;
  }

  get state(): SidecarState {
    return this._state;
  }

  get port(): number {
    return this._port;
  }

  get logs(): { stdout: string[]; stderr: string[] } {
    return { stdout: [...this.stdoutLog], stderr: [...this.stderrLog] };
  }

  async start(): Promise<void> {
    if (this._state === "running" || this._state === "starting") {
      return;
    }

    this.intentionallyStopped = false;
    this.setState("starting");

    try {
      this.spawnProcess();
      await this.waitForHealthy();
      this.setState("running");
    } catch (err) {
      console.error("[PipecatSidecar] Failed to start:", err);
      this.killProcess();
      this.setState("error");
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.intentionallyStopped = true;
    this.clearHealthCheck();

    if (!this.process) {
      this.setState("stopped");
      return;
    }

    await this.gracefulShutdown();
    this.setState("stopped");
  }

  async restart(): Promise<void> {
    await this.stop();
    this.restartCount = 0;
    await this.start();
  }

  private setState(state: SidecarState): void {
    if (this._state === state) return;
    this._state = state;
    this.dispatchEvent(
      new CustomEvent("state-change", { detail: state })
    );
  }

  private spawnProcess(): void {
    const pythonPath = this.config.pythonPath ?? "python3";
    const args = [
      "-m", "uvicorn",
      "main:app",
      "--host", "127.0.0.1",
      "--port", String(this._port),
    ];

    console.log(`[PipecatSidecar] Spawning: ${pythonPath} ${args.join(" ")}`);
    console.log(`[PipecatSidecar] CWD: ${this.config.projectPath}`);

    this.process = spawn(pythonPath, args, {
      cwd: this.config.projectPath,
      env: {
        ...process.env,
        OPENCLAW_GATEWAY_URL: this.config.gatewayUrl,
        OPENCLAW_GATEWAY_TOKEN: this.config.gatewayToken,
        OPENCLAW_SESSION_KEY: this.config.sessionKey,
        PORT: String(this._port),
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      const line = data.toString().trim();
      if (line) {
        this.stdoutLog.push(line);
        // Keep log buffer bounded
        if (this.stdoutLog.length > 500) this.stdoutLog.shift();
        console.log("[PipecatSidecar stdout]", line);
      }
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      const line = data.toString().trim();
      if (line) {
        this.stderrLog.push(line);
        if (this.stderrLog.length > 500) this.stderrLog.shift();
        console.error("[PipecatSidecar stderr]", line);
      }
    });

    this.process.on("error", (err) => {
      console.error("[PipecatSidecar] Process error:", err);
      this.process = null;
      if (!this.intentionallyStopped) {
        this.handleCrash();
      }
    });

    this.process.on("close", (code) => {
      console.log(`[PipecatSidecar] Process exited with code ${code}`);
      this.process = null;
      if (!this.intentionallyStopped && this._state === "running") {
        this.handleCrash();
      }
    });
  }

  private async waitForHealthy(): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < HEALTH_CHECK_TIMEOUT_MS) {
      if (await this.checkHealth()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS));
    }

    throw new Error(
      `Pipecat sidecar health check timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`
    );
  }

  private checkHealth(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: this._port,
          path: "/health",
          method: "GET",
          timeout: 2000,
        },
        (res) => {
          resolve(res.statusCode === 200);
        }
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  }

  private handleCrash(): void {
    this.restartCount++;
    console.log(
      `[PipecatSidecar] Crash detected (attempt ${this.restartCount}/${MAX_RESTART_COUNT})`
    );

    if (this.restartCount >= MAX_RESTART_COUNT) {
      console.error("[PipecatSidecar] Max restart attempts reached, giving up");
      this.setState("error");
      return;
    }

    // Auto-restart
    this.setState("starting");
    this.spawnProcess();
    this.waitForHealthy()
      .then(() => {
        this.setState("running");
      })
      .catch((err) => {
        console.error("[PipecatSidecar] Restart failed:", err);
        this.handleCrash();
      });
  }

  private async gracefulShutdown(): Promise<void> {
    if (!this.process) return;

    const proc = this.process;

    // Send SIGTERM
    try {
      proc.kill("SIGTERM");
    } catch {
      // Process may already be dead
      this.process = null;
      return;
    }

    // Wait for graceful exit or force kill
    return new Promise<void>((resolve) => {
      const forceKillTimer = setTimeout(() => {
        console.log("[PipecatSidecar] SIGTERM timeout, sending SIGKILL");
        try {
          proc.kill("SIGKILL");
        } catch {
          // Already dead
        }
      }, GRACEFUL_SHUTDOWN_MS);

      proc.once("close", () => {
        clearTimeout(forceKillTimer);
        this.process = null;
        resolve();
      });

      // Safety timeout in case close never fires
      setTimeout(() => {
        clearTimeout(forceKillTimer);
        this.process = null;
        resolve();
      }, GRACEFUL_SHUTDOWN_MS + 2000);
    });
  }

  private killProcess(): void {
    if (this.process) {
      try {
        this.process.kill("SIGKILL");
      } catch {
        // Already dead
      }
      this.process = null;
    }
  }

  private clearHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearTimeout(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }
}
