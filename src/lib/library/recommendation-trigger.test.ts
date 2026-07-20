import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  readRecommendationRuntime,
  recommendationLocalDayKey,
  writeRecommendationRuntime,
} from "./recommendation-store";
import {
  isRecommendationContextPath,
  LibraryRecommendationRunner,
  recommendationRunTimeoutMs,
  reconcileRecommendationPendingReasons,
} from "./recommendation-trigger";

function setup(t: test.TestContext) {
  const previousData = process.env.DATA_DIR;
  const previousDebounce = process.env.LIBRARY_RECOMMENDATION_DEBOUNCE_MS;
  const previousCooldown = process.env.LIBRARY_RECOMMENDATION_COOLDOWN_MS;
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-rec-trigger-data-"));
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-rec-trigger-vault-"));
  process.env.DATA_DIR = data;
  process.env.LIBRARY_RECOMMENDATION_DEBOUNCE_MS = "5";
  process.env.LIBRARY_RECOMMENDATION_COOLDOWN_MS = "0";
  t.after(() => {
    if (previousData === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousData;
    if (previousDebounce === undefined) delete process.env.LIBRARY_RECOMMENDATION_DEBOUNCE_MS; else process.env.LIBRARY_RECOMMENDATION_DEBOUNCE_MS = previousDebounce;
    if (previousCooldown === undefined) delete process.env.LIBRARY_RECOMMENDATION_COOLDOWN_MS; else process.env.LIBRARY_RECOMMENDATION_COOLDOWN_MS = previousCooldown;
    fs.rmSync(data, { recursive: true, force: true });
    fs.rmSync(vault, { recursive: true, force: true });
  });
  return { vault };
}

async function settle(ms = 40) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test("recommendation child timeout covers the initial editor call and one repair", () => {
  assert.equal(recommendationRunTimeoutMs({}), 21 * 60_000);
  assert.equal(recommendationRunTimeoutMs({ LIBRARY_EDITOR_TIMEOUT_MS: "1000" }), 62_000);
  assert.equal(recommendationRunTimeoutMs({
    LIBRARY_EDITOR_TIMEOUT_MS: "1000",
    LIBRARY_RECOMMENDATION_RUN_TIMEOUT_MS: "2500",
  }), 2_500);
});

test("one saved item or three distinct candidates trigger, while duplicate candidate writes do not", async (t) => {
  const { vault } = setup(t);
  let runs = 0;
  const child = async () => {
    runs += 1;
    writeRecommendationRuntime(vault, { pending: false, pending_reasons: [], pending_since: null });
  };
  const runner = new LibraryRecommendationRunner(vault, () => {}, child, () => false);
  try {
    runner.noteArtifact("references/.cache/library-candidates/a.md", true);
    runner.noteArtifact("references/.cache/library-candidates/a.md", true);
    runner.noteArtifact("references/.cache/library-candidates/b.md", true);
    await settle();
    assert.equal(runs, 0);
    runner.noteArtifact("references/.cache/library-candidates/c.md", true);
    await settle();
    assert.equal(runs, 1);

    runner.noteArtifact("references/new-save.md", true);
    await settle();
    assert.equal(runs, 2);
  } finally {
    runner.stop();
  }
});

test("pending candidate threshold survives runner restart", async (t) => {
  const { vault } = setup(t);
  let runs = 0;
  const first = new LibraryRecommendationRunner(vault, () => {}, async () => {}, () => false);
  first.noteArtifact("references/.cache/library-candidates/a.md", true);
  first.noteArtifact("references/.cache/library-candidates/b.md", true);
  first.stop();

  const second = new LibraryRecommendationRunner(vault, () => {}, async () => {
    runs += 1;
    writeRecommendationRuntime(vault, { pending: false, pending_reasons: [], pending_since: null });
  }, () => false);
  try {
    second.noteArtifact("references/.cache/library-candidates/c.md", true);
    await settle();
    assert.equal(runs, 1);
  } finally {
    second.stop();
  }
});

test("restart honors elapsed persisted debounce time instead of restarting the full wait", async (t) => {
  const { vault } = setup(t);
  process.env.LIBRARY_RECOMMENDATION_DEBOUNCE_MS = "1000";
  writeRecommendationRuntime(vault, {
    pending: true,
    pending_reasons: ["artifact:references/saved.md"],
    pending_since: new Date(Date.now() - 2_000).toISOString(),
  });
  let runs = 0;
  const runner = new LibraryRecommendationRunner(vault, () => {}, async () => {
    runs += 1;
    writeRecommendationRuntime(vault, { pending: false, pending_reasons: [], pending_since: null });
  }, () => false);
  try {
    runner.resume();
    await settle();
    assert.equal(runs, 1);
  } finally {
    runner.stop();
  }
});

test("persisted editor failures schedule their own retry without a new artifact signal", async (t) => {
  const { vault } = setup(t);
  writeRecommendationRuntime(vault, {
    pending: true,
    pending_reasons: ["editor-retry:morning"],
    pending_since: new Date(Date.now() - 2_000).toISOString(),
    next_retry_at: new Date(Date.now() - 100).toISOString(),
    last_error: "rate_limited",
  });
  let runs = 0;
  const runner = new LibraryRecommendationRunner(vault, () => {}, async () => {
    runs += 1;
    writeRecommendationRuntime(vault, { pending: false, pending_reasons: [], pending_since: null, next_retry_at: null, last_error: null });
  }, () => false);
  try {
    runner.resume();
    await settle();
    assert.equal(runs, 1);
  } finally {
    runner.stop();
  }
});

test("context refresh runs only after the strong-match preflight", async (t) => {
  const { vault } = setup(t);
  let runs = 0;
  const child = async () => {
    runs += 1;
    writeRecommendationRuntime(vault, { pending: false, pending_reasons: [], pending_since: null });
  };
  const rejected = new LibraryRecommendationRunner(vault, () => {}, child, () => false);
  rejected.noteContext("meetings/no-match.md");
  await settle();
  assert.equal(runs, 0);
  rejected.stop();

  const accepted = new LibraryRecommendationRunner(vault, () => {}, child, () => true);
  try {
    accepted.noteContext("meetings/strong-match.md");
    await settle();
    assert.equal(runs, 1);
  } finally {
    accepted.stop();
  }
});

test("transcripts and other paths excluded from the editor context cannot trigger refresh", async (t) => {
  const { vault } = setup(t);
  assert.equal(isRecommendationContextPath(vault, "meetings/2026-07-20/notes.md"), true);
  assert.equal(isRecommendationContextPath(vault, "meetings/transcripts/private.md"), false);
  assert.equal(isRecommendationContextPath(vault, "references/item.md"), false);

  let runs = 0;
  const runner = new LibraryRecommendationRunner(vault, () => {}, async () => { runs += 1; }, () => true);
  try {
    runner.noteContext("meetings/transcripts/private.md");
    await settle();
    assert.equal(runs, 0);
    assert.deepEqual(readRecommendationRuntime(vault).pending_reasons, []);
  } finally {
    runner.stop();
  }
});

test("resume removes persisted transcript triggers that cannot enter the editor context", async (t) => {
  const { vault } = setup(t);
  writeRecommendationRuntime(vault, {
    pending: true,
    pending_since: "2026-07-20T10:00:00.000Z",
    pending_reasons: ["context-match:meetings/transcripts/private.md"],
  });
  const reconciled = reconcileRecommendationPendingReasons(vault);
  assert.equal(reconciled.pending, false);
  assert.equal(reconciled.pending_since, null);
  assert.deepEqual(reconciled.pending_reasons, []);
});

test("one successful refresh exhausts only the refresh slot for the local day", async (t) => {
  const { vault } = setup(t);
  const day = recommendationLocalDayKey(new Date());
  writeRecommendationRuntime(vault, {
    pending: true,
    pending_since: new Date(Date.now() - 1_000).toISOString(),
    pending_reasons: ["artifact:references/new-save.md"],
    automatic_runs_by_day: { [day]: 2 },
    automatic_runs_by_kind_by_day: { [day]: { morning: 1, refresh: 1 } },
  });
  let runs = 0;
  const runner = new LibraryRecommendationRunner(vault, () => {}, async () => { runs += 1; }, () => true);
  try {
    await runner.kick();
    await settle();
    assert.equal(runs, 0);
    assert.equal(readRecommendationRuntime(vault).pending, true, "work remains queued for the next local day");
  } finally {
    runner.stop();
  }
});

test("concurrent kicks start only one child worker", async (t) => {
  const { vault } = setup(t);
  process.env.LIBRARY_RECOMMENDATION_DEBOUNCE_MS = "100000";
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const runner = new LibraryRecommendationRunner(vault, () => {}, async () => {
    runs += 1;
    await gate;
    writeRecommendationRuntime(vault, { pending: false, pending_reasons: [], pending_since: null });
  }, () => false);
  try {
    runner.noteArtifact("references/save.md", true);
    const one = runner.kick();
    const two = runner.kick();
    await settle(5);
    assert.equal(runs, 1);
    release();
    await Promise.all([one, two]);
  } finally {
    runner.stop();
  }
});
