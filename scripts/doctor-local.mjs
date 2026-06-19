#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const APP_NAME = "Hilt";
const REQUIRED_MODULES = ["electron", "better-sqlite3"];
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const failures = [];

function check(ok, message, detail) {
  const prefix = ok ? "ok" : "fail";
  console.log(`[${prefix}] ${message}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures.push(message);
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function shellOutput(command) {
  return commandOutput("/bin/sh", ["-lc", command]);
}

function safeRealpath(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function isOnNetworkVolume(path) {
  return safeRealpath(path).startsWith("/Volumes/");
}

function readNvmrc() {
  const nvmrcPath = join(ROOT, ".nvmrc");
  if (!existsSync(nvmrcPath)) return null;
  return readFileSync(nvmrcPath, "utf8").trim().replace(/^v/, "");
}

function major(version) {
  const match = String(version).match(/^v?(\d+)/);
  return match ? Number(match[1]) : NaN;
}

console.log(`${APP_NAME} local desktop doctor`);
console.log(`root: ${ROOT}`);

check(!isOnNetworkVolume(ROOT), "checkout is on a local disk", "source apps should not run from /Volumes");

const expectedNode = readNvmrc();
check(Boolean(expectedNode), ".nvmrc exists", expectedNode || "missing");

const expectedNodeMajor = major(expectedNode);
const actualNode = process.version.replace(/^v/, "");
check(
  Number.isFinite(expectedNodeMajor) && major(actualNode) === expectedNodeMajor,
  `Node.js matches .nvmrc major ${expectedNode || "unknown"}`,
  `current ${actualNode}`,
);

const npmVersion = commandOutput("npm", ["--version"]);
check(npmVersion.ok, "npm is available", npmVersion.ok ? npmVersion.stdout : npmVersion.stderr);
if (npmVersion.ok) {
  check(major(npmVersion.stdout) === 10, "npm major is 10", `current ${npmVersion.stdout}`);
}

const clang = shellOutput("command -v clang");
check(clang.ok && clang.stdout.length > 0, "clang is available for native launcher builds", clang.stdout || clang.stderr);

const packageLock = join(ROOT, "package-lock.json");
const nodeModules = join(ROOT, "node_modules");
const nodeModulesLock = join(nodeModules, ".package-lock.json");
check(existsSync(packageLock), "package-lock.json exists");
check(existsSync(nodeModules), "node_modules exists", nodeModules);
if (existsSync(packageLock) && existsSync(nodeModules)) {
  check(existsSync(nodeModulesLock), "node_modules install lock exists", nodeModulesLock);
  if (existsSync(nodeModulesLock)) {
    const lockFresh = statSync(nodeModulesLock).mtimeMs >= statSync(packageLock).mtimeMs;
    check(lockFresh, "node_modules is at least as fresh as package-lock.json");
  }
}

for (const moduleName of REQUIRED_MODULES) {
  const result = commandOutput(process.execPath, ["-e", `require(${JSON.stringify(moduleName)})`]);
  check(result.ok, `${moduleName} can be required`, result.ok ? "" : result.stderr.split("\n").at(-1));
}

if (failures.length > 0) {
  console.error(`\n${APP_NAME} local setup is not ready. Fix the failed checks above, then rerun npm run doctor:local.`);
  process.exit(1);
}

console.log(`\n${APP_NAME} local setup is ready.`);
