import { describe, it, expect, vi } from "vitest";
import {
  applyRiskEnvelopeToOrgProfile,
  type ApplyRiskEnvelopeClient,
} from "./apply-risk-envelope-to-profile";

type UpdateManyArg = {
  where: Record<string, unknown>;
  data: { autonomyPolicy: Record<string, unknown> };
};

function fakeDb(riskPosture: string | null) {
  const updateMany = vi.fn(async (_args: unknown) => ({ count: 1 }));
  const findUnique = vi.fn(async (_args: unknown) => ({ riskPosture }));
  const db: ApplyRiskEnvelopeClient = {
    businessContext: { findUnique },
    decisionPerspectiveProfile: { updateMany },
  };
  return { db, updateMany };
}

describe("applyRiskEnvelopeToOrgProfile", () => {
  it("writes the conservative policy scoped to the org's organization profile", async () => {
    const { db, updateMany } = fakeDb("conservative");
    await applyRiskEnvelopeToOrgProfile({ organizationId: "org-1", db });

    expect(updateMany).toHaveBeenCalledTimes(1);
    const arg = updateMany.mock.calls[0]![0] as UpdateManyArg;
    expect(arg.where).toEqual({ ownerOrganizationId: "org-1", kind: "organization" });
    expect(arg.data.autonomyPolicy.allowArbitration).toBe(false);
    expect(arg.data.autonomyPolicy.minimumConfidenceForArbitration).toBe(0.95);
  });

  it("writes the balanced identity policy when posture is unset", async () => {
    const { db, updateMany } = fakeDb(null);
    await applyRiskEnvelopeToOrgProfile({ organizationId: "org-1", db });

    const arg = updateMany.mock.calls[0]![0] as UpdateManyArg;
    expect(arg.data.autonomyPolicy).toEqual({
      allowRecommendation: true,
      allowArbitration: false,
      maxRiskForArbitration: "low",
      minimumConfidenceForRecommendation: 0.55,
      minimumConfidenceForArbitration: 0.9,
    });
  });

  it("is fail-open — swallows db errors and never throws", async () => {
    const db: ApplyRiskEnvelopeClient = {
      businessContext: {
        findUnique: vi.fn(async (_args: unknown) => {
          throw new Error("boom");
        }),
      },
      decisionPerspectiveProfile: { updateMany: vi.fn(async (_args: unknown) => ({ count: 0 })) },
    };
    await expect(
      applyRiskEnvelopeToOrgProfile({ organizationId: "org-1", db }),
    ).resolves.toBeUndefined();
  });
});
