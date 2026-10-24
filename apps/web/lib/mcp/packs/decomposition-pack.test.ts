import { beforeEach, describe, expect, it, vi } from "vitest";

const svc = vi.hoisted(() => ({
  assessComplexity: vi.fn(),
  validateDecompositionPlan: vi.fn(),
  proposeDecomposition: vi.fn(),
  approveDecomposition: vi.fn(),
  recordDecompositionOverride: vi.fn(),
  recordPlanBacklogCoverage: vi.fn(),
  checkPlanBacklogCoverage: vi.fn(),
  checkBranchPlanBacklogGate: vi.fn(),
}));
vi.mock("@/lib/complexity-assessment", () => ({
  assessComplexity: (...a: unknown[]) => svc.assessComplexity(...a),
}));
vi.mock("@/lib/decomposition", () => ({
  validateDecompositionPlan: (...a: unknown[]) => svc.validateDecompositionPlan(...a),
}));
vi.mock("@/lib/build/propose-decomposition", () => ({
  proposeDecomposition: (...a: unknown[]) => svc.proposeDecomposition(...a),
}));
vi.mock("@/lib/build/approve-decomposition", () => ({
  approveDecomposition: (...a: unknown[]) => svc.approveDecomposition(...a),
}));
vi.mock("@/lib/build/decomposition-override", () => ({
  recordDecompositionOverride: (...a: unknown[]) => svc.recordDecompositionOverride(...a),
}));
vi.mock("@/lib/planning/plan-backlog-coverage", () => ({
  recordPlanBacklogCoverage: (...a: unknown[]) => svc.recordPlanBacklogCoverage(...a),
  checkPlanBacklogCoverage: (...a: unknown[]) => svc.checkPlanBacklogCoverage(...a),
  checkBranchPlanBacklogGate: (...a: unknown[]) => svc.checkBranchPlanBacklogGate(...a),
}));

import { decompositionPack } from "./decomposition-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "assess_complexity",
  "propose_decomposition",
  "propose_build_decomposition",
  "approve_decomposition",
  "record_decomposition_override",
  "record_plan_backlog_coverage",
  "check_plan_backlog_coverage",
  "check_branch_plan_backlog_gate",
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("decomposition pack — registration", () => {
  it("exposes every decomposition and plan-coverage tool with a handler", () => {
    expect(decompositionPack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(decompositionPack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of decompositionPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("grants mirror agent-grants: read/write/phase-advance categories per tool", () => {
    expect(decompositionPack.grants.assess_complexity).toEqual(["backlog_read"]);
    expect(decompositionPack.grants.propose_decomposition).toEqual(["backlog_write"]);
    expect(decompositionPack.grants.propose_build_decomposition).toEqual(["build_phase_advance"]);
    expect(decompositionPack.grants.approve_decomposition).toEqual(["build_phase_advance"]);
    expect(decompositionPack.grants.record_decomposition_override).toEqual(["build_phase_advance"]);
    expect(decompositionPack.grants.record_plan_backlog_coverage).toEqual(["backlog_write"]);
    expect(decompositionPack.grants.check_plan_backlog_coverage).toEqual(["backlog_read"]);
    expect(decompositionPack.grants.check_branch_plan_backlog_gate).toEqual(["backlog_read"]);

    expect(isToolAllowedByGrants("assess_complexity", ["backlog_read"])).toBe(true);
    expect(isToolAllowedByGrants("propose_decomposition", ["backlog_write"])).toBe(true);
    expect(isToolAllowedByGrants("propose_build_decomposition", ["build_phase_advance"])).toBe(true);
    expect(isToolAllowedByGrants("approve_decomposition", ["build_phase_advance"])).toBe(true);
    expect(isToolAllowedByGrants("record_decomposition_override", ["build_phase_advance"])).toBe(true);
    expect(isToolAllowedByGrants("record_plan_backlog_coverage", ["backlog_write"])).toBe(true);
    expect(isToolAllowedByGrants("check_plan_backlog_coverage", ["backlog_read"])).toBe(true);
    expect(isToolAllowedByGrants("check_branch_plan_backlog_gate", ["backlog_read"])).toBe(true);
  });
});

describe("decomposition pack — handler behavior (delegation preserved)", () => {
  it("assess_complexity delegates scores and reports the path", async () => {
    svc.assessComplexity.mockReturnValue({ total: 14, path: "complex" });
    const res = await decompositionPack.handlers.assess_complexity(
      { taxonomySpan: 2, dataEntities: 3, integrations: 1, novelty: 2, regulatory: 1, costEstimate: 2, techDebt: 3 },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.message).toContain("14/21");
    expect(res.message).toContain("complex path");
    const scores = svc.assessComplexity.mock.calls[0][0] as { taxonomySpan: number };
    expect(scores.taxonomySpan).toBe(2);
  });

  it("propose_decomposition returns an invalid result without materializing", async () => {
    svc.validateDecompositionPlan.mockReturnValue({ valid: false, errors: ["missing feature sets"] });
    const res = await decompositionPack.handlers.propose_decomposition(
      { epicTitle: "E", epicDescription: "D", featureSets: [] },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("missing feature sets");
  });

  it("propose_build_decomposition rejects a non-FB build id before delegating", async () => {
    const res = await decompositionPack.handlers.propose_build_decomposition({ buildId: "nope" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("invalid_buildId");
    expect(svc.proposeDecomposition).not.toHaveBeenCalled();
  });

  it("propose_build_decomposition threads userId and agentId into the service", async () => {
    svc.proposeDecomposition.mockResolvedValue({ ok: true, candidates: [{}, {}], rejected: [] });
    const res = await decompositionPack.handlers.propose_build_decomposition(
      { buildId: "FB-123", operatorHint: "smaller" },
      "actor-9",
      { agentId: "agent-7" },
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("FB-123");
    const arg = svc.proposeDecomposition.mock.calls[0][0] as { userId: string; agentId: string; operatorHint: string };
    expect(arg.userId).toBe("actor-9");
    expect(arg.agentId).toBe("agent-7");
    expect(arg.operatorHint).toBe("smaller");
  });

  it("approve_decomposition rejects a non-object candidate", async () => {
    const res = await decompositionPack.handlers.approve_decomposition(
      { buildId: "FB-1", candidate: "not-an-object" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("invalid_candidate");
    expect(svc.approveDecomposition).not.toHaveBeenCalled();
  });

  it("record_decomposition_override surfaces the service failure code", async () => {
    svc.recordDecompositionOverride.mockResolvedValue({ ok: false, code: "not_required", error: "not a decompose-required build" });
    const res = await decompositionPack.handlers.record_decomposition_override(
      { buildId: "FB-9", rationale: "keep as one" },
      "u1",
      { agentId: "a1" },
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("not_required");
  });

  it("record_plan_backlog_coverage returns a governed receipt", async () => {
    svc.recordPlanBacklogCoverage.mockResolvedValue({
      ok: true,
      receiptId: "receipt-1",
      decision: "decomposed",
      mappedItemIds: ["BI-1", "BI-2"],
    });
    const res = await decompositionPack.handlers.record_plan_backlog_coverage(
      {
        itemId: "BI-PARENT",
        planPath: "docs/superpowers/plans/example.md",
        planArtifactRef: {
          kind: "repo-blob-at-commit",
          repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
          commitSha: "a".repeat(40),
          path: "docs/superpowers/plans/example.md",
          providerBlobId: "b".repeat(40),
        },
        decision: "decomposed",
        deliverables: [
          {
            key: "one",
            title: "One",
            independentlyShippable: true,
            backlogItemId: "BI-1",
            dependsOn: [],
            requirementRefs: ["OBJ-1"],
            contractRefs: ["contract:1"],
            flowRefs: ["flow:1"],
            verificationRefs: ["AC-1"],
          },
        ],
      },
      "user-1",
      { agentId: "agent-1" },
    );

    expect(res).toMatchObject({ success: true, entityId: "receipt-1" });
    expect(svc.recordPlanBacklogCoverage).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: "BI-PARENT", userId: "user-1", agentId: "agent-1" }),
    );
  });

  it("forwards a canonical fix design path to the server-authoritative coverage writer", async () => {
    svc.recordPlanBacklogCoverage.mockResolvedValue({
      ok: true,
      receiptId: "receipt-fix",
      decision: "atomic",
      mappedItemIds: [],
    });
    const fixPath = "docs/superpowers/specs/fix-design.md";
    const res = await decompositionPack.handlers.record_plan_backlog_coverage(
      {
        itemId: "BI-FIX",
        planPath: fixPath,
        planArtifactRef: {
          kind: "repo-blob-at-commit",
          repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
          commitSha: "a".repeat(40),
          path: fixPath,
          providerBlobId: "b".repeat(40),
        },
        decision: "atomic",
        rationale: "This ordered repair is one indivisible compatibility boundary.",
        deliverables: [],
      },
      "user-1",
    );

    expect(res).toMatchObject({ success: true, entityId: "receipt-fix" });
    expect(svc.recordPlanBacklogCoverage).toHaveBeenCalledWith(expect.objectContaining({ planPath: fixPath }));
  });

  it("check_plan_backlog_coverage revalidates a receipt without writing", async () => {
    svc.checkPlanBacklogCoverage.mockResolvedValue({
      ok: true,
      valid: true,
      decision: "atomic",
      mappedItemIds: [],
    });
    const res = await decompositionPack.handlers.check_plan_backlog_coverage(
      {
        itemId: "BI-PARENT",
        planPath: "docs/superpowers/plans/example.md",
        receiptId: "receipt-1",
      },
      "user-1",
    );

    expect(res).toMatchObject({ success: true, data: { valid: true, decision: "atomic" } });
    expect(svc.checkPlanBacklogCoverage).toHaveBeenCalledWith(expect.objectContaining({
      itemId: "BI-PARENT",
      receiptId: "receipt-1",
    }));
  });

  it("check_branch_plan_backlog_gate requires a decision for claimed xlarge work", async () => {
    svc.checkBranchPlanBacklogGate.mockResolvedValue({
      ok: false,
      required: true,
      code: "decomposition-decision-required",
      error: "decision required",
      itemId: "BI-PARENT",
    });
    const res = await decompositionPack.handlers.check_branch_plan_backlog_gate(
      { branchName: "fix/xlarge-plan" },
      "user-1",
    );
    expect(res).toMatchObject({ success: false, error: "decomposition-decision-required" });
    expect(svc.checkBranchPlanBacklogGate).toHaveBeenCalledWith({ branchName: "fix/xlarge-plan" });
  });
});
