import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { buildAreaGoalContextBlock } from "./area-goal-context";

const tempDirs: string[] = [];

function makeVault(): string {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-area-goals-"));
  tempDirs.push(vault);
  fs.mkdirSync(path.join(vault, "areas"), { recursive: true });
  return vault;
}

function writeFile(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("area goal context", () => {
  it("builds a deterministic North Stars / areas block for briefing generation", async () => {
    const vault = makeVault();
    writeFile(path.join(vault, "areas", "index.md"), `# North Stars

## Now
- Build public presence -> [[writing]]

## Ongoing
- Be firm with Walter -> [[family/index|Family]]
`);

    writeFile(path.join(vault, "areas", "writing", "index.md"), `# Writing

## Goals
- Publish regularly

## Standards
- Be specific

## Active Projects
- [[../../projects/public-writing/index|Public Writing]]
`);

    writeFile(path.join(vault, "areas", "family", "index.md"), `# Family

## Goals
- Support Walter

## Context
- Private family details that should not be copied into the compact block.
`);

    const block = await buildAreaGoalContextBlock(vault);

    assert.match(block, /^=== NORTH STARS \/ AREAS ===/);
    assert.match(block, /## areas\/index\.md/);
    assert.match(block, /Build public presence -> \[\[writing\]\]/);
    assert.match(block, /### Writing \(areas\/writing\/index\.md\)/);
    assert.match(block, /Goals:\n- Publish regularly/);
    assert.match(block, /Standards:\n- Be specific/);
    assert.match(block, /Active Projects:\n- \[\[..\/..\/projects\/public-writing\/index\|Public Writing\]\]/);
    assert.match(block, /### Family \(areas\/family\/index\.md\)/);
    assert.doesNotMatch(block, /Private family details/);
  });
});
