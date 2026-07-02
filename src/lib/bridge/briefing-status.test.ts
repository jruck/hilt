import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  getBriefingFailureForDate,
  getEasternDate,
  getHermesBriefingFailureForDate,
} from "./briefing-status";

const tempDirs: string[] = [];

interface Fixture {
  root: string;
  vaultPath: string;
  dataDir: string;
}

async function makeFixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hilt-briefing-status-"));
  tempDirs.push(root);
  const vaultPath = path.join(root, "vault");
  const dataDir = path.join(root, "data");
  await fs.mkdir(path.join(vaultPath, "briefings"), { recursive: true });
  return { root, vaultPath, dataDir };
}

async function writeBriefing(vaultPath: string, date: string): Promise<void> {
  await fs.mkdir(path.join(vaultPath, "briefings"), { recursive: true });
  await fs.writeFile(path.join(vaultPath, "briefings", `${date}.md`), `# Briefing ${date}\n`, "utf-8");
}

async function writeRunRecord(
  dataDir: string,
  date: string,
  record: Record<string, unknown>,
): Promise<void> {
  const dir = path.join(dataDir, "briefing-runs");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${date}.json`),
    `${JSON.stringify({
      date,
      mode: "daily",
      run_at: "2026-06-02T10:01:15.000Z",
      ...record,
    }, null, 2)}\n`,
    "utf-8",
  );
}

after(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("briefing status", () => {
  it("formats dates in Eastern time", () => {
    assert.equal(getEasternDate(new Date("2026-06-02T03:30:00Z")), "2026-06-01");
    assert.equal(getEasternDate(new Date("2026-06-02T10:00:00Z")), "2026-06-02");
  });

  it("synthesizes a native invalid daily run when today's briefing file is missing", async () => {
    const { vaultPath, dataDir } = await makeFixture();
    const draftPath = path.join(vaultPath, "briefings", "2026-06-02.md.invalid-draft");
    await writeRunRecord(dataDir, "2026-06-02", {
      status: "invalid",
      failures: ["Missing required heading", "Footer must match briefing contract"],
      draft_path: draftPath,
    });

    const failure = await getBriefingFailureForDate("2026-06-02", {
      vaultPath,
      dataDir,
      now: new Date("2026-06-02T10:10:00Z"),
    });

    assert.deepEqual(failure, {
      status: "failed",
      kind: "model",
      date: "2026-06-02",
      jobId: "native-daily",
      jobName: "Morning Briefing (native)",
      runAt: "2026-06-02T10:01:15.000Z",
      nextRunAt: "2026-06-03T10:00:00.000Z",
      autoRetryNextRunAt: "2026-06-02T10:30:00.000Z",
      error: "Missing required heading; Footer must match briefing contract",
      outputPath: draftPath,
    });
  });

  it("suppresses a failed run record once the daily briefing file exists", async () => {
    const { vaultPath, dataDir } = await makeFixture();
    await writeRunRecord(dataDir, "2026-06-02", {
      status: "invalid",
      failures: ["Missing required heading"],
      draft_path: path.join(vaultPath, "briefings", "2026-06-02.md.invalid-draft"),
    });
    await writeBriefing(vaultPath, "2026-06-02");

    const failure = await getBriefingFailureForDate("2026-06-02", {
      vaultPath,
      dataDir,
      now: new Date("2026-06-02T10:10:00Z"),
    });

    assert.equal(failure, null);
  });

  it("classifies native rate-limited runs and omits auto retry outside the retry window", async () => {
    const { vaultPath, dataDir } = await makeFixture();
    await writeRunRecord(dataDir, "2026-06-02", {
      status: "rate_limited",
      failures: ["Claude rate limit while generating briefing"],
    });

    const failure = await getBriefingFailureForDate("2026-06-02", {
      vaultPath,
      dataDir,
      now: new Date("2026-06-02T21:10:00Z"),
    });

    assert.equal(failure?.kind, "rate_limit");
    assert.equal(failure?.autoRetryNextRunAt, null);
    assert.equal(failure?.error, "Claude rate limit while generating briefing");
    assert.equal(failure?.outputPath, null);
  });

  it("ignores ok and weekend run records for the daily failure surface", async () => {
    const { vaultPath, dataDir } = await makeFixture();
    await writeRunRecord(dataDir, "2026-06-06", {
      mode: "weekend",
      status: "invalid",
      failures: ["Weekend validation failed"],
    });
    await writeRunRecord(dataDir, "2026-06-02", {
      status: "ok",
      failures: [],
      committed: true,
      pushed: true,
    });

    assert.equal(await getBriefingFailureForDate("2026-06-06", { vaultPath, dataDir }), null);
    assert.equal(await getBriefingFailureForDate("2026-06-02", { vaultPath, dataDir }), null);
  });

  it("keeps the Hermes-era export as a native compatibility alias", async () => {
    const { vaultPath, dataDir } = await makeFixture();
    await writeRunRecord(dataDir, "2026-06-02", {
      status: "invalid",
      failures: ["Missing required heading"],
    });

    const failure = await getHermesBriefingFailureForDate("2026-06-02", {
      vaultPath,
      dataDir,
      now: new Date("2026-06-02T10:10:00Z"),
    });

    assert.equal(failure?.jobId, "native-daily");
    assert.equal(failure?.kind, "model");
  });
});
