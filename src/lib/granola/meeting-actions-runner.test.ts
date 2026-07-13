import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { meetingActionsRunnerInvocation } from "./meeting-actions-runner";

test("meeting extraction uses the supervisor Node ABI instead of PATH-selected npx", () => {
  const cwd = process.cwd();
  const invocation = meetingActionsRunnerInvocation(cwd, ["scripts/loop-meeting-actions.ts", "--skip-processed"]);
  assert.equal(invocation.command, process.execPath);
  assert.equal(path.basename(invocation.args[0]), "cli.mjs");
  assert.equal(fs.existsSync(invocation.args[0]), true);
  assert.deepEqual(invocation.args.slice(1), ["scripts/loop-meeting-actions.ts", "--skip-processed"]);
});
