import { describe, expect, it } from "vitest";

import { extractDiscoveryTriageSummary } from "./agent-task-scheduler-summary";

describe("extractDiscoveryTriageSummary wrapped tool results", () => {
  it("reads triage metrics from MCP tool-result payloads wrapped under data", () => {
    const summary = extractDiscoveryTriageSummary([
      {
        name: "run_discovery_triage",
        args: { trigger: "cadence" },
        result: {
          success: true,
          message: "Discovery triage processed 3 entities with 0 auto-attributed.",
          data: {
            success: true,
            message: "Discovery triage processed 3 entities with 0 auto-attributed.",
            data: {
              trigger: "cadence",
              processedAt: "2026-07-15T08:01:13.034Z",
              runIdempotencyKey: "2026-07-15:inventory-specialist:cadence",
              metrics: {
                processed: 3,
                decisionsCreated: 3,
                autoAttributed: 0,
                humanReview: 2,
                taxonomyGap: 0,
                needsMoreEvidence: 1,
                dismissed: 0,
                escalationQueueDepth: 2,
                repeatUnresolved: 3,
                autoApplyRate: 0,
              },
            },
          },
        },
      },
    ]);

    expect(summary?.compactStatus).toContain("processed=3");
    expect(summary?.compactStatus).toContain("escalations=2");
    expect(summary?.payload?.metrics).toMatchObject({ decisionsCreated: 3 });
  });
});
