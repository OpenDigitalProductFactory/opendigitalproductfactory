import { describe, expect, it } from "vitest";

import { evaluateTechnologyLifecycle } from "./lifecycle-evaluation";

describe("evaluateTechnologyLifecycle", () => {
  it("flags commercial security software nearing renewal for review", () => {
    const result = evaluateTechnologyLifecycle(
      {
        name: "SentinelOne Complete",
        technologySourceType: "commercial",
        ciType: "security_software",
        supportModel: "subscription",
        renewalDate: "2026-06-01T00:00:00.000Z",
        billingCadence: "annual",
        customerChargeModel: "pass_through",
        licenseQuantity: 75,
        unitCost: 12,
        customerUnitPrice: 18,
      },
      new Date("2026-04-23T00:00:00.000Z"),
    );

    expect(result.lifecycleStatus).toBe("renew");
    expect(result.supportStatus).toBe("supported");
    expect(result.recommendedAction).toBe("renew");
    expect(result.licensingReviewRequired).toBe(true);
    expect(result.attentionLevel).toBe("medium");
  });

  it("flags open-source software approaching end of support for upgrade planning", () => {
    const result = evaluateTechnologyLifecycle(
      {
        name: "Ubuntu Server",
        technologySourceType: "open_source",
        supportModel: "lts",
        normalizedVersion: "22.04",
        endOfSupportAt: "2026-07-15T00:00:00.000Z",
      },
      new Date("2026-04-23T00:00:00.000Z"),
    );

    expect(result.lifecycleStatus).toBe("review");
    expect(result.supportStatus).toBe("approaching_end");
    expect(result.recommendedAction).toBe("upgrade");
    expect(result.attentionLevel).toBe("medium");
  });

  it("marks expired hardware as replace due", () => {
    const result = evaluateTechnologyLifecycle(
      {
        name: "Branch Firewall",
        technologySourceType: "commercial",
        ciType: "network_device",
        warrantyEndAt: "2025-03-01T00:00:00.000Z",
        endOfLifeAt: "2026-04-01T00:00:00.000Z",
      },
      new Date("2026-04-23T00:00:00.000Z"),
    );

    expect(result.lifecycleStatus).toBe("replace_due");
    expect(result.supportStatus).toBe("expired");
    expect(result.recommendedAction).toBe("replace");
    expect(result.attentionLevel).toBe("high");
  });

  it("returns a stable current status when no review signals are present", () => {
    const result = evaluateTechnologyLifecycle(
      {
        name: "Managed Switch",
        technologySourceType: "hybrid",
        supportModel: "partner",
        endOfSupportAt: "2028-05-01T00:00:00.000Z",
        warrantyEndAt: "2027-05-01T00:00:00.000Z",
      },
      new Date("2026-04-23T00:00:00.000Z"),
    );

    expect(result.lifecycleStatus).toBe("current");
    expect(result.supportStatus).toBe("supported");
    expect(result.recommendedAction).toBe("monitor");
    expect(result.licensingReviewRequired).toBe(false);
    expect(result.attentionLevel).toBe("low");
  });
});
