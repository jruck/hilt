import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getMeetingExtractionLeaseMs, getMeetingTriggerRunTimeoutMs } from "./config";

export interface MeetingActionsBatchResult {
  code: number | null;
  tail: string;
  timedOut: boolean;
  elapsedMs: number;
}

export function meetingActionsRunnerInvocation(cwd: string, scriptArgs: string[]): {
  command: string;
  args: string[];
} {
  const tsxCli = path.join(cwd, "node_modules", "tsx", "dist", "cli.mjs");
  if (!fs.existsSync(tsxCli)) throw new Error(`cannot locate local tsx CLI at ${tsxCli}`);
  return { command: process.execPath, args: [tsxCli, ...scriptArgs] };
}

function resolveRunnerCwd(): string | null {
  const candidates = [process.env.HILT_REPO_ROOT, process.cwd()].filter((dir): dir is string => Boolean(dir));
  return candidates.find((dir) => fs.existsSync(path.join(dir, "scripts", "loop-meeting-actions.ts"))) ?? null;
}

function lastLines(value: string, count: number): string {
  return value.trimEnd().split("\n").slice(-count).join("\n");
}

export async function runMeetingActionsBatch(
  meetingPaths: string[],
  options: { leaseOwner?: string; skipProcessed?: boolean } = {},
): Promise<MeetingActionsBatchResult> {
  const cwd = resolveRunnerCwd();
  if (!cwd) {
    const tail = `cannot locate scripts/loop-meeting-actions.ts from cwd=${process.cwd()} (set HILT_REPO_ROOT)`;
    console.error(`[MeetingExtraction] ${tail}`);
    return { code: null, tail, timedOut: false, elapsedMs: 0 };
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-meeting-trigger-"));
  const meetingsFile = path.join(tmpDir, "meetings.json");
  fs.writeFileSync(meetingsFile, `${JSON.stringify(meetingPaths)}\n`, "utf-8");
  const startedAt = Date.now();
  try {
    const result = await new Promise<Omit<MeetingActionsBatchResult, "elapsedMs">>((resolve) => {
      const home = process.env.HOME || os.homedir();
      const PATH = `${home}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ""}`;
      const scriptArgs = ["scripts/loop-meeting-actions.ts", "--meetings-file", meetingsFile];
      if (options.skipProcessed) scriptArgs.push("--skip-processed");
      if (options.leaseOwner) scriptArgs.push("--extraction-lease-owner", options.leaseOwner);
      const invocation = meetingActionsRunnerInvocation(cwd, scriptArgs);
      const child = spawn(invocation.command, invocation.args, {
        cwd,
        env: {
          ...process.env,
          PATH,
          ...(options.leaseOwner ? {
            HILT_MEETING_EXTRACTION_LEASE_OWNER: options.leaseOwner,
            HILT_MEETING_EXTRACTION_LEASE_MS: String(getMeetingExtractionLeaseMs()),
          } : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      let tail = "";
      let timedOut = false;
      let done = false;
      const finish = (code: number | null, extra?: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        child.stdout?.destroy();
        child.stderr?.destroy();
        resolve({ code, tail: extra ? `${tail}\n${extra}` : tail, timedOut });
      };
      const capture = (chunk: Buffer) => { tail = `${tail}${chunk.toString("utf-8")}`.slice(-4_000); };
      child.stdout?.on("data", capture);
      child.stderr?.on("data", capture);
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          if (child.pid) process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }, getMeetingTriggerRunTimeoutMs());
      child.on("error", (error) => finish(null, `spawn error: ${error.message}`));
      child.on("exit", (code) => finish(code));
    });
    const elapsedMs = Date.now() - startedAt;
    const summary =
      `[MeetingExtraction] loop-meeting-actions ${result.timedOut ? "TIMED OUT" : `exited ${result.code}`} ` +
      `after ${Math.round(elapsedMs / 1_000)}s for ${meetingPaths.length} meeting(s): ${meetingPaths.join(", ")}`;
    if (result.code === 0 && !result.timedOut) console.log(`${summary}\n${lastLines(result.tail, 8)}`);
    else console.error(`${summary}\n${lastLines(result.tail, 20)}`);
    return { ...result, elapsedMs };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
