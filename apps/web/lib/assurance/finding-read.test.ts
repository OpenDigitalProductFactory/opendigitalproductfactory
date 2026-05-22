import { describe, expect, it, vi } from "vitest";
import { getActiveFindingSummaryForBuild, getActiveFindingSummaryForProduct } from "./finding-read";

describe("active assurance finding summaries", () => {
  it("rolls up active build findings by severity and release impact", async () => {
    const db = {
      assuranceFinding: {
        findMany: vi.fn(async () => [
          { policySeverity: "critical", releaseImpact: "block", status: "open", findingKind: "vulnerability" },
          { policySeverity: "medium", releaseImpact: "warn", status: "planned", findingKind: "license" },
          { policySeverity: "high", releaseImpact: "block", status: "accepted", findingKind: "vulnerability" },
        ]),
      },
    };

    await expect(getActiveFindingSummaryForBuild(db, "BUILD-1")).resolves.toEqual({
      total: 3,
      blocking: 1,
      bySeverity: { critical: 1, high: 1, medium: 1, low: 0, info: 0 },
      byKind: { vulnerability: 2, license: 1 },
    });
    expect(db.assuranceFinding.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { buildId: "BUILD-1", status: { notIn: ["resolved", "false-positive"] } },
    }));
  });

  it("returns an empty summary when product finding persistence is not available yet", async () => {
    await expect(getActiveFindingSummaryForProduct({}, "prod-1")).resolves.toEqual({
      total: 0,
      blocking: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      byKind: {},
    });
  });
});
