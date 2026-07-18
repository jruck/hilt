import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadScoringConfig, scoringConfigPath } from "./scoring-config-loader";

test("missing scoring config uses the complete s3 hybrid defaults", (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-scoring-config-"));
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  const config = loadScoringConfig(vault);
  assert.equal(config.version, "s3");
  assert.deepEqual(config.signal_weights, { project: 1.25, task: 1.35, area: 1, person: 0.35 });
  assert.equal(config.hybrid.title_weight, 3);
  assert.equal(config.hybrid.normalization_percentile, 0.95);
  assert.equal(config.hybrid.active_connection_boost, 0.1);
});

test("hybrid config merges finite leaves independently", (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-scoring-config-"));
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  fs.mkdirSync(path.dirname(scoringConfigPath(vault)), { recursive: true });
  fs.writeFileSync(scoringConfigPath(vault), JSON.stringify({
    version: "s3.1",
    hybrid: {
      title_weight: 4,
      k1: "invalid",
      active_connection_boost: Number.NaN,
      attention_low_adjustment: -0.07,
    },
  }));
  const config = loadScoringConfig(vault);
  assert.equal(config.version, "s3.1");
  assert.equal(config.hybrid.title_weight, 4);
  assert.equal(config.hybrid.k1, 1.2);
  assert.equal(config.hybrid.active_connection_boost, 0.1);
  assert.equal(config.hybrid.attention_low_adjustment, -0.07);
});

test("legacy config files load as effective s3 instead of mislabeling hybrid batches", (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-scoring-config-"));
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  fs.mkdirSync(path.dirname(scoringConfigPath(vault)), { recursive: true });
  fs.writeFileSync(scoringConfigPath(vault), JSON.stringify({
    version: "s2",
    relevance: { first_party_coeff: 0.4 },
  }));
  const config = loadScoringConfig(vault);
  assert.equal(config.version, "s3");
  assert.equal(config.relevance.first_party_coeff, 0.4);
  assert.equal(config.hybrid.k1, 1.2);
});
