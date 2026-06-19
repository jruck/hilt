#!/usr/bin/env node
import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import os from "node:os";

const APP_NAME = "Hilt";
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const APP_PATH = join(ROOT, "dist", `${APP_NAME}.app`);
const MACOS_DIR = join(APP_PATH, "Contents", "MacOS");
const RESOURCES_DIR = join(APP_PATH, "Contents", "Resources");
const LAUNCHER = join(MACOS_DIR, "launcher");
const LAUNCHER_SH = join(MACOS_DIR, "launcher.sh");
const INFO_PLIST = join(APP_PATH, "Contents", "Info.plist");

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

function safeRealpath(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function isExecutable(path) {
  try {
    return Boolean(statSync(path).mode & 0o111);
  } catch {
    return false;
  }
}

function isOnNetworkVolume(path) {
  return safeRealpath(path).startsWith("/Volumes/");
}

function fileDescription(path) {
  const result = commandOutput("/usr/bin/file", [path]);
  return result.ok ? result.stdout : result.stderr;
}

function expectedArchLabel() {
  if (os.arch() === "arm64") return "arm64";
  if (os.arch() === "x64") return "x86_64";
  return os.arch();
}

function checkMachO(path, label) {
  const description = fileDescription(path);
  check(description.includes("Mach-O"), `${label} is a native Mach-O binary`, description);
  const expectedArch = expectedArchLabel();
  if (expectedArch === "arm64" || expectedArch === "x86_64") {
    check(description.includes(expectedArch), `${label} architecture matches this Mac`, description);
  }
}

console.log(`${APP_NAME} desktop app verifier`);
console.log(`root: ${ROOT}`);
console.log(`app: ${APP_PATH}`);

check(!isOnNetworkVolume(ROOT), "checkout is on a local disk", "source apps should not run from /Volumes");
check(!isOnNetworkVolume(APP_PATH), "app bundle is on a local disk", "source apps should not run from /Volumes");
check(existsSync(APP_PATH), `${APP_NAME}.app exists`);
check(existsSync(INFO_PLIST), "Info.plist exists");

if (existsSync(INFO_PLIST)) {
  const executable = commandOutput("/usr/bin/plutil", ["-extract", "CFBundleExecutable", "raw", "-o", "-", INFO_PLIST]);
  check(executable.ok && executable.stdout === "launcher", "CFBundleExecutable points at native launcher", executable.stdout || executable.stderr);
}

check(existsSync(MACOS_DIR), "Contents/MacOS exists");
check(existsSync(RESOURCES_DIR), "Contents/Resources exists");
check(existsSync(LAUNCHER), "native launcher exists", LAUNCHER);
check(isExecutable(LAUNCHER), "native launcher is executable");
if (existsSync(LAUNCHER)) checkMachO(LAUNCHER, "native launcher");

check(existsSync(LAUNCHER_SH), "launcher shell helper exists", LAUNCHER_SH);
check(isExecutable(LAUNCHER_SH), "launcher shell helper is executable");
check(!existsSync(join(MACOS_DIR, "launcher.c")), "C source is not shipped inside the app bundle");

const electronPath = commandOutput(process.execPath, ["-e", "process.stdout.write(require('electron'))"]);
check(electronPath.ok, "Electron module resolves", electronPath.ok ? electronPath.stdout : electronPath.stderr.split("\n").at(-1));
if (electronPath.ok) {
  check(existsSync(electronPath.stdout), "Electron executable exists", electronPath.stdout);
  if (existsSync(electronPath.stdout)) checkMachO(electronPath.stdout, "Electron executable");
}

const electronFramework = join(ROOT, "node_modules", "electron", "dist", "Electron.app", "Contents", "Frameworks", "Electron Framework.framework", "Versions", "A", "Electron Framework");
check(existsSync(electronFramework), "Electron Framework exists", electronFramework);
if (existsSync(electronFramework)) checkMachO(electronFramework, "Electron Framework");

if (failures.length > 0) {
  console.error(`\n${APP_NAME} desktop verification failed. Fix the failed checks above before sharing this app bundle.`);
  process.exit(1);
}

console.log(`\n${APP_NAME} desktop app verified.`);
