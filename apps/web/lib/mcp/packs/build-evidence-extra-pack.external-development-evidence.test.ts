import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRecordExternalEvidence, capture } = vi.hoisted(() => ({
  mockRecordExternalEvidence: vi.fn().mockResolvedValue({ id: "external-1" }),
  capture: vi.fn().mockResolvedValue("WC-test-1"),
}));
vi.mock("@/lib/identity/principal-linking", () => ({
  syncUserPrincipal: vi.fn(async (userId: string) => ({ id: `human-${userId}` })),
  ensureAgentPrincipalIdentity: vi.fn(async (agentId: string) => ({ id: `assistant-${agentId}` })),
}));

vi.mock("@/lib/kernel/load-enforceable-principles", () => ({
  loadEnforceablePrinciples: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/actions/external-evidence", () => ({
  recordExternalEvidence: mockRecordExternalEvidence,
}));

// Hermeticity (BI-BFDCE0A9): the handler runs an owner check
// (`prisma.featureBuild.findUnique`) and a best-effort capsule capture before
// returning. Neither is the unit under test, but against an unmocked prisma with
// no ambient Postgres the owner check throws, executeTool catches it, and the
// tool returns success:false — so this test used to pass ONLY where a DB was
// wired (CI shards) and fail in every DB-less run (fresh worktree, pre-push
// gate). Stub the DB-touching seams so the test asserts the handler's own
// contract, not the presence of a database. mcp-tools.ts imports only `prisma`
// and `DISCOVERY_TRIAGE_AGENT_ID` from @dpf/db, so preserving the rest of the
// module and replacing just `prisma` is sufficient.
vi.mock("@dpf/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dpf/db")>();
  return {
    ...actual,
    prisma: {
      featureBuild: { findUnique: vi.fn().mockResolvedValue(null) },
    },
  };
});

vi.mock("@/lib/work-capsules/external-session-capture", () => ({
  captureExternalSessionEvidence: capture,
}));

import { executeTool } from "@/lib/mcp-tools";

describe("record_external_development_evidence", () => {
  beforeEach(() => { capture.mockReset().mockResolvedValue("WC-test-1"); mockRecordExternalEvidence.mockClear(); });

  it("captures the authenticated human and assistant identities for room admission", async () => {
    const result = await executeTool("record_external_development_evidence", {
      provider: "codex", externalSessionId: "author-session", summary: "Source verification", routeContext: "/build",
    }, "author", { agentId: "AGT-EXT-CODEX", authSource: "oauth" });
    expect(result.success).toBe(true);
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ actor: {
      userId: "author", agentId: "AGT-EXT-CODEX", principalId: "human-author", agentPrincipalId: "assistant-AGT-EXT-CODEX",
    } }));
  });

  it("preserves the original evidence when room capture is refused", async () => {
    capture.mockRejectedValueOnce(new Error("You are not authorized to change this workroom"));
    const result = await executeTool("record_external_development_evidence", {
      provider: "codex", externalSessionId: "author-session", summary: "Source verification", routeContext: "/build",
    }, "author", { agentId: "AGT-EXT-CODEX", authSource: "oauth" });
    expect(result.success).toBe(true);
    expect(mockRecordExternalEvidence).toHaveBeenCalledTimes(1);
    expect(result.data).toMatchObject({ workCapsuleId: null });
  });
  it("records external handoff evidence with build and integration details", async () => {
    const result = await executeTool("record_external_development_evidence", {
      provider: "codex",
      externalSessionId: "codex-1",
      buildId: "FB-1",
      taskRunId: "TR-1",
      routeContext: "/build",
      summary: "Merged-code gate passed.",
      commits: ["abc123"],
      changedFiles: ["apps/web/lib/build/decision-service.ts"],
      verification: ["pnpm --filter web typecheck"],
      localIntegration: { status: "passed", mode: "single-branch" },
      unresolvedQuestions: ["Should the founder review queue group by reason?"],
      skillIds: ["dpf-local-merge-ci-before-push"],
    }, "user-1", { routeContext: "/build" });

    expect(result.success).toBe(true);
    expect(mockRecordExternalEvidence).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "user-1",
      routeContext: "/build",
      operationType: "external_development_handoff",
      target: "codex-1",
      provider: "codex",
      resultSummary: "Merged-code gate passed.",
      buildId: "FB-1",
      taskRunId: "TR-1",
      details: expect.objectContaining({
        commits: ["abc123"],
        changedFiles: ["apps/web/lib/build/decision-service.ts"],
        verification: ["pnpm --filter web typecheck"],
        localIntegration: { status: "passed", mode: "single-branch" },
        unresolvedQuestions: ["Should the founder review queue group by reason?"],
        skillIds: ["dpf-local-merge-ci-before-push"],
      }),
    }));
  });
});
