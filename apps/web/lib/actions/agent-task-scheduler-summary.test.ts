import { describe, expect, it } from "vitest";

import {
  extractDiscoveryTriageSummary,
  extractHiveScoutSummary,
} from "./agent-task-scheduler-summary";

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

describe("extractHiveScoutSummary market-aperture metrics (BI-B8E4317D)", () => {
  const baseData = {
    catalogEntries: 112,
    gaps: 32,
    created: 0,
    duplicates: 32,
    needsReview: 0,
  };

  it("surfaces market-source counts in the payload and compact status", () => {
    const summary = extractHiveScoutSummary([
      {
        name: "run_hive_scout_ingest",
        args: {},
        result: {
          success: true,
          message: "ok",
          data: {
            ...baseData,
            marketSources: { enabled: true, attempted: 10, fetched: 9, changed: 4, failed: 1, material: [], failures: [] },
          },
        },
      },
    ] as never);

    expect(summary?.payload?.metrics).toMatchObject({
      marketSourcesAttempted: 10,
      marketSourcesFetched: 9,
      marketSourcesChanged: 4,
      marketSourcesFailed: 1,
    });
    expect(summary?.compactStatus).toContain("market-fetched=9/10");
    expect(summary?.compactStatus).toContain("market-changed=4");
    expect(summary?.compactStatus).toContain("market-failed=1");
  });

  it("stays backward compatible with runs that predate the market pass", () => {
    const summary = extractHiveScoutSummary([
      { name: "run_hive_scout_ingest", args: {}, result: { success: true, message: "ok", data: baseData } },
    ] as never);

    expect(summary?.payload?.metrics).not.toHaveProperty("marketSourcesAttempted");
    expect(summary?.compactStatus).not.toContain("market-fetched");
  });
});
