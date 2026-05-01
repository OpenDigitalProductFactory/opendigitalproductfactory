// Lightweight load test for the promotion-audit page.
//
// Server components that call prisma at request-time can't be rendered in
// vitest without heavy mocking. This test ensures the page module loads
// (so type errors and import-graph regressions surface in CI) and that the
// default export is a function. Real rendering is verified manually against
// the running app per Step 4 of the plan's Task 2.4.

import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  // Minimal shape — getPromotionAudit is invoked when the component runs,
  // not at module-load time, so this stub is only a defense against any
  // accidental top-level prisma access introduced by a future edit.
  prisma: {
    inventoryEntity: { count: async () => 0 },
    portfolioQualityIssue: {
      count: async () => 0,
      findMany: async () => [],
    },
  },
}));

describe("PromotionAuditPage module", () => {
  it("exports a default function", async () => {
    const mod = await import("./page");
    expect(typeof mod.default).toBe("function");
  });
});
