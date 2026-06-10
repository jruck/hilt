import { describe, it, expect, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Point the JSON stores at a throwaway dir BEFORE importing db.ts — its
// DATA_DIR/INBOX_FILE consts are resolved at module-eval time.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-db-test-"));
process.env.DATA_DIR = tmpDir;

const db = await import("./db");
const INBOX_FILE = path.join(tmpDir, "inbox.json");

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function noLeftoverTempFiles(): boolean {
  return !fs
    .readdirSync(tmpDir)
    .some((name) => name.includes(".tmp."));
}

describe("inbox JSON store (atomic writes)", () => {
  it("create → read round-trips the item", async () => {
    await db.createInboxItem("a1", "first prompt", "/proj/a");
    const items = await db.getInboxItems();
    expect(items.find((i) => i.id === "a1")).toMatchObject({
      id: "a1",
      prompt: "first prompt",
      projectPath: "/proj/a",
    });
  });

  it("update mutates prompt and sortOrder", async () => {
    await db.createInboxItem("a2", "before", undefined, 1);
    await db.updateInboxItem("a2", "after", 5);
    const item = (await db.getInboxItems()).find((i) => i.id === "a2");
    expect(item?.prompt).toBe("after");
    expect(item?.sortOrder).toBe(5);
  });

  it("delete removes the item", async () => {
    await db.createInboxItem("a3", "doomed");
    await db.deleteInboxItem("a3");
    expect((await db.getInboxItems()).some((i) => i.id === "a3")).toBe(false);
  });

  it("writes valid JSON and leaves no temp-file debris", async () => {
    await db.createInboxItem("a4", "durable");
    const raw = fs.readFileSync(INBOX_FILE, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
    // Two-space-indented JSON shape is preserved (round-trip compatible).
    expect(raw).toContain("\n  ");
    expect(noLeftoverTempFiles()).toBe(true);
  });
});
