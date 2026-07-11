import { beforeEach, describe, expect, it, vi } from "vitest";

const deliberation = vi.hoisted(() => ({
  startDeliberation: vi.fn(),
  getDeliberationStatus: vi.fn(),
  getDeliberationOutcome: vi.fn(),
}));
vi.mock("@/lib/actions/deliberation", () => deliberation);

import { deliberationRunPack } from "./deliberation-run-pack";
import { TOOL_TO_GRANTS, isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "start_deliberation",
  "get_deliberation_status",
  "get_deliberation_outcome",
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deliberation-run pack — registration", () => {
  it("exposes exactly the three deliberation-run lifecycle tools", () => {
    expect(deliberationRunPack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(deliberationRunPack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of deliberationRunPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("preserves each tool's gating shape (requiredCapability view_platform)", () => {
    for (const d of deliberationRunPack.definitions) {
      expect(d.requiredCapability).toBe("view_platform");
    }
  });

  it("preserves start_deliberation's proposal execution mode + status/outcome as read-only immediate", () => {
    const byName = Object.fromEntries(deliberationRunPack.definitions.map((d) => [d.name, d]));
    expect(byName.start_deliberation.executionMode).toBe("proposal");
    expect(byName.start_deliberation.sideEffect).toBe(true);
    expect(typeof byName.start_deliberation.autoApproveWhen).toBe("function");
    expect(byName.get_deliberation_status.executionMode).toBe("immediate");
    expect(byName.get_deliberation_status.sideEffect).toBe(false);
    expect(byName.get_deliberation_outcome.sideEffect).toBe(false);
  });

  it("mirrors the agent-grant gating source exactly (R3 no-drift)", () => {
    for (const [name, grants] of Object.entries(deliberationRunPack.grants)) {
      expect(TOOL_TO_GRANTS[name], name).toEqual(grants);
    }
    expect(deliberationRunPack.grants.start_deliberation).toEqual(["deliberation_create"]);
    expect(isToolAllowedByGrants("start_deliberation", ["deliberation_create"])).toBe(true);
    expect(isToolAllowedByGrants("start_deliberation", ["deliberation_read"])).toBe(false);
    expect(isToolAllowedByGrants("get_deliberation_status", ["deliberation_read"])).toBe(true);
    expect(isToolAllowedByGrants("get_deliberation_outcome", ["deliberation_read"])).toBe(true);
  });

  it("start_deliberation auto-approves only stage/risk-triggered invocations", async () => {
    const def = deliberationRunPack.definitions.find((d) => d.name === "start_deliberation")!;
    const predicate = def.autoApproveWhen!;
    expect(await predicate({ userId: "u1", params: { triggerSource: "stage" } })).toBe(true);
    expect(await predicate({ userId: "u1", params: { triggerSource: "risk" } })).toBe(true);
    expect(await predicate({ userId: "u1", params: { triggerSource: "explicit" } })).toBe(false);
    expect(await predicate({ userId: "u1", params: {} })).toBe(false);
  });
});

describe("deliberation-run pack — handler behavior (delegation preserved)", () => {
  it("start_deliberation delegates with coerced params and returns the run envelope", async () => {
    deliberation.startDeliberation.mockResolvedValue({
      deliberationRunId: "DR-1",
      triggerSource: "stage",
      reason: "started",
    });
    const res = await deliberationRunPack.handlers.start_deliberation(
      {
        patternSlug: "review",
        artifactType: "plan",
        strategyProfile: "balanced",
        maxBranches: 3,
        budgetUsd: 5,
        stage: "plan",
        riskLevel: "medium",
      },
      "u1",
      { routeContext: "/build", threadId: "t-1" },
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("DR-1");
    expect(res.message).toBe("started");
    expect((res.data as { triggerSource: string }).triggerSource).toBe("stage");
    expect(deliberation.startDeliberation).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        patternSlug: "review",
        artifactType: "plan",
        strategyProfile: "balanced",
        maxBranches: 3,
        budgetUsd: 5,
        stage: "plan",
        riskLevel: "medium",
        routeContext: "/build",
        threadId: "t-1",
      }),
    );
  });

  it("start_deliberation falls back to the context routeContext when none is supplied", async () => {
    deliberation.startDeliberation.mockResolvedValue({ deliberationRunId: "DR-2", triggerSource: "explicit", reason: "ok" });
    await deliberationRunPack.handlers.start_deliberation(
      { patternSlug: "debate", artifactType: "spec" },
      "u1",
      { routeContext: "/platform" },
    );
    expect(deliberation.startDeliberation).toHaveBeenCalledWith(
      expect.objectContaining({ routeContext: "/platform", maxBranches: undefined, budgetUsd: undefined }),
    );
  });

  it("start_deliberation returns a constant failure message (no tainted format string)", async () => {
    deliberation.startDeliberation.mockRejectedValue(new Error("boom-detail"));
    const res = await deliberationRunPack.handlers.start_deliberation(
      { patternSlug: "review", artifactType: "plan" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("boom-detail");
    expect(res.message).toBe("start_deliberation failed");
  });

  it("get_deliberation_status returns the consensus snapshot", async () => {
    deliberation.getDeliberationStatus.mockResolvedValue({ deliberationRunId: "DR-3", consensusState: "converging" });
    const res = await deliberationRunPack.handlers.get_deliberation_status({ deliberationRunId: "DR-3" }, "u1");
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("DR-3");
    expect(res.message).toContain("converging");
    expect(deliberation.getDeliberationStatus).toHaveBeenCalledWith({ deliberationRunId: "DR-3", userId: "u1" });
  });

  it("get_deliberation_status surfaces errors in both error and message", async () => {
    deliberation.getDeliberationStatus.mockRejectedValue(new Error("nope"));
    const res = await deliberationRunPack.handlers.get_deliberation_status({ deliberationRunId: "x" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("nope");
    expect(res.message).toContain("get_deliberation_status failed: nope");
  });

  it("get_deliberation_outcome summarizes a synthesized outcome", async () => {
    deliberation.getDeliberationOutcome.mockResolvedValue({
      outcome: { recommendation: "ship" },
      claims: [{}, {}],
      evidenceBundles: [{}],
    });
    const res = await deliberationRunPack.handlers.get_deliberation_outcome({ deliberationRunId: "DR-4" }, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toContain("2 claim(s), 1 bundle(s)");
    expect(deliberation.getDeliberationOutcome).toHaveBeenCalledWith({ deliberationRunId: "DR-4", userId: "u1" });
  });

  it("get_deliberation_outcome reports not-yet-synthesized when outcome is absent", async () => {
    deliberation.getDeliberationOutcome.mockResolvedValue({ outcome: null, claims: [], evidenceBundles: [] });
    const res = await deliberationRunPack.handlers.get_deliberation_outcome({ deliberationRunId: "DR-5" }, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toBe("Outcome not yet synthesized.");
  });
});
