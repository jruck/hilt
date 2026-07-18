#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const allowRunning = args.has("--allow-running");
const heartbeatPath = path.join(
  process.env.DATA_DIR || path.join(os.homedir(), ".hilt", "data"),
  "app-supervisor.json"
);
const HEARTBEAT_FRESH_MS = 90_000;

const buildDirs = [
  ".next",
  ".next-prod",
  ".next-gateway",
  ".next-devtest",
  ".next-prod-test",
  "out",
  "release",
  path.join("dist", "mac"),
  path.join("dist", "mac-arm64"),
];

const distFilePattern =
  /^(Hilt-.+\.(dmg|zip|blockmap)|latest.*\.ya?ml|builder-(debug|effective-config)\.ya?ml)$/;

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  const units = ["K", "M", "G", "T"];
  let value = bytes / 1024;
  let unit = units.shift();
  while (value >= 1024 && units.length) {
    value /= 1024;
    unit = units.shift();
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)}${unit}`;
}

function sizeOf(targetPath) {
  let stat;
  try {
    stat = fs.lstatSync(targetPath);
  } catch {
    return 0;
  }
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const entry of fs.readdirSync(targetPath)) {
    total += sizeOf(path.join(targetPath, entry));
  }
  return total;
}

function collectTargets() {
  const targets = [];

  for (const relativePath of buildDirs) {
    if (exists(relativePath)) targets.push(relativePath);
  }

  const distPath = path.join(root, "dist");
  if (fs.existsSync(distPath)) {
    for (const entry of fs.readdirSync(distPath)) {
      if (distFilePattern.test(entry)) {
        targets.push(path.join("dist", entry));
      }
    }
  }

  return [...new Set(targets)].sort();
}

function readFreshSupervisorHeartbeat() {
  let heartbeat;
  try {
    heartbeat = JSON.parse(fs.readFileSync(heartbeatPath, "utf-8"));
  } catch {
    return null;
  }
  const beatMs = Date.parse(heartbeat?.beat_at ?? "");
  const pid = typeof heartbeat?.pid === "number" ? heartbeat.pid : null;
  if (!Number.isFinite(beatMs) || Date.now() - beatMs > HEARTBEAT_FRESH_MS || !pid) {
    return null;
  }
  try {
    process.kill(pid, 0);
    return heartbeat;
  } catch {
    return null;
  }
}

const targets = collectTargets();

if (!targets.length) {
  console.log("No generated build artifacts found.");
  process.exit(0);
}

let total = 0;
for (const relativePath of targets) {
  const absolutePath = path.join(root, relativePath);
  const bytes = sizeOf(absolutePath);
  total += bytes;
  console.log(`${force ? "remove" : "would remove"} ${relativePath} (${formatBytes(bytes)})`);
}
console.log(`${force ? "removing" : "dry run"} total: ${formatBytes(total)}`);

if (!force) {
  console.log("Pass --force to delete these generated artifacts.");
  process.exit(0);
}

const heartbeat = readFreshSupervisorHeartbeat();
if (heartbeat && !allowRunning) {
  console.error(
    `Refusing forced cleanup while Hilt supervisor is active (pid ${heartbeat.pid}, state ${heartbeat.state ?? "unknown"}).`
  );
  console.error("Stop Hilt/supervisor first, or pass --allow-running if you intentionally accept that risk.");
  process.exit(1);
}

for (const relativePath of targets) {
  fs.rmSync(path.join(root, relativePath), { recursive: true, force: true });
}

console.log("Build artifacts removed.");
