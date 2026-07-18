#!/usr/bin/env tsx
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  BAKEOFF_METHOD_IDS,
  type BakeoffMethodId,
  type BakeoffResults,
} from "../src/lib/library/recommendation-bakeoff";

const args = process.argv.slice(2);
const argValue = (name: string, fallback: string): string => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const resultsPath = path.resolve(argValue("--results", "results.json"));
const outputDir = path.resolve(argValue("--output-dir", path.dirname(resultsPath)));
const results = JSON.parse(fs.readFileSync(resultsPath, "utf-8")) as BakeoffResults;
const labels = ["A", "B", "C", "D"];

function shuffledMethods(): BakeoffMethodId[] {
  const methods = [...BAKEOFF_METHOD_IDS];
  for (let index = methods.length - 1; index > 0; index -= 1) {
    const swap = crypto.randomInt(index + 1);
    [methods[index], methods[swap]] = [methods[swap], methods[index]];
  }
  return methods;
}

const mapping: Record<string, Record<string, BakeoffMethodId>> = {};
const lines = [
  "# Blinded Library recommendation review packet",
  "",
  "For each date, rank anonymous groups A-D best to worst. Group identities are independently randomized per date.",
  "Judge immediate utility, specificity to that day's real work, false-positive risk, novelty, and selectivity.",
  "The actual Hilt record is context and evidence, not automatic ground truth.",
];

for (const checkpoint of results.checkpoints.filter((entry) => entry.briefing_date)) {
  const date = checkpoint.briefing_date!;
  const methods = shuffledMethods();
  mapping[date] = Object.fromEntries(labels.map((label, index) => [label, methods[index]]));
  lines.push("", `## ${date}`, "", "### Historical context and actual Hilt record", "");
  for (const pick of checkpoint.actual_picks) lines.push(`- ${pick.title || pick.artifact_id}: ${pick.why_now}`);
  for (const label of labels) {
    const result = checkpoint.methods[mapping[date][label]];
    const picks = result.briefing_picks.length ? result.briefing_picks : result.editor_picks.slice(0, 3);
    lines.push("", `### Anonymous group ${label}`, "");
    if (!picks.length) lines.push(`- No validated selections${result.editor_error ? " (atomic editor rejection)" : ""}.`);
    for (const pick of picks) lines.push(`- ${pick.title}: ${pick.reason}`);
  }
}

const packet = `${lines.join("\n")}\n`;
const packetHash = crypto.createHash("sha256").update(packet).digest("hex");
fs.mkdirSync(outputDir, { recursive: true });
const packetPath = path.join(outputDir, "blind-packet.md");
const keyPath = path.join(outputDir, "blind-key.json");
fs.writeFileSync(packetPath, packet);
fs.writeFileSync(keyPath, `${JSON.stringify({ version: 1, packet_sha256: packetHash, mapping }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ packet: packetPath, key: keyPath, packet_sha256: packetHash, dates: Object.keys(mapping).length }, null, 2)}\n`);
