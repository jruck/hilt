import { describe, it, expect, vi } from "vitest";
import { chooseLandingView } from "./landing-view";

function fetchReturning(value: {
  ok: boolean;
  json?: () => Promise<unknown>;
  throws?: boolean;
}): typeof fetch {
  return vi.fn(async () => {
    if (value.throws) throw new Error("network down");
    return {
      ok: value.ok,
      json: value.json ?? (async () => []),
    } as Response;
  }) as unknown as typeof fetch;
}

describe("chooseLandingView", () => {
  it("lands on Briefing when at least one briefing exists", async () => {
    const fetchImpl = fetchReturning({
      ok: true,
      json: async () => [{ date: "2026-06-10", title: "Today" }],
    });
    expect(await chooseLandingView(fetchImpl)).toBe("briefings");
  });

  it("falls back to Bridge when there are no briefings", async () => {
    const fetchImpl = fetchReturning({ ok: true, json: async () => [] });
    expect(await chooseLandingView(fetchImpl)).toBe("bridge");
  });

  it("falls back to Bridge on a non-ok response", async () => {
    const fetchImpl = fetchReturning({ ok: false });
    expect(await chooseLandingView(fetchImpl)).toBe("bridge");
  });

  it("falls back to Bridge when the request throws", async () => {
    const fetchImpl = fetchReturning({ ok: true, throws: true });
    expect(await chooseLandingView(fetchImpl)).toBe("bridge");
  });
});
