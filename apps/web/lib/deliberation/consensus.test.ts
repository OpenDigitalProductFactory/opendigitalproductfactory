import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  featureBuildUpdate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: {
      update: mocks.featureBuildUpdate,
    },
  },
}));

import {
  applyConsensusOutcome,
  computeConsensus,
  type BranchVote,
  type ConsensusDecision,
  type DeliberationSummary,
} from "./consensus";

const vote = (overrides: Partial<BranchVote> = {}): BranchVote => ({
  roleSlug: "reviewer",
  confidence: 0.9,
  criticalObjection: false,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("computeConsensus", () => {
  it("escalates when any branch has a critical objection", () => {
    const result = computeConsensus([
      vote({ roleSlug: "author", confidence: 0.99 }),
      vote({ roleSlug: "reviewer", confidence: 0.99 }),
      vote({ roleSlug: "qa", confidence: 0.99 }),
      vote({ roleSlug: "security", confidence: 0.99 }),
      vote({
        roleSlug: "skeptic",
        confidence: 0.99,
        criticalObjection: true,
        objectionText: "Missing acceptance evidence.",
      }),
    ]);

    expect(result.decision).toBe("escalate");
    expect(result.confidence).toBe(0);
    expect(result.objections).toEqual(["Missing acceptance evidence."]);
  });

  it("escalates mixed low-confidence votes with mean confidence", () => {
    const result = computeConsensus([
      vote({ roleSlug: "author", confidence: 0.9 }),
      vote({ roleSlug: "reviewer", confidence: 0.4 }),
    ]);

    expect(result).toEqual({ decision: "escalate", confidence: 0.65 });
  });

  it("escalates with zero confidence and an objection when there are no branch votes", () => {
    const result = computeConsensus([]);

    expect(result).toEqual({
      decision: "escalate",
      confidence: 0,
      objections: ["no branches"],
    });
  });

  it("approves when every branch has high confidence and no critical objection", () => {
    const result = computeConsensus([
      vote({ roleSlug: "author", confidence: 0.9 }),
      vote({ roleSlug: "reviewer", confidence: 0.9 }),
      vote({ roleSlug: "skeptic", confidence: 0.9 }),
    ]);

    expect(result).toEqual({ decision: "approve", confidence: 0.9 });
  });

  it("recommends when branches have moderate confidence and no critical objection", () => {
    const result = computeConsensus([
      vote({ roleSlug: "reviewer", confidence: 0.75 }),
      vote({ roleSlug: "skeptic", confidence: 0.75 }),
    ]);

    expect(result).toEqual({ decision: "recommend", confidence: 0.75 });
  });

  it("types objections as strings, not BranchVote objects", () => {
    expectTypeOf<ConsensusDecision["objections"]>().toEqualTypeOf<
      string[] | undefined
    >();
    expectTypeOf<DeliberationSummary["objections"]>().toEqualTypeOf<string[]>();
  });
});

describe("applyConsensusOutcome", () => {
  it("maps escalation to a failed review and persists the compact summary", async () => {
    mocks.featureBuildUpdate.mockResolvedValue({});
    const branches = [
      vote({
        roleSlug: "skeptic",
        confidence: 0.4,
        criticalObjection: true,
        objectionText: "Critical plan gap.",
      }),
    ];
    const decision = computeConsensus(branches);

    const result = await applyConsensusOutcome({
      buildId: "FB-123",
      deliberationRunId: "delib-1",
      consensusDecision: decision,
      branches,
    });

    expect(result.decision).toBe("fail");
    expect(result.issues[0]?.description).toBe("Critical plan gap.");
    expect(mocks.featureBuildUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildId: "FB-123" },
        data: expect.objectContaining({
          deliberationSummary: expect.objectContaining({
            hitl: true,
            confidence: 0,
            objections: ["Critical plan gap."],
            branches,
          }),
        }),
      }),
    );
  });

  it("supports an injected prisma client and writes branches to FeatureBuild.deliberationSummary", async () => {
    const update = vi.fn().mockResolvedValue({});
    const db = {
      featureBuild: {
        update,
      },
    };
    const branches = [
      vote({
        roleSlug: "skeptic",
        confidence: 0.4,
        criticalObjection: true,
        objectionText: "Critical plan gap.",
      }),
    ];
    const escalateOutcome: ConsensusDecision = {
      decision: "escalate",
      confidence: 0,
      objections: ["Critical plan gap."],
    };

    await applyConsensusOutcome("FB-test", escalateOutcome, branches, db as never);

    expect(update).toHaveBeenCalledWith({
      where: { buildId: "FB-test" },
      data: {
        deliberationSummary: {
          hitl: true,
          confidence: 0,
          objections: ["Critical plan gap."],
          branches,
        },
      },
    });
  });
});
