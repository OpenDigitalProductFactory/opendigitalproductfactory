import { vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {} }));

import { describe, expect, it } from "vitest";

import { extractDiscoveryTriageSummary } from "./agent-task-scheduler-summary";

describe("extractDiscoveryTriageSummary", () => {
  it("builds a compact status string and thread payload for executed triage runs", () => {
    const summary = extractDiscoveryTriageSummary([
      {
        name: "run_discovery_triage",
        args: { trigger: "cadence" },
        result: {
          success: true,
          message: "ok",
          data: {
            trigger: "cadence",
            processedAt: "2026-04-25T18:00:00.000Z",
        runIdempotencyKey: "2026-04-25:inventory-specialist:cadence",
            metrics: {
              processed: 4,
              decisionsCreated: 4,
              autoAttributed: 2,
              humanReview: 1,
              taxonomyGap: 1,
              needsMoreEvidence: 0,
              dismissed: 0,
              escalationQueueDepth: 2,
              repeatUnresolved: 1,
              autoApplyRate: 0.5,
            },
          },
        },
      },
    ]);

    expect(summary).not.toBeNull();
    expect(summary?.compactStatus).toContain("Discovery triage cadence");
    expect(summary?.compactStatus).toContain("processed=4");
    expect(summary?.compactStatus).toContain("taxonomy-gaps=1");
    expect(summary?.threadMessage).toContain("[Scheduled summary: discovery taxonomy gap triage]");
    expect(summary?.threadMessage).toContain("\"runIdempotencyKey\": \"2026-04-25:inventory-specialist:cadence\"");
  });

  it("reports skipped triage runs with the idempotency key", () => {
    const summary = extractDiscoveryTriageSummary([
      {
        name: "run_discovery_triage",
        args: { trigger: "volume" },
        result: {
          success: true,
          message: "skipped",
          data: {
            trigger: "volume",
            processedAt: "2026-04-25T18:00:00.000Z",
        runIdempotencyKey: "2026-04-25:inventory-specialist:volume",
            skipped: true,
            skipReason: "Duplicate volume triage run already recorded today.",
            metrics: {
              processed: 0,
              autoAttributed: 0,
              escalationQueueDepth: 0,
              taxonomyGap: 0,
            },
          },
        },
      },
    ]);

    expect(summary).not.toBeNull();
    expect(summary?.compactStatus).toContain("skipped");
    expect(summary?.compactStatus).toContain("[2026-04-25:inventory-specialist:volume]");
    expect(summary?.threadMessage).toContain("Duplicate volume triage run already recorded today.");
    expect(summary?.threadMessage).toContain("\"skipped\": true");
  });

  it("returns null when no discovery triage tool execution is present", () => {
    const summary = extractDiscoveryTriageSummary([
      {
        name: "query_backlog",
        args: {},
        result: {
          success: true,
          message: "ok",
          data: { rows: [] },
        },
      },
    ]);

    expect(summary).toBeNull();
  });
});
