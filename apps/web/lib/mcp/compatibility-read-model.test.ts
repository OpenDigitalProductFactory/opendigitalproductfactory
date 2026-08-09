import { describe, expect, it } from "vitest";

import { buildMcpCompatibilityReadModel } from "./compatibility-read-model";

describe("buildMcpCompatibilityReadModel", () => {
  const now = new Date("2026-08-08T18:00:00.000Z");

  it("summarizes clients and remains deny-by-default until every retirement gate is evidenced", () => {
    const model = buildMcpCompatibilityReadModel({
      now,
      earliestObservedAt: new Date("2026-07-01T12:00:00.000Z"),
      aggregates: [
        {
          clientKind: "codex",
          clientVersion: "1.2.0",
          protocolVersion: "2026-07-28",
          protocolEra: "modern",
          tasksExtensionUsed: true,
          resultClass: "success",
          count: 40,
          firstSeenAt: new Date("2026-07-09T12:00:00.000Z"),
          lastSeenAt: new Date("2026-08-08T17:30:00.000Z"),
          peakActiveRequests: 3,
          peakSuspendedTasks: 12,
          peakProcessRssBytes: 536_870_912n,
        },
        {
          clientKind: "claude-code",
          clientVersion: "4.0.0",
          protocolVersion: "2025-11-25",
          protocolEra: "legacy",
          tasksExtensionUsed: false,
          resultClass: "protocol-error",
          count: 2,
          firstSeenAt: new Date("2026-08-07T12:00:00.000Z"),
          lastSeenAt: new Date("2026-08-08T16:00:00.000Z"),
          peakActiveRequests: 2,
          peakSuspendedTasks: 8,
          peakProcessRssBytes: 402_653_184n,
        },
      ],
      retirementEvidence: {
        clientMatrixComplete: true,
        rollbackDrillCompletedAt: "2026-08-06T12:00:00.000Z",
        operatorApprovedAt: null,
      },
    });

    expect(model.summary).toMatchObject({
      totalRequests: 42,
      modernRequests: 40,
      legacyRequests: 2,
      compatibilityFailures: 2,
      modernSharePercent: 95.2,
    });
    expect(model.clients.length).toBeGreaterThanOrEqual(8);
    expect(model.clients.find((client) => client.key === "codex")).toMatchObject({
      clientKind: "Codex",
      currentProtocolEra: "modern",
      conformanceStatus: "conforming",
      tasksExtensionObserved: true,
      requestCount: 40,
    });
    expect(model.clients.find((client) => client.key === "a2a-entry-adapter")).toMatchObject({
      conformanceStatus: "gated",
      blocker: "A2A adapter remains gated on its governed slice",
    });
    expect(model.resources).toMatchObject({
      peakActiveRequests: 3,
      peakSuspendedTasks: 12,
      peakProcessRssMiB: 512,
    });
    expect(model.retirement.ready).toBe(false);
    expect(model.retirement.criteria.find((criterion) => criterion.key === "operator-approval"))
      .toMatchObject({ satisfied: false });
    expect(model.retirement.criteria.find((criterion) => criterion.key === "legacy-traffic"))
      .toMatchObject({ satisfied: false });
  });

  it("reports an honest empty state without implying legacy retirement is safe", () => {
    const model = buildMcpCompatibilityReadModel({
      now,
      earliestObservedAt: null,
      aggregates: [],
      retirementEvidence: null,
    });

    expect(model.summary.totalRequests).toBe(0);
    expect(model.clients.every((client) => client.lastSeenAt === null)).toBe(true);
    expect(model.retirement.ready).toBe(false);
    expect(model.retirement.blockers).toContain("No compatibility observations have been recorded.");
  });
});
