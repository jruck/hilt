import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  listBriefingSummaries,
  makeWeekendBriefingId,
  parseBriefingId,
  readBriefingById,
} from "./briefing-files";

const tempDirs: string[] = [];

function makeVault(): string {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-briefings-"));
  tempDirs.push(vault);
  fs.mkdirSync(path.join(vault, "briefings", "weekend"), { recursive: true });
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

describe("briefing files", () => {
  it("lists daily and weekend briefings with stable ids and date ranges", async () => {
    const vault = makeVault();
    writeFile(path.join(vault, "briefings", "2026-06-19.md"), `---
title: Friday Briefing
summary: Daily summary
---

Friday body.
`);
    writeFile(path.join(vault, "briefings", "weekend", "2026-06-20.md"), `---
briefing_kind: weekend
date_range:
  start: 2026-06-20
  end: 2026-06-21
title: Weekend Briefing — Jun 20-21, 2026
summary: Weekend summary
---

Weekend body.
`);
    writeFile(path.join(vault, "briefings", "2026-06-22.md"), `# Monday
`);

    const summaries = await listBriefingSummaries(vault);

    assert.deepEqual(summaries.map((briefing) => briefing.id), [
      "2026-06-22",
      "weekend:2026-06-20",
      "2026-06-19",
    ]);
    assert.equal(summaries[1].kind, "weekend");
    assert.deepEqual(summaries[1].dateRange, { start: "2026-06-20", end: "2026-06-21" });
    assert.equal(summaries[1].summary, "Weekend summary");
  });

  it("reads weekend briefing details by id", async () => {
    const vault = makeVault();
    writeFile(path.join(vault, "briefings", "weekend", "2026-06-20.md"), `---
briefing_kind: weekend
date_range:
  start: 2026-06-20
  end: 2026-06-21
---

# Weekend

Direction of travel.
`);

    const detail = await readBriefingById(vault, makeWeekendBriefingId("2026-06-20"));

    assert.equal(detail?.id, "weekend:2026-06-20");
    assert.equal(detail?.kind, "weekend");
    assert.match(detail?.content ?? "", /Direction of travel/);
  });

  it("parses daily and weekend ids", () => {
    assert.deepEqual(parseBriefingId("2026-06-22"), {
      id: "2026-06-22",
      kind: "daily",
      date: "2026-06-22",
      relativePath: path.join("briefings", "2026-06-22.md"),
    });
    assert.deepEqual(parseBriefingId("weekend%3A2026-06-20"), {
      id: "weekend:2026-06-20",
      kind: "weekend",
      date: "2026-06-20",
      relativePath: path.join("briefings", "weekend", "2026-06-20.md"),
    });
    assert.equal(parseBriefingId("not-a-date"), null);
  });
});
