import { beforeEach, describe, expect, it, vi } from "vitest";

const remote = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock("@/lib/mcp-task-submit", () => ({
  submitRemoteCoworkerTask: (...args: unknown[]) => remote.submit(...args),
}));

import { dispatchExternalCoworkerTask } from "./external-coworker-task-adapter";

const verifiedContext = {
  apiTokenId: "PAT-1",
  authSource: "pat",
  tokenScope: "write" as const,
  tokenGrantScopes: ["initiative_design_review"],
  callerClient: "claude-code/2.1",
  routeContext: "/platform/build",
  userContext: { platformRole: "developer", isSuperuser: false },
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
        authorityScope: ["initiative_design_review"],
        collaborationKind: "summon",
      },
    });
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
