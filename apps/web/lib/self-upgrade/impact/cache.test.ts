import { afterEach, describe, expect, it } from "vitest";

import { _resetCacheForTest, cacheKey, getCached, setCached } from "./cache";
import type { SummaryResult } from "./types";

afterEach(() => {
  _resetCacheForTest();
});

describe("cacheKey", () => {
  it("uses both SHAs", () => {
    expect(cacheKey("a", "b")).toBe("a::b");
  });
  it("encodes null as a stable sentinel", () => {
    expect(cacheKey(null, "b")).toBe("_none_::b");
    expect(cacheKey("a", null)).toBe("a::_none_");
  });
});

describe("getCached / setCached", () => {
  const ok: SummaryResult = {
    ok: true,
    summary: {
      currentLineageSha: "a",
      targetSha: "b",
      counts: { breaking: 0, security: 0, feature: 0, fix: 0, performance: 0, dependency: 0, documentation: 0, maintenance: 0, other: 0, total: 0 },
      topItems: [],
      allItems: [],
      phrased: null,
      enrichment: { githubReachable: false, prsEnriched: 0 },
      generatedAt: "2026-05-01T00:00:00Z",
      fromCache: false,
    },
  };

  it("returns null when no entry", () => {
    expect(getCached("a", "b")).toBeNull();
  });
  it("returns the stored value", () => {
    setCached("a", "b", ok);
    expect(getCached("a", "b")).toEqual(ok);
  });
  it("isolates entries by key", () => {
    setCached("a", "b", ok);
    expect(getCached("a", "c")).toBeNull();
  });
});
