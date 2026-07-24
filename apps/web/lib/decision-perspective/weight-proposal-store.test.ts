import { describe, expect, it, vi } from "vitest";
import {
  persistWeightAdjustmentProposals,
  ruleWeightAdjustmentProposal,
  listOpenWeightAdjustmentProposals,
} from "./weight-proposal-store";
import type { WeightAdjustmentProposal } from "./weight-inference";

function proposal(overrides: Partial<WeightAdjustmentProposal> = {}): WeightAdjustmentProposal {
  return {
    domainClass: "risk-assessment",
    profileId: "prof-1",
    axis: "speed_to_value",
    direction: "increase",
    consistency: 0.8,
    meanSeparation: 0.4,
    sampleSize: 10,
    entersAtTier: "proposed",
    entersAtConfidenceWeight: 0.3,
    ...overrides,
  };
}

function fakeDb(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    weightAdjustmentProposal: {
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      ...overrides,
    },
  };
}

describe("persistWeightAdjustmentProposals", () => {
  it("creates a new proposal keyed on (profileId, domainClass, axis)", async () => {
    const db = fakeDb();
    const result = await persistWeightAdjustmentProposals(db, [proposal()]);
    expect(db.weightAdjustmentProposal.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { proposalId: "wap:prof-1:risk-assessment:speed_to_value" },
        create: expect.objectContaining({ status: "proposed", direction: "increase" }),
      }),
    );
    expect(result.proposalIds).toEqual(["wap:prof-1:risk-assessment:speed_to_value"]);
  });

  it("refreshes an existing still-open proposal instead of duplicating it", async () => {
    const db = fakeDb({ findFirst: vi.fn().mockResolvedValue({ status: "proposed" }) });
    await persistWeightAdjustmentProposals(db, [proposal({ consistency: 0.95 })]);
    expect(db.weightAdjustmentProposal.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ consistency: 0.95 }) }),
    );
  });

  it("never overwrites a proposal a human already ruled or rejected", async () => {
    const db = fakeDb({ findFirst: vi.fn().mockResolvedValue({ status: "ruled" }) });
    const result = await persistWeightAdjustmentProposals(db, [proposal()]);
    expect(db.weightAdjustmentProposal.upsert).not.toHaveBeenCalled();
    expect(result.skippedAlreadyRuled).toEqual(["wap:prof-1:risk-assessment:speed_to_value"]);
  });
});

describe("ruleWeightAdjustmentProposal", () => {
  it("accepting reaches status=ruled", async () => {
    const db = fakeDb({ findFirst: vi.fn().mockResolvedValue({ status: "proposed" }) });
    const result = await ruleWeightAdjustmentProposal(db, {
      proposalId: "wap:1",
      ruling: "accept",
      ruledByUserId: "user-1",
    });
    expect(result).toEqual({ ok: true, status: "ruled" });
    expect(db.weightAdjustmentProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ruled", ruledByUserId: "user-1" }) }),
    );
  });

  it("rejecting reaches status=rejected and records the reason", async () => {
    const db = fakeDb({ findFirst: vi.fn().mockResolvedValue({ status: "proposed" }) });
    const result = await ruleWeightAdjustmentProposal(db, {
      proposalId: "wap:1",
      ruling: "reject",
      ruledByUserId: "user-1",
      rejectionReason: "learned fatigue, not preference",
    });
    expect(result).toEqual({ ok: true, status: "rejected" });
    expect(db.weightAdjustmentProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "rejected", rejectionReason: "learned fatigue, not preference" }),
      }),
    );
  });

  it("returns not-found for an unknown proposalId, never throws", async () => {
    const db = fakeDb({ findFirst: vi.fn().mockResolvedValue(null) });
    const result = await ruleWeightAdjustmentProposal(db, {
      proposalId: "missing",
      ruling: "accept",
      ruledByUserId: "user-1",
    });
    expect(result).toEqual({ ok: false, error: "not-found" });
    expect(db.weightAdjustmentProposal.update).not.toHaveBeenCalled();
  });

  it("refuses to re-rule an already-ruled proposal", async () => {
    const db = fakeDb({ findFirst: vi.fn().mockResolvedValue({ status: "ruled" }) });
    const result = await ruleWeightAdjustmentProposal(db, {
      proposalId: "wap:1",
      ruling: "reject",
      ruledByUserId: "user-1",
    });
    expect(result).toEqual({ ok: false, error: "already-ruled" });
    expect(db.weightAdjustmentProposal.update).not.toHaveBeenCalled();
  });
});

describe("listOpenWeightAdjustmentProposals", () => {
  it("queries only status=proposed rows", async () => {
    const db = fakeDb();
    await listOpenWeightAdjustmentProposals(db);
    expect(db.weightAdjustmentProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "proposed" } }),
    );
  });
});
