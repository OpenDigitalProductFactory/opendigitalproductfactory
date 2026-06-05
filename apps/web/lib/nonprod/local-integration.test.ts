import { describe, expect, it, vi } from "vitest";

const { mockRecordExternalEvidence } = vi.hoisted(() => ({
  mockRecordExternalEvidence: vi.fn().mockResolvedValue({ id: "external-1" }),
}));

vi.mock("@/lib/actions/external-evidence", () => ({
  recordExternalEvidence: mockRecordExternalEvidence,
}));

import { recordLocalIntegrationResult } from "./local-integration";

describe("recordLocalIntegrationResult", () => {
  it("records local integration output as external evidence", async () => {
    await recordLocalIntegrationResult({
      actorUserId: "user-1",
      provider: "codex",
      externalSessionId: "codex-session-1",
      routeContext: "/build",
      buildId: "FB-1",
      taskRunId: "TR-1",
      candidateBranch: "feat/build-studio-decision-skills-slice-1",
      mode: "single-branch",
      status: "passed",
      summary: "Merged-code gate passed.",
      evidence: { commands: ["pnpm --filter web typecheck"] },
    });

    expect(mockRecordExternalEvidence).toHaveBeenCalledWith({
      actorUserId: "user-1",
      routeContext: "/build",
      operationType: "local_integration_ci",
      target: "feat/build-studio-decision-skills-slice-1",
      provider: "codex",
      resultSummary: "Merged-code gate passed.",
      buildId: "FB-1",
      taskRunId: "TR-1",
      details: {
        externalSessionId: "codex-session-1",
        mode: "single-branch",
        status: "passed",
        evidence: { commands: ["pnpm --filter web typecheck"] },
      },
    });
  });
});
