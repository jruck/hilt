import assert from "node:assert/strict";
import test from "node:test";
import { ensureBriefingH1 } from "./generate";

test("adds the deterministic daily H1 when the model omits it", () => {
  const markdown = ensureBriefingH1("## 📅 Today\n\nWork.", "daily", "2026-07-13");
  assert.match(markdown, /^# Morning Briefing — Monday, July 13, 2026\n\n## 📅 Today/);
});

test("adds the weekend H1 after frontmatter and preserves an existing H1", () => {
  const without = "---\ntitle: Weekend\n---\n\n## 🧭 Direction of travel\n";
  const added = ensureBriefingH1(without, "weekend", "2026-07-11");
  assert.match(added, /^---[\s\S]*?---\n\n# Weekend Briefing — Jul 11, 2026\n\n## 🧭/);

  const existing = "# Weekend Briefing — Existing\n\n## 🧭 Direction of travel\n";
  assert.equal(ensureBriefingH1(existing, "weekend", "2026-07-11"), existing);
});
