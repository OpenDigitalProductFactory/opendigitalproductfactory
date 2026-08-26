import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findTaskRun: vi.fn(),
  recordGateReceipt: vi.fn(),
  recordSpecApproval: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: { findUnique: (...args: unknown[]) => mocks.findTaskRun(...args) },
  },
}));

vi.mock("@/lib/backlog/initiative-readiness", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/backlog/initiative-readiness")>(),
  recordInitiativeGateReceipt: (...args: unknown[]) => mocks.recordGateReceipt(...args),
  recordInitiativeSpecApproval: (...args: unknown[]) => mocks.recordSpecApproval(...args),
}));

import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";
import { initiativeReadinessPack } from "./initiative-readiness-pack";

const expected = {
  record_initiative_evidence: ["manage_backlog", "initiative_evidence_write"],
  record_initiative_design_review: ["manage_backlog", "initiative_design_review"],
  record_initiative_architecture_review: ["manage_ea_model", "initiative_architecture_review"],
  record_initiative_data_review: ["manage_ea_model", "initiative_data_review"],
  record_initiative_ux_review: ["manage_backlog", "initiative_ux_review"],
  record_initiative_security_review: ["manage_compliance", "initiative_security_review"],
  record_initiative_compliance_review: ["manage_compliance", "initiative_compliance_review"],
  record_initiative_domain_review: ["manage_backlog", "initiative_domain_review"],
  record_initiative_archetype_review: ["manage_taxonomy", "initiative_archetype_review"],
} as const;

describe("initiative readiness reviewer tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("assigns one exact capability and one exact grant to every thin lane", () => {
    for (const [name, [capability, grant]] of Object.entries(expected)) {
      const definition = initiativeReadinessPack.definitions.find((candidate) => candidate.name === name);
      expect(definition?.requiredCapability).toBe(capability);
      expect(initiativeReadinessPack.grants[name]).toEqual([grant]);
      expect(TOOL_TO_GRANTS[name]).toEqual([grant]);
    }
  });

  it("does not expose a parameterized cross-lane reviewer tool", () => {
    expect(initiativeReadinessPack.definitions.map((definition) => definition.name)).not.toContain("record_initiative_review");
  });

  it("keeps objective evidence as a proposal operation on the non-approval tool", () => {
    const evidence = initiativeReadinessPack.definitions.find((definition) => definition.name === "record_initiative_evidence")!;
    expect(evidence.inputSchema.properties).toHaveProperty("objectiveMappings");
    expect(evidence.inputSchema.properties).toHaveProperty("baselineId");
    expect(initiativeReadinessPack.definitions.find((definition) => definition.name === "record_initiative_design_review")?.inputSchema.properties)
      .not.toHaveProperty("objectiveMappings");
  });

  it("accepts finding issues but never caller-selected stable finding IDs", () => {
    for (const definition of initiativeReadinessPack.definitions) {
      expect(definition.inputSchema.properties).toHaveProperty("findings");
      expect(definition.inputSchema.properties).not.toHaveProperty("findingRefs");
    }
  });

  it("fails closed on malformed finding arrays and findings attached to a passing spec approval", async () => {
    const handler = initiativeReadinessPack.handlers.record_initiative_design_review!;
    const base = {
      itemId: "BI-TEST",
      gate: "spec-approval",
      decision: "pass",
      artifactRef: { kind: "document-version", versionId: "version-1" },
      reason: "Reviewed.",
      resolvedFindingRefs: [],
      profile: "feature",
      artifactRole: "design-spec",
    };

    await expect(handler({ ...base, findings: [{ severity: "important" }] }, "user-1", {} as never))
      .resolves.toMatchObject({ success: false, error: "malformed-receipt" });
    await expect(handler({
      ...base,
      findings: [{ issue: "Unresolved scope gap", severity: "important" }],
    }, "user-1", {} as never)).resolves.toMatchObject({ success: false, error: "malformed-receipt" });
  });

  it("derives immutable receipt identity from the exact external TaskRun binding", async () => {
    const artifactRef = {
      kind: "repo-blob-at-commit",
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      commitSha: "d47536a552c7d588b2f963e478ae99369f720783",
      path: "docs/superpowers/specs/2026-08-23-initiative-readiness-traversal-repair-design.md",
      providerBlobId: "fb57e087c19ce0a3c78b4d591bb5da63027c2b3b",
    };
    mocks.findTaskRun.mockResolvedValue({
      a2aMetadata: {
        trigger: "external-mcp",
        initiativeReviewBinding: {
          writerToolName: "record_initiative_evidence",
          itemId: "BI-F0715C9C",
          gate: "research",
          artifactRef,
        },
      },
    });
    mocks.recordGateReceipt.mockResolvedValue({ ok: true, receiptId: "IRR-RESEARCH-1" });

    const result = await initiativeReadinessPack.handlers.record_initiative_evidence!({
      itemId: "BI-SPOOFED",
      gate: "classification",
      artifactRef: { kind: "document-version", versionId: "spoofed" },
      decision: "pass",
    }, "user-1", {
      taskRunId: "TR-MCP-BOUND",
      agentId: "AGT-WS-BUILD",
      tokenScope: "write",
    } as never);

    expect(mocks.findTaskRun).toHaveBeenCalledWith({
      where: { taskRunId: "TR-MCP-BOUND" },
      select: { a2aMetadata: true },
    });
    expect(mocks.recordGateReceipt).toHaveBeenCalledWith(expect.objectContaining({
      itemId: "BI-F0715C9C",
      gate: "research",
      artifactRef,
      decision: "pass",
      findings: [],
      resolvedFindingRefs: [],
      reason: "Independent reviewer AGT-WS-BUILD recorded pass for the immutable research artifact bound to TaskRun TR-MCP-BOUND.",
    }));
    expect(result).toMatchObject({ success: true, entityId: "IRR-RESEARCH-1" });
  });

  it("uses the server-bound spec baseline precondition even when model arguments spoof string null", async () => {
    const artifactRef = {
      kind: "repo-blob-at-commit",
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      commitSha: "d47536a552c7d588b2f963e478ae99369f720783",
      path: "docs/superpowers/specs/2026-08-23-initiative-readiness-traversal-repair-design.md",
      providerBlobId: "fb57e087c19ce0a3c78b4d591bb5da63027c2b3b",
    };
    mocks.findTaskRun.mockResolvedValue({
      a2aMetadata: {
        trigger: "external-mcp",
        initiativeReviewBinding: {
          writerToolName: "record_initiative_design_review",
          itemId: "BI-F0715C9C",
          gate: "spec-approval",
          expectedCurrentBaselineId: null,
          artifactRef,
        },
      },
    });
    mocks.recordSpecApproval.mockResolvedValue({ ok: true, baselineId: "IBL-1", receiptId: "IRR-1" });

    const result = await initiativeReadinessPack.handlers.record_initiative_design_review!({
      decision: "pass",
      reason: "Complete.",
      findings: [],
      resolvedFindingRefs: [],
      profile: "fix",
      artifactRole: "design-spec",
      expectedCurrentBaselineId: "null",
      supersessionDispositions: [],
    }, "user-1", { taskRunId: "TR-MCP-SPEC", agentId: "AGT-WS-REVIEW", tokenScope: "write" } as never);

    expect(mocks.recordSpecApproval).toHaveBeenCalledWith(expect.objectContaining({
      itemId: "BI-F0715C9C",
      artifactRef,
      expectedCurrentBaselineId: null,
    }));
    expect(result).toMatchObject({ success: true, entityId: "IBL-1" });
  });
});
