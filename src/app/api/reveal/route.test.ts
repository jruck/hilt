import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted so the vi.mock factory (which is hoisted above imports) can see it.
const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(
    (_file: string, _args: string[], cb?: (err: Error | null) => void) => {
      cb?.(null);
    },
  ),
}));

// Preserve the rest of child_process; override only execFile. Provide a
// default export too, since the import chain expects one.
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    default: { ...actual, execFile: execFileMock },
    execFile: execFileMock,
  };
});

import { POST } from "./route";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/reveal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/reveal", () => {
  beforeEach(() => {
    execFileMock.mockClear();
  });

  it("passes a shell-metacharacter path as a single argv element (no injection)", async () => {
    const malicious = '"; touch /tmp/pwned #';
    const res = await POST(jsonRequest({ path: malicious }));

    expect(res.status).toBe(200);
    expect(execFileMock).toHaveBeenCalledTimes(1);

    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe("open");
    expect(Array.isArray(args)).toBe(true);
    // The raw, unescaped string must arrive as its own argv element —
    // proving it was passed as data, never interpolated into a shell string.
    expect(args).toEqual(["-R", malicious]);
    expect((args as string[])[args.length - 1]).toBe(malicious);
  });

  it("rejects a missing/non-string path with 400 and never spawns", async () => {
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
