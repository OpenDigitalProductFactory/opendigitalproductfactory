// BI-F9AA0872: the explorer's arrival picture.
//
// The load-bearing property is RESILIENCE, not the specific seeds. A hardcoded node
// key would be an install-specific fact that silently renders an empty canvas
// elsewhere, so each slice resolves against whatever the install holds and a slice
// that resolves to nothing is dropped rather than drawn as an empty frame.

import { describe, expect, it, vi, beforeEach } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("@dpf/db", () => ({ prisma: { $queryRawUnsafe: queryMock } }));

import { resolveDefaultViewSlices, DEFAULT_VIEW_DEPTH } from "../explorer-default-view";

beforeEach(() => {
  queryMock.mockReset();
});

describe("resolveDefaultViewSlices", () => {
  it("resolves one slice per island when the install has all of them", async () => {
    queryMock
      .mockResolvedValueOnce([{ key: "source-code:packages/db/prisma/schema.prisma" }])
      .mockResolvedValueOnce([{ key: "wiki_founder_kernel" }])
      .mockResolvedValueOnce([{ key: "for_employees" }]);

    const slices = await resolveDefaultViewSlices();

    expect(slices.map((s) => s.key)).toEqual(["data-model", "knowledge", "portfolio"]);
    expect(slices.map((s) => s.seedKey)).toEqual([
      "source-code:packages/db/prisma/schema.prisma",
      "wiki_founder_kernel",
      "for_employees",
    ]);
  });

  it("drops a slice the install cannot produce rather than emitting an empty seed", async () => {
    // A fresh install with no knowledge corpus must still get a data-model picture.
    queryMock
      .mockResolvedValueOnce([{ key: "source-code:packages/db/prisma/schema.prisma" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ key: "for_employees" }]);

    const slices = await resolveDefaultViewSlices();

    expect(slices.map((s) => s.key)).toEqual(["data-model", "portfolio"]);
    expect(slices.every((s) => s.seedKey.length > 0)).toBe(true);
  });

  it("returns nothing on an empty graph instead of throwing", async () => {
    queryMock.mockResolvedValue([]);
    await expect(resolveDefaultViewSlices()).resolves.toEqual([]);
  });

  it("carries a human-readable rule for every slice it returns", async () => {
    // The rule is what makes the picture documentable and reproducible; a slice
    // without one is an unexplained sample.
    queryMock.mockResolvedValue([{ key: "k" }]);
    const slices = await resolveDefaultViewSlices();
    expect(slices).not.toHaveLength(0);
    for (const slice of slices) {
      expect(slice.rule.trim().length).toBeGreaterThan(0);
      expect(slice.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("keeps the arrival expansion shallow", async () => {
    // Arrival is a picture the operator did not ask to load, so it stays at one hop.
    expect(DEFAULT_VIEW_DEPTH).toBe(1);
  });
});
