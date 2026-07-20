import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { secureSchedulerLogPaths } from "../../../scripts/launchd-scheduler";

test("scheduler log paths are owner-only, including existing permissive files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-scheduler-logs-"));
  const logDir = path.join(root, "logs");
  const stdout = path.join(logDir, "job.out.log");
  const stderr = path.join(logDir, "job.err.log");

  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(stderr, "retained failure\n", { mode: 0o644 });
  secureSchedulerLogPaths([{ stdout, stderr }], logDir);

  assert.equal(fs.statSync(logDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(stdout).mode & 0o777, 0o600);
  assert.equal(fs.statSync(stderr).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(stderr, "utf-8"), "retained failure\n");
});
