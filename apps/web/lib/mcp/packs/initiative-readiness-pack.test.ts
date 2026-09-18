import { beforeEach, describe, expect, it, vi } from "vitest";

import { ok } from "@/lib/shared/action-result";

const mocks = vi.hoisted(() => ({
  findTaskRun: vi.fn(),
  findReads: vi.fn(),
  recordGateReceipt: vi.fn(),
  recordSpecApproval: vi.fn(),
  recordObjectiveMapping: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: { findUnique: (...args: unknown[]) => mocks.findTaskRun(...args) },
    toolExecution: { findMany: (...args: unknown[]) => mocks.findReads(...args) },
  },
}));

vi.mock("@/lib/backlog/initiative-readiness", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/backlog/initiative-readiness")>(),
  recordInitiativeGateReceipt: (...args: unknown[]) => mocks.recordGateReceipt(...args),
  recordInitiativeSpecApproval: (...args: unknown[]) => mocks.recordSpecApproval(...args),
  recordInitiativeObjectiveMappingProposal: (...args: unknown[]) => mocks.recordObjectiveMapping(...args),
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
  record_initiative_post_implementation_review: ["manage_backlog", "initiative_design_review"],
} as const;

describe("initiative readiness reviewer tools", () => {
  it("BI-31159978 rejects positive observations encoded as passing research findings without deleting them", async () => {
    mocks.findTaskRun.mockResolvedValue({ a2aMetadata: {
      trigger: "external-mcp",
      initiativeReviewBinding: {
        writerToolName: "record_initiative_evidence", itemId: "BI-31159978", gate: "research",
        artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo",
          commitSha: "7d22b24673c138036685312387a425984c7a330d",
          providerBlobId: "511894b16063195e4bf9f6977f1f5a3fd0549693", path: "design.md" },
      },
    } });
    mocks.recordGateReceipt.mockResolvedValue({ ok: true, receiptId: "unexpected-receipt" });
    const assessment = { decision: "pass", reason: "The reproduction is complete.",
      findings: [{ issue: "The design clearly documents the ownership boundary.", severity: "important" }],
      resolvedFindingRefs: [] };
    const original = structuredClone(assessment);
    const result = await initiativeReadinessPack.handlers.record_initiative_evidence!(
      assessment, "user-1", { taskRunId: "TR-REPRO", agentId: "AGT-WS-PORTFOLIO" } as never,
    );
    expect(result).toMatchObject({ success: false, error: "malformed-receipt" });
    expect(mocks.recordGateReceipt).not.toHaveBeenCalled();
    expect(assessment).toEqual(original);
    const corrected = await initiativeReadinessPack.handlers.record_initiative_evidence!(
      { ...assessment, findings: [], reason: assessment.reason + " The design clearly documents the ownership boundary." },
      "user-1", { taskRunId: "TR-REPRO", agentId: "AGT-WS-PORTFOLIO" } as never,
    );
    expect(corrected).toMatchObject({ success: true, data: { receiptId: "unexpected-receipt" } });
    expect(mocks.recordGateReceipt).toHaveBeenCalledTimes(1);
  });

  it("requires bound read evidence for a failing finding and preserves a supported finding", async () => {
    const artifactRef = { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo", commitSha: "sha", providerBlobId: "blob", path: "design.md" };
    mocks.findTaskRun.mockResolvedValue({ a2aMetadata: { trigger: "external-mcp", initiativeReviewBinding: {
      writerToolName: "record_initiative_evidence", itemId: "BI-31159978", gate: "research", artifactRef,
    } } });
    const assessment = { decision: "fail", reason: "A verification requirement remains open.", resolvedFindingRefs: [],
      findings: [{ issue: "Verification is unspecified.", severity: "important", evidence: {
        blobId: "blob", startLine: 2, endLine: 2, quote: "Verification: TBD",
      } }] };
    const context = { taskRunId: "TR-BOUND", agentId: "AGT-WS-PORTFOLIO" } as never;
    mocks.findReads.mockResolvedValue([]);
    expect(await initiativeReadinessPack.handlers.record_initiative_evidence!(assessment, "user-1", context))
      .toMatchObject({ success: false, error: "malformed-receipt" });
    expect(mocks.recordGateReceipt).not.toHaveBeenCalled();
    mocks.findReads.mockResolvedValue([{ result: { data: { repositoryFullName: "owner/repo", version: "sha", path: "design.md",
      blobId: "blob", startLine: 1, endLine: 2, content: "# Design\nVerification: TBD" } } }]);
    mocks.recordGateReceipt.mockResolvedValue({ ok: true, receiptId: "failed-receipt" });
    expect(await initiativeReadinessPack.handlers.record_initiative_evidence!(assessment, "user-1", context))
      .toMatchObject({ success: true, data: { receiptId: "failed-receipt" } });
    expect(mocks.recordGateReceipt).toHaveBeenCalledWith(expect.objectContaining({ findings: assessment.findings, decision: "fail" }));
  });

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
      reason: "Independent assessment from the bound artifact.",
      findings: [],
      resolvedFindingRefs: [],
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
      reason: "Independent assessment from the bound artifact.",
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

  it("passes only the server-bound eligible evidence ids to objective-mapping persistence", async () => {
    const eligibleEvidenceActivityIds = ["E-1", "E-2"];
    mocks.findTaskRun.mockResolvedValue({
      a2aMetadata: {
        trigger: "external-mcp",
        initiativeReviewBinding: {
          writerToolName: "record_initiative_evidence",
          itemId: "BI-BOUND",
          gate: "objective-mapping",
          expectedCurrentBaselineId: "baseline-current",
          eligibleEvidenceActivityIds,
          artifactRef: {
            kind: "repo-blob-at-commit",
            repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
            commitSha: "d47536a552c7d588b2f963e478ae99369f720783",
            path: "docs/superpowers/specs/design.md",
            providerBlobId: "fb57e087c19ce0a3c78b4d591bb5da63027c2b3b",
          },
        },
      },
    });
    mocks.recordObjectiveMapping.mockResolvedValue({ ...ok(), proposalId: "MAP-1" });

    await initiativeReadinessPack.handlers.record_initiative_evidence!({
      operation: "objective-mapping",
      baselineId: "baseline-spoofed",
      objectiveMappings: [{ objectiveId: "OBJ-1", evidenceRefs: ["E-1"] }],
      reason: "Bound mapping.",
    }, "user-1", {
      taskRunId: "TR-MCP-MAPPING",
      agentId: "AGT-WS-ACCEPT",
      authorityDecisionId: "AUTH-1",
      tokenScope: "write",
    } as never);

    expect(mocks.recordObjectiveMapping).toHaveBeenCalledWith(expect.objectContaining({
      taskRunId: "TR-MCP-MAPPING",
      itemId: "BI-BOUND",
      baselineId: "baseline-current",
      eligibleEvidenceActivityIds,
    }));
  });
});

describe("the writer schema states its contract before the writer refuses it (BI-9E522F11)", () => {
  // Measured 2026-09-06 on the reference install: four spec-approval attempts
  // in one hour ended malformed-receipt ("A passing spec approval cannot
  // introduce findings"), one CLASSIFICATION_REQUIRED (profile copied from the
  // spec header), one finding-resolution-invalid. Every rule was enforced on
  // the server and stated nowhere the reviewer could read before calling.
  it("tells the reviewer that a pass carries no findings, what profile to name, and what a resolution may cite", () => {
    const tool = initiativeReadinessPack.definitions.find((definition) => definition.name === "record_initiative_design_review");
    const properties = (tool?.inputSchema as { properties: Record<string, { description?: string }> }).properties;
    expect(properties.decision?.description).toMatch(/findings=\[\]/);
    expect(properties.findings?.description).toMatch(/ONLY on a failing receipt/);
    expect(properties.findings?.description).toMatch(/malformed-receipt/);
    expect(properties.profile?.description).toMatch(/authoritative classification/);
    expect(properties.profile?.description).toMatch(/CLASSIFICATION_REQUIRED/);
    expect(properties.resolvedFindingRefs?.description).toMatch(/finding-resolution-invalid/);
  });
});
