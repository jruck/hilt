import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { areaParserInternals, getAllAreas } from "./area-parser";

const tempDirs: string[] = [];

function makeVault(): string {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-areas-"));
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

describe("area parser", () => {
  it("parses rollup focus lines and area details", async () => {
    const vault = makeVault();
    writeFile(path.join(vault, "areas", "index.md"), `# North Stars

## Now
- Build public presence -> [[writing]]

## Ongoing
- Sleep well -> [[health]]

## Long-Term
- Move and plant roots -> [[family/index|Family]]
`);

    writeFile(path.join(vault, "areas", "writing", "index.md"), `---
type: area
description: Public presence.
---

# Writing

## Goals
- Publish regularly
- Build public presence

## Standards
- Be specific

## Active Projects
- [[../../projects/public-writing/index|Public Writing]]
`);

    writeFile(path.join(vault, "areas", "health", "index.md"), `# Health

Intro paragraph.

## Goals
- Sleep
`);

    writeFile(path.join(vault, "areas", "family", "index.md"), `# Family

## Goals
- Move before school transition
`);

    const result = await getAllAreas(vault);
    const writing = result.areas.find((area) => area.slug === "writing");
    const health = result.areas.find((area) => area.slug === "health");
    const family = result.areas.find((area) => area.slug === "family");

    assert.equal(result.rollupPath, path.join(vault, "areas", "index.md"));
    assert.deepEqual(result.areas.map((area) => area.slug), ["writing", "health", "family"]);
    assert.equal(writing?.title, "Writing");
    assert.equal(writing?.description, "Public presence.");
    assert.deepEqual(writing?.goals, ["Publish regularly", "Build public presence"]);
    assert.deepEqual(writing?.standards, ["Be specific"]);
    assert.equal(writing?.activeProjects[0].label, "Public Writing");
    assert.equal(writing?.focus[0].section, "now");
    assert.equal(writing?.focus[0].text, "Build public presence");
    assert.equal(health?.description, "Intro paragraph.");
    assert.equal(family?.primaryFocus, "long-term");
  });

  it("normalizes common area wikilink targets", () => {
    assert.equal(areaParserInternals.slugFromWikilinkTarget("writing"), "writing");
    assert.equal(areaParserInternals.slugFromWikilinkTarget("family/index"), "family");
    assert.equal(areaParserInternals.slugFromWikilinkTarget("areas/home/index.md"), "home");
    assert.equal(areaParserInternals.slugFromWikilinkTarget("../relationships/index"), "relationships");
  });
});
