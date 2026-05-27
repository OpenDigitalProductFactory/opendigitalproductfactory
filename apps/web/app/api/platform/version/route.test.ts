import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/platform/version", () => ({
  loadPlatformVersion: async () => ({
    version: "1.0.0",
    publishedAt: new Date("2026-05-24T00:00:00.000Z"),
    gitSha: "abc123",
    imageVersion: { raw: "abc123", source: "git-sha" as const },
    note: "baseline",
  }),
}));

import { GET } from "./route";

describe("GET /api/platform/version", () => {
  it("returns version, publishedAt, gitSha, imageVersion, and note as JSON", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      version: "1.0.0",
      publishedAt: "2026-05-24T00:00:00.000Z",
      gitSha: "abc123",
      imageVersion: { raw: "abc123", source: "git-sha" },
      note: "baseline",
    });
  });

  it("has cache headers preventing stale responses", async () => {
    const res = await GET();
    expect(res.headers.get("cache-control")).toMatch(/no-store|no-cache/);
  });
});
