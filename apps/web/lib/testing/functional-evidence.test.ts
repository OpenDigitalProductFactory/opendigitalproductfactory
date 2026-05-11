import { describe, expect, it } from "vitest";
import { buildFunctionalFailureEvidence, redactEvidence } from "./functional-evidence";

describe("functional evidence", () => {
  it("builds backlog-ready failure evidence", () => {
    const evidence = buildFunctionalFailureEvidence({
      testId: "BUILD-41",
      suite: "build-studio",
      route: "/build",
      expected: "header stays within main pane",
      actual: "header overlapped coworker panel",
      screenshotPath: "test-results/build-41/screenshot.png",
      tracePath: "test-results/build-41/trace.zip",
      userRole: "HR-400",
      agentId: "build-specialist",
      routeContext: "/build",
      reproCommand: "pnpm test:e2e -- --project=build-studio -g BUILD-41",
    });

    expect(evidence.likelyOwnerArea).toBe("build-studio");
    expect(evidence.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("redacts sensitive values before attaching evidence", () => {
    const evidence = buildFunctionalFailureEvidence({
      testId: "AUTH-GOV-11",
      suite: "ops-backlog",
      route: "/ops",
      expected: "tool execution appears",
      actual: "Authorization Bearer dpfmcp_secret leaked in log",
      screenshotPath: null,
      tracePath: null,
      userRole: "HR-400",
      agentId: "ops-coordinator",
      routeContext: "/ops",
      reproCommand: "pnpm test:e2e -- --project=ops-backlog -g AUTH-GOV-11",
    });

    expect(redactEvidence(evidence).actual).not.toContain("dpfmcp_secret");
    expect(redactEvidence(evidence).actual).toContain("[redacted-token]");
  });
});
