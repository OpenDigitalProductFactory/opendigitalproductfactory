import { beforeEach, describe, expect, it, vi } from "vitest";

const remote = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock("@/lib/mcp-task-submit", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/mcp-task-submit")>(),
  submitRemoteCoworkerTask: (...args: unknown[]) => remote.submit(...args),
}));

import { dispatchExternalCoworkerTask } from "./external-coworker-task-adapter";
import { createObjectiveMappingRequestKey } from "@/lib/mcp-task-objective-mapping-request-key";

const verifiedContext = {
  apiTokenId: "PAT-1",
  authSource: "pat",
  tokenScope: "write" as const,
  tokenGrantScopes: ["initiative_design_review"],
  callerClient: "claude-code/2.1",
  routeContext: "/platform/build",
  userContext: { platformRole: "developer", isSuperuser: false },
};

const initiativeReviewBinding = {
  writerToolName: "record_initiative_evidence",
  itemId: "BI-9DC21917",
  gate: "research",
  artifactRef: {
    kind: "repo-blob-at-commit" as const,
    repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
    commitSha: "6dad5759f9e88176c59fecd2c13e6d5b5bdd344d",
    path: "docs/superpowers/plans/2026-08-24-local-ci-control-plane-fencing.md",
    providerBlobId: "a".repeat(40),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dispatchExternalCoworkerTask", () => {
  it("fails closed with a reachable action when verified PAT context is absent", async () => {
    const result = await dispatchExternalCoworkerTask({
      collaborationKind: "handoff",
      targetAgent: "AGT-WS-REVIEW",
      objective: "Review immutable design.",
      requestKey: "review:one",
      userId: "user-1",
      context: { callerClient: "codex-cli/0.9" },
    });

    expect(result).toMatchObject({
      success: false,
      error: "external_handoff_context_required",
      data: { action: expect.stringContaining("write-capable personal access token") },
    });
    expect(remote.submit).not.toHaveBeenCalled();
  });

  it("requires a stable request key for a verified external caller", async () => {
    const result = await dispatchExternalCoworkerTask({
      collaborationKind: "summon",
      targetAgent: "AGT-WS-REVIEW",
      objective: "Review immutable design.",
      userId: "user-1",
      context: verifiedContext,
    });

    expect(result).toMatchObject({ success: false, error: "missing_requestKey" });
    expect(remote.submit).not.toHaveBeenCalled();
  });

  it("preserves the exact reviewer packet and verified token authority", async () => {
    remote.submit.mockResolvedValue({
      kind: "result",
      result: { taskRunId: "TR-MCP-123", status: "completed", isError: false },
    });
    const objective =
      "Subject BI-B131F357; immutable commit 544830a220adbda0570da17e391dabd0d429b1fc; design docs/superpowers/specs/recovery.md.";

    const result = await dispatchExternalCoworkerTask({
      collaborationKind: "summon",
      targetAgent: "AGT-WS-REVIEW",
      objective,
      requestKey: "initiative-review:BI-B131F357:544830a",
      title: "Independent initiative design review",
      requiredToolNames: ["read_source_at_version", "record_initiative_evidence"],
      initiativeReviewBinding,
      userId: "user-1",
      context: verifiedContext,
    });

    expect(result).toMatchObject({ success: true, entityId: "TR-MCP-123" });
    expect(remote.submit).toHaveBeenCalledWith({
      token: { tokenId: "PAT-1", userId: "user-1", capability: "write", source: "pat" },
      userContext: verifiedContext.userContext,
      params: {
        agentId: "AGT-WS-REVIEW",
        routeContext: "/platform/build",
        title: "Independent initiative design review",
        objective,
        prompt: objective,
        idempotencyKey: "initiative-review:BI-B131F357:544830a",
        riskClass: "bounded-write",
        authorityScope: [
          "initiative_design_review",
          "backlog-item:BI-9DC21917",
          "tool:read_source_at_version",
          "tool:record_initiative_evidence",
        ],
        initiativeReviewBinding,
        collaborationKind: "summon",
      },
    });
  });

  it("rejects initiative-review tool widening before task submission", async () => {
    const result = await dispatchExternalCoworkerTask({
      collaborationKind: "handoff",
      targetAgent: "AGT-WS-BUILD",
      objective: "Review immutable control-plane evidence.",
      requestKey: "initiative-review:BI-9DC21917:research:6dad5759",
      requiredToolNames: [
        "read_source_at_version",
        "record_initiative_evidence",
        "search_tool_marketplace",
      ],
      initiativeReviewBinding,
      userId: "user-1",
      context: verifiedContext,
    });

    expect(result).toMatchObject({
      success: false,
      error: "invalid_initiative_review_packet",
    });
    expect(remote.submit).not.toHaveBeenCalled();
  });

  it("accepts only the deterministic server-owned objective-mapping key", async () => {
    remote.submit.mockResolvedValue({
      kind: "result",
      result: { taskRunId: "TR-MCP-MAPPING", status: "working", isError: false },
    });
    const objective = "Map the current objectives against the exact post-baseline evidence.";
    const title = "objective-mapping for BI-9DC21917 at 6dad5759f9e8";
    const mappingBinding = {
      ...initiativeReviewBinding,
      gate: "objective-mapping" as const,
      expectedCurrentBaselineId: "baseline-current",
      eligibleEvidenceActivityIds: ["evidence-b", "evidence-a"],
      workroomRef: {
        kind: "workroom-head" as const,
        workroomId: "WC-MAPPING",
        repositoryFullName: initiativeReviewBinding.artifactRef.repositoryFullName,
        branchName: "fix/objective-mapping",
        headSha: initiativeReviewBinding.artifactRef.commitSha,
      },
    };
    const requiredToolNames = ["record_initiative_evidence", "read_source_at_version"];
    const requestKey = createObjectiveMappingRequestKey({
      targetAgent: "AGT-WS-REVIEW",
      objective,
      questionPacketSummary: title,
      requiredToolNames,
      binding: mappingBinding,
    });

    const accepted = await dispatchExternalCoworkerTask({
      collaborationKind: "handoff",
      targetAgent: "AGT-WS-REVIEW",
      objective,
      title,
      requestKey,
      requiredToolNames,
      initiativeReviewBinding: mappingBinding,
      userId: "user-1",
      context: verifiedContext,
    });
    expect(accepted).toMatchObject({ success: true, entityId: "TR-MCP-MAPPING" });

    remote.submit.mockClear();
    const rejected = await dispatchExternalCoworkerTask({
      collaborationKind: "handoff",
      targetAgent: "AGT-WS-REVIEW",
      objective,
      title,
      requestKey: `${requestKey}:caller-churn`,
      requiredToolNames,
      initiativeReviewBinding: mappingBinding,
      userId: "user-1",
      context: verifiedContext,
    });
    expect(rejected).toMatchObject({
      success: false,
      error: "invalid_objective_mapping_request_key",
    });
    expect(remote.submit).not.toHaveBeenCalled();
  });

  it("rejects a search-only review packet that cannot complete immutable evidence traversal", async () => {
    const result = await dispatchExternalCoworkerTask({
      collaborationKind: "handoff",
      targetAgent: "AGT-WS-REVIEW",
      objective: "Review immutable control-plane evidence.",
      requestKey: "initiative-review:BI-9DC21917:research:search-only",
      requiredToolNames: ["search_source_at_version", "record_initiative_evidence"],
      initiativeReviewBinding,
      userId: "user-1",
      context: verifiedContext,
    });

    expect(result).toMatchObject({
      success: false,
      error: "invalid_initiative_review_packet",
      message: expect.stringContaining("read_source_at_version"),
    });
    expect(remote.submit).not.toHaveBeenCalled();
  });

  it("replaces generic tool and backlog scopes with the exact bound review scope", async () => {
    remote.submit.mockResolvedValue({
      kind: "result",
      result: { taskRunId: "TR-MCP-BOUND", status: "working", isError: false },
    });
    await dispatchExternalCoworkerTask({
      collaborationKind: "handoff",
      targetAgent: "AGT-WS-BUILD",
      objective: "Review immutable control-plane evidence.",
      requestKey: "initiative-review:BI-9DC21917:research:6dad5759:bound",
      requiredToolNames: ["read_source_at_version", "record_initiative_evidence"],
      initiativeReviewBinding,
      userId: "user-1",
      context: {
        ...verifiedContext,
        tokenGrantScopes: [
          "initiative_evidence_write",
          "tool:search_tool_marketplace",
          "backlog-item:BI-OTHER",
        ],
      },
    });

    expect(remote.submit).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({
        authorityScope: [
          "initiative_evidence_write",
          "backlog-item:BI-9DC21917",
          "tool:read_source_at_version",
          "tool:record_initiative_evidence",
        ],
      }),
    }));
  });

  it("preserves structured governance refusals from the task owner", async () => {
    remote.submit.mockResolvedValue({
      kind: "result",
      result: {
        isError: true,
        content: [{ type: "text", text: "Issue a write MCP token, then retry." }],
        structuredContent: { error: "insufficient_token_scope", action: "Issue a write MCP token." },
      },
    });

    const result = await dispatchExternalCoworkerTask({
      collaborationKind: "handoff",
      targetAgent: "AGT-WS-REVIEW",
      objective: "Review immutable design.",
      requestKey: "review:read-token",
      userId: "user-1",
      context: { ...verifiedContext, tokenScope: "read" },
    });

    expect(result).toMatchObject({
      success: false,
      error: "insufficient_token_scope",
      message: "Issue a write MCP token, then retry.",
    });
  });

  it("turns task-owner transport failures into an actionable typed refusal", async () => {
    remote.submit.mockRejectedValue(new Error("task service unavailable"));

    const result = await dispatchExternalCoworkerTask({
      collaborationKind: "handoff",
      targetAgent: "AGT-WS-REVIEW",
      objective: "Review immutable design.",
      requestKey: "review:retryable",
      userId: "user-1",
      context: verifiedContext,
    });

    expect(result).toMatchObject({
      success: false,
      error: "remote_handoff_failed",
      message: "task service unavailable",
      data: { action: expect.stringContaining("Retry the same immutable packet") },
    });
  });
});
