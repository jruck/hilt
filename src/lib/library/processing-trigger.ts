import { spawn } from "node:child_process";
import { processingQueueHasDueWork } from "./processing";

export class LibraryProcessingRunner {
  private pending = false;
  private draining: Promise<void> | null = null;

  constructor(
    private readonly vaultPath: string,
    private readonly runChild: () => Promise<void> = () => runProcessingChild(vaultPath),
  ) {}

  kick(): void {
    if (!processingQueueHasDueWork(this.vaultPath)) return;
    this.pending = true;
    if (!this.draining) this.draining = this.drain();
  }

  isActive(): boolean {
    return this.draining !== null;
  }

  async idle(): Promise<void> {
    while (this.draining) await this.draining;
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending) {
        this.pending = false;
        if (!processingQueueHasDueWork(this.vaultPath)) continue;
        try {
          await this.runChild();
        } catch (error) {
          console.error("[LibraryProcessingRunner] Worker failed:", error);
        }
      }
    } finally {
      this.draining = null;
    }
  }
}

async function runProcessingChild(vaultPath: string): Promise<void> {
  const cwd = process.cwd();
  const timeoutMs = Number(process.env.LIBRARY_PROCESSING_RUN_TIMEOUT_MS || 2 * 60 * 60 * 1000);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/library-process-pending.ts"], {
      cwd,
      env: { ...process.env, BRIDGE_VAULT_PATH: vaultPath, HILT_WORKING_FOLDER: vaultPath },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let tail = "";
    let settled = false;
    const capture = (chunk: Buffer) => { tail = `${tail}${chunk.toString("utf-8")}`.slice(-8_000); };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      finish(new Error(`Worker timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => {
      if (code === 0) finish();
      else finish(new Error(`Worker exited ${code}: ${tail.trim().slice(-2_000)}`));
    });
  });
}
