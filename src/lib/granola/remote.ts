import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import {
  getGranolaDefaultDaysBack,
  getGranolaRemoteHelperPath,
  getGranolaRemoteHost,
  getGranolaRemoteNodePath,
} from "./config";
import { normalizeGranolaDocument } from "./normalize";
import type { GranolaDocument } from "./types";

interface RemotePayloadDocument {
  raw: Record<string, unknown>;
  transcript?: unknown;
}

interface RemotePayload {
  ok: boolean;
  docs?: RemotePayloadDocument[];
  error?: string;
}

export async function fetchGranolaDocumentsFromRemote(options: {
  daysBack?: number;
  limit?: number;
  includeTranscripts?: boolean;
  documentIds?: string[];
} = {}): Promise<GranolaDocument[]> {
  const fixturePath = process.env.HILT_GRANOLA_FIXTURE_PATH;
  if (fixturePath) {
    const payload = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as RemotePayload;
    return normalizeRemotePayload(payload);
  }

  const host = getGranolaRemoteHost();
  const helperPath = await resolveRemoteHelper(host);
  const args = [
    host,
    getGranolaRemoteNodePath(),
    helperPath,
    "fetch",
    "--days",
    String(options.daysBack ?? getGranolaDefaultDaysBack()),
  ];
  if (options.limit) args.push("--limit", String(options.limit));
  if (options.includeTranscripts !== false) args.push("--transcripts");
  if (options.documentIds?.length) args.push("--ids", options.documentIds.join(","));

  const payload = await runJsonCommand("ssh", args);
  return normalizeRemotePayload(payload);
}

function normalizeRemotePayload(payload: RemotePayload): GranolaDocument[] {
  if (!payload.ok) throw new Error(payload.error || "Granola remote helper failed");
  return (payload.docs ?? []).map((doc) => normalizeGranolaDocument(doc.raw, doc.transcript ?? []));
}

function runJsonCommand(command: string, args: string[]): Promise<RemotePayload> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf-8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf-8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as RemotePayload);
      } catch (error) {
        reject(new Error(`Could not parse Granola helper JSON: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

async function resolveRemoteHelper(host: string): Promise<string> {
  const preferred = getGranolaRemoteHelperPath();
  if (await remoteFileExists(host, preferred)) return preferred;

  const localHelper = path.join(process.cwd(), "scripts", "granola-remote-helper.mjs");
  if (!fs.existsSync(localHelper)) {
    throw new Error(`Granola remote helper missing locally: ${localHelper}`);
  }

  const fallback = "/tmp/hilt-granola-remote-helper.mjs";
  await runCommand("scp", [localHelper, `${host}:${fallback}`]);
  return fallback;
}

async function remoteFileExists(host: string, filePath: string): Promise<boolean> {
  try {
    await runCommand("ssh", [host, "test", "-f", filePath]);
    return true;
  } catch {
    return false;
  }
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf-8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}
