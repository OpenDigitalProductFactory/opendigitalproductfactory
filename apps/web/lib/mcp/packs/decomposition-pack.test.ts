import { beforeEach, describe, expect, it, vi } from "vitest";

const svc = vi.hoisted(() => ({
  assessComplexity: vi.fn(),
  validateDecompositionPlan: vi.fn(),
  proposeDecomposition: vi.fn(),
  approveDecomposition: vi.fn(),
  recordDecompositionOverride: vi.fn(),
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

import { decompositionPack } from "./decomposition-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "assess_complexity",
  "propose_decomposition",
  "propose_build_decomposition",
  "approve_decomposition",
  "record_decomposition_override",
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("decomposition pack — registration", () => {
  it("exposes exactly the five decomposition tools with a handler each", () => {
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

    expect(isToolAllowedByGrants("assess_complexity", ["backlog_read"])).toBe(true);
    expect(isToolAllowedByGrants("propose_decomposition", ["backlog_write"])).toBe(true);
    expect(isToolAllowedByGrants("propose_build_decomposition", ["build_phase_advance"])).toBe(true);
    expect(isToolAllowedByGrants("approve_decomposition", ["build_phase_advance"])).toBe(true);
    expect(isToolAllowedByGrants("record_decomposition_override", ["build_phase_advance"])).toBe(true);
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
});
