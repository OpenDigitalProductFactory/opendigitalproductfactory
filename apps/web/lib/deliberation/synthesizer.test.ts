// apps/web/lib/deliberation/synthesizer.test.ts
// Task 6 — Synthesizer tests.
//
// Covers:
//   - consensus when all surviving branches agree
//   - partial-consensus when majority agrees
//   - no-consensus when branches diverge
//   - insufficient-evidence when no surviving branches
//   - budget-halted metadata surfaces on the outcome

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  outcomeCreate: vi.fn(),
  issueSetCreate: vi.fn(),
  runUpdate: vi.fn(),
  claimCreate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    deliberationOutcome: { create: mocks.outcomeCreate },
    deliberationIssueSet: { create: mocks.issueSetCreate },
    deliberationRun: { update: mocks.runUpdate },
    claimRecord: { create: mocks.claimCreate },
  },
}));

import {
  synthesizeDeliberation,
  detectConsensusState,
  type BranchArtifact,
} from "./synthesizer";

let claimCounter = 0;

beforeEach(() => {
  vi.clearAllMocks();
  claimCounter = 0;
  mocks.outcomeCreate.mockResolvedValue({});
  mocks.issueSetCreate.mockResolvedValue({});
  mocks.runUpdate.mockResolvedValue({});
  mocks.claimCreate.mockImplementation(async () => ({
    id: `claim-${++claimCounter}`,
  }));
});

function makeBranch(
  overrides: Partial<BranchArtifact> &
    Pick<BranchArtifact, "branchNodeId" | "role" | "completed">,
): BranchArtifact {
  return {
    assertions: [],
    objections: [],
    rebuttals: [],
    ...overrides,
  };
}

describe("detectConsensusState", () => {
  it("returns consensus when all branches produce the same recommendation", () => {
    const branches: BranchArtifact[] = [
      { branchNodeId: "b1", role: "reviewer", completed: true, recommendation: "ship" },
      { branchNodeId: "b2", role: "reviewer", completed: true, recommendation: "ship" },
    ];
    expect(detectConsensusState(branches, false)).toBe("consensus");
  });

  it("returns partial-consensus when majority agrees", () => {
    const branches: BranchArtifact[] = [
      { branchNodeId: "b1", role: "reviewer", completed: true, recommendation: "ship" },
      { branchNodeId: "b2", role: "reviewer", completed: true, recommendation: "ship" },
      { branchNodeId: "b3", role: "reviewer", completed: true, recommendation: "block" },
    ];
    expect(detectConsensusState(branches, false)).toBe("partial-consensus");
  });

  it("returns no-consensus when every branch disagrees", () => {
    const branches: BranchArtifact[] = [
      { branchNodeId: "b1", role: "debater", completed: true, recommendation: "option A" },
      { branchNodeId: "b2", role: "debater", completed: true, recommendation: "option B" },
      { branchNodeId: "b3", role: "debater", completed: true, recommendation: "option C" },
      { branchNodeId: "b4", role: "debater", completed: true, recommendation: "option D" },
    ];
    expect(detectConsensusState(branches, false)).toBe("no-consensus");
  });

  it("returns insufficient-evidence when zero branches completed", () => {
    const branches: BranchArtifact[] = [
      { branchNodeId: "b1", role: "reviewer", completed: false },
      { branchNodeId: "b2", role: "reviewer", completed: false },
    ];
    expect(detectConsensusState(branches, false)).toBe("insufficient-evidence");
  });

  it("returns insufficient-evidence when budget-halted AND < 2 recommendations", () => {
    const branches: BranchArtifact[] = [
      { branchNodeId: "b1", role: "reviewer", completed: true, recommendation: "ship" },
      { branchNodeId: "b2", role: "reviewer", completed: false },
    ];
    expect(detectConsensusState(branches, true)).toBe("insufficient-evidence");
  });
});

describe("synthesizeDeliberation", () => {
  it("persists DeliberationOutcome + IssueSet + updates DeliberationRun", async () => {
    const branches: BranchArtifact[] = [
      makeBranch({
        branchNodeId: "b1",
        role: "reviewer",
        completed: true,
        recommendation: "ship",
        assertions: [{ claimText: "tests pass", evidenceGrade: "A" }],
      }),
      makeBranch({
        branchNodeId: "b2",
        role: "reviewer",
        completed: true,
        recommendation: "ship",
        assertions: [{ claimText: "design sound", evidenceGrade: "B" }],
      }),
    ];

    const result = await synthesizeDeliberation({
      deliberationRunId: "delib-1",
      artifactType: "code-change",
      branches,
    });

    expect(mocks.outcomeCreate).toHaveBeenCalledTimes(1);
    expect(mocks.issueSetCreate).toHaveBeenCalledTimes(1);
    expect(mocks.runUpdate).toHaveBeenCalledTimes(1);
    expect(result.outcome.consensusState).toBe("consensus");
    expect(result.outcome.confidence).toBeGreaterThan(0);
    expect(result.claimRecordIds.length).toBe(2);
    expect(result.compactSummary.evidenceBadge).toBe("source-backed");
  });

  it("records insufficient-evidence when no branches survived", async () => {
    const branches: BranchArtifact[] = [
      makeBranch({
        branchNodeId: "b1",
        role: "reviewer",
        completed: false,
        failureReason: "rate-limited",
      }),
      makeBranch({
        branchNodeId: "b2",
        role: "reviewer",
        completed: false,
        failureReason: "no endpoint",
      }),
    ];

    const result = await synthesizeDeliberation({
      deliberationRunId: "delib-2",
      artifactType: "spec",
      branches,
    });
    expect(result.outcome.consensusState).toBe("insufficient-evidence");
    expect(result.outcome.branchCompletionRoster.every((r) => !r.completed)).toBe(true);
    expect(result.outcome.mergedRecommendation).toMatch(/insufficient/i);
  });

  it("records no-consensus when branches disagree materially", async () => {
    const branches: BranchArtifact[] = [
      makeBranch({
        branchNodeId: "b1",
        role: "debater",
        completed: true,
        recommendation: "pick A",
      }),
      makeBranch({
        branchNodeId: "b2",
        role: "debater",
        completed: true,
        recommendation: "pick B",
      }),
    ];
    const result = await synthesizeDeliberation({
      deliberationRunId: "delib-3",
      artifactType: "architecture-decision",
      branches,
    });
    expect(result.outcome.consensusState).toBe("no-consensus");
  });

  it("records partial-consensus when majority agrees", async () => {
    const branches: BranchArtifact[] = [
      makeBranch({ branchNodeId: "b1", role: "reviewer", completed: true, recommendation: "ship" }),
      makeBranch({ branchNodeId: "b2", role: "reviewer", completed: true, recommendation: "ship" }),
      makeBranch({ branchNodeId: "b3", role: "skeptic", completed: true, recommendation: "block" }),
    ];
    const result = await synthesizeDeliberation({
      deliberationRunId: "delib-4",
      artifactType: "code-change",
      branches,
    });
    expect(result.outcome.consensusState).toBe("partial-consensus");
  });

  it("surfaces budgetHalted in outcome metadata", async () => {
    const branches: BranchArtifact[] = [
      makeBranch({
        branchNodeId: "b1",
        role: "reviewer",
        completed: true,
        recommendation: "ship",
      }),
    ];
    const result = await synthesizeDeliberation({
      deliberationRunId: "delib-5",
      artifactType: "code-change",
      branches,
      budgetHalted: true,
    });
    expect(result.outcome.metadata.budgetHalted).toBe(true);
    expect(result.outcome.rationaleSummary).toMatch(/budget/i);
  });

  it("includes branch roster so callers see completion vs failure", async () => {
    const branches: BranchArtifact[] = [
      makeBranch({
        branchNodeId: "b1",
        role: "reviewer",
        completed: true,
        recommendation: "ship",
      }),
      makeBranch({
        branchNodeId: "b2",
        role: "reviewer",
        completed: false,
        failureReason: "no endpoint",
      }),
    ];
    const result = await synthesizeDeliberation({
      deliberationRunId: "delib-6",
      artifactType: "code-change",
      branches,
    });
    expect(result.outcome.branchCompletionRoster.length).toBe(2);
    const failed = result.outcome.branchCompletionRoster.find((r) => !r.completed);
    expect(failed?.failureReason).toBe("no endpoint");
  });

  it("persists ClaimRecord rows per assertion/objection/rebuttal", async () => {
    const branches: BranchArtifact[] = [
      makeBranch({
        branchNodeId: "b1",
        role: "reviewer",
        completed: true,
        recommendation: "ship",
        assertions: [{ claimText: "A1", evidenceGrade: "A" }],
        objections: [{ claimText: "O1", evidenceGrade: "B" }],
        rebuttals: [{ claimText: "R1", evidenceGrade: "A" }],
      }),
    ];
    await synthesizeDeliberation({
      deliberationRunId: "delib-7",
      artifactType: "code-change",
      branches,
    });
    expect(mocks.claimCreate).toHaveBeenCalledTimes(3);
    const types = mocks.claimCreate.mock.calls.map((c) => c[0].data.claimType);
    expect(types).toContain("assertion");
    expect(types).toContain("objection");
    expect(types).toContain("rebuttal");
  });

  it("surfaces unresolved risks from objections", async () => {
    const branches: BranchArtifact[] = [
      makeBranch({
        branchNodeId: "b1",
        role: "skeptic",
        completed: true,
        objections: [{ claimText: "Untested migration path", evidenceGrade: "B" }],
      }),
      makeBranch({
        branchNodeId: "b2",
        role: "reviewer",
        completed: true,
        recommendation: "ship",
      }),
    ];
    const result = await synthesizeDeliberation({
      deliberationRunId: "delib-8",
      artifactType: "code-change",
      branches,
    });
    expect(result.outcome.unresolvedRisks).toContain("Untested migration path");
  });
});
