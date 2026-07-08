#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const allowStandalone =
  process.env.HILT_STANDALONE_BUILD === "1" ||
  process.env.HILT_STANDALONE_BUILD === "true";

const maxBytes = {
  ".next": 3 * 1024 ** 3,
  ".next-prod": 2 * 1024 ** 3,
  dist: 1024 ** 3,
};

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

function findFiles(startPath, predicate, results = []) {
  if (!fs.existsSync(startPath)) return results;
  const stat = fs.lstatSync(startPath);
  if (!stat.isDirectory()) {
    if (predicate(startPath)) results.push(startPath);
    return results;
  }
  for (const entry of fs.readdirSync(startPath)) {
    findFiles(path.join(startPath, entry), predicate, results);
  }
  return results;
}

const failures = [];

if (!allowStandalone && exists(path.join(".next-prod", "standalone"))) {
  failures.push(".next-prod/standalone exists after a normal prod rebuild");
}

for (const relativePath of [".next", ".next-prod"]) {
  const dmgs = findFiles(path.join(root, relativePath), (filePath) => filePath.endsWith(".dmg"));
  for (const dmg of dmgs) {
    failures.push(`DMG found inside ${path.relative(root, dmg)}`);
  }
}

for (const [relativePath, limit] of Object.entries(maxBytes)) {
  if (!exists(relativePath)) continue;
  const bytes = sizeOf(path.join(root, relativePath));
  if (bytes > limit) {
    failures.push(`${relativePath} is ${formatBytes(bytes)}, above ${formatBytes(limit)}`);
  }
}

if (exists(path.join("dist", "mac")) || exists(path.join("dist", "mac-arm64"))) {
  failures.push("electron-builder app output exists under dist/mac*");
}

if (failures.length) {
  console.error("Build artifact check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error("Run: npm run clean:build-artifacts -- --force");
  process.exit(1);
}

console.log("Build artifact check passed.");
