import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    marketingStrategy: {
      update: vi.fn(),
    },
  },
}));

vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));

import {
  GROUNDING_REQUIRED_FIELDS,
  assessMarketingGrounding,
  recordMarketingGrounding,
} from "./strategy-grounding";

const emptyStrategy = {
  targetSegments: [],
  idealCustomerProfiles: [],
  proofAssets: [],
  lastReviewedAt: null,
  sourceSummary: "Bootstrapped from Organization, BusinessContext, and StorefrontConfig.",
};

describe("assessMarketingGrounding (BI-06BB96F0)", () => {
  it("names the three fields the drafter actually reads", () => {
    expect(GROUNDING_REQUIRED_FIELDS).toEqual([
      "targetSegments",
      "idealCustomerProfiles",
      "proofAssets",
    ]);
  });

  it("refuses an untouched bootstrap row and says so in the operator's terms", () => {
    const result = assessMarketingGrounding(emptyStrategy);

    expect(result.grounded).toBe(false);
    expect(result.isBootstrapStub).toBe(true);
    expect(result.missing).toEqual(["targetSegments", "idealCustomerProfiles", "proofAssets"]);
    expect(result.reason).toContain("starting template");
  });

  it("distinguishes a bootstrap stub from a plan someone edited and left incomplete", () => {
    const edited = assessMarketingGrounding({
      ...emptyStrategy,
      targetSegments: [{ name: "Local adopters" }],
      lastReviewedAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    expect(edited.isBootstrapStub).toBe(false);
    expect(edited.grounded).toBe(false);
    expect(edited.reason).not.toContain("starting template");
    expect(edited.missing).toEqual(["idealCustomerProfiles", "proofAssets"]);
  });

  it("passes only when audience and proof are both present", () => {
    const grounded = assessMarketingGrounding({
      targetSegments: [{ name: "Local adopters" }],
      idealCustomerProfiles: [{ name: "First-time adopter" }],
      proofAssets: [{ type: "testimonial", label: "Adopter story" }],
      lastReviewedAt: new Date(),
      sourceSummary: null,
    });

    expect(grounded.grounded).toBe(true);
    expect(grounded.missing).toEqual([]);
  });

  it("does not call a row with no sourceSummary a bootstrap stub", () => {
    // A hand-created strategy that has never been reviewed is incomplete, but it
    // is not the archetype template — the copy must not accuse the operator of
    // leaving a template untouched when they never had one.
    const result = assessMarketingGrounding({ ...emptyStrategy, sourceSummary: null });

    expect(result.isBootstrapStub).toBe(false);
    expect(result.reason).toContain("not be grounded in a real audience");
  });
});

describe("recordMarketingGrounding (BI-06BB96F0)", () => {
  beforeEach(() => {
    mocks.prisma.marketingStrategy.update.mockReset();
    mocks.prisma.marketingStrategy.update.mockResolvedValue({} as never);
  });

  it("writes the fields the strategist-review path could never reach", async () => {
    const result = await recordMarketingGrounding({
      strategyId: "s-1",
      grounding: {
        targetSegments: [{ name: "Local adopters" }],
        proofAssets: [{ type: "testimonial", label: "Adopter story" }],
        differentiators: ["Foster-based, no kennels"],
      },
    });

    expect(result.updatedFields).toEqual(["targetSegments", "proofAssets", "differentiators"]);
    const data = mocks.prisma.marketingStrategy.update.mock.calls[0]?.[0]?.data;
    expect(data.targetSegments).toEqual([{ name: "Local adopters" }]);
    expect(data.differentiators).toEqual(["Foster-based, no kennels"]);
  });

  it("stamps lastReviewedAt so the row stops reading as an untouched stub", async () => {
    await recordMarketingGrounding({
      strategyId: "s-1",
      grounding: { targetSegments: [{ name: "Local adopters" }] },
    });

    const data = mocks.prisma.marketingStrategy.update.mock.calls[0]?.[0]?.data;
    expect(data.lastReviewedAt).toBeInstanceOf(Date);
  });

  it("writes only what was supplied, so a multi-turn interview never blanks an earlier answer", async () => {
    await recordMarketingGrounding({
      strategyId: "s-1",
      grounding: { proofAssets: [{ type: "testimonial", label: "Adopter story" }] },
    });

    const data = mocks.prisma.marketingStrategy.update.mock.calls[0]?.[0]?.data;
    expect(data).not.toHaveProperty("targetSegments");
    expect(data).not.toHaveProperty("idealCustomerProfiles");
    expect(data).not.toHaveProperty("differentiators");
  });

  it("treats an empty string as no answer rather than an instruction to erase", async () => {
    const result = await recordMarketingGrounding({
      strategyId: "s-1",
      grounding: { geographicScope: "   ", primaryGoal: "Rehome every animal" },
    });

    expect(result.updatedFields).toEqual(["primaryGoal"]);
    const data = mocks.prisma.marketingStrategy.update.mock.calls[0]?.[0]?.data;
    expect(data).not.toHaveProperty("geographicScope");
  });

  it("writes nothing at all when the interview produced no answers", async () => {
    const result = await recordMarketingGrounding({ strategyId: "s-1", grounding: {} });

    expect(result.updatedFields).toEqual([]);
    expect(mocks.prisma.marketingStrategy.update).not.toHaveBeenCalled();
    expect(result.message).toContain("nothing was changed");
  });

  it("ignores empty arrays, which carry no information about the audience", async () => {
    const result = await recordMarketingGrounding({
      strategyId: "s-1",
      grounding: { targetSegments: [], proofAssets: [] },
    });

    expect(result.updatedFields).toEqual([]);
    expect(mocks.prisma.marketingStrategy.update).not.toHaveBeenCalled();
  });
});
