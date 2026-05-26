import { describe, expect, it, vi } from "vitest";

const { mockRecordExternalEvidence } = vi.hoisted(() => ({
  mockRecordExternalEvidence: vi.fn().mockResolvedValue({ id: "external-1" }),
}));

vi.mock("@/lib/kernel/load-enforceable-principles", () => ({
  loadEnforceablePrinciples: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/actions/external-evidence", () => ({
  recordExternalEvidence: mockRecordExternalEvidence,
}));

import { executeTool } from "./mcp-tools";

describe("record_external_development_evidence", () => {
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
