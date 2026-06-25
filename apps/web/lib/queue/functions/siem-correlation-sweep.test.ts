// EP-SOVEREIGN-SOC P1c — correlation sweep unit tests (mocked Prisma).
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDetectionRuleFindMany,
  mockThreatIndicatorFindMany,
  mockSecurityEventFindMany,
  mockDetectionUpsert,
} = vi.hoisted(() => ({
  mockDetectionRuleFindMany: vi.fn(),
  mockThreatIndicatorFindMany: vi.fn(),
  mockSecurityEventFindMany: vi.fn(),
  mockDetectionUpsert: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    detectionRule: { findMany: mockDetectionRuleFindMany },
    threatIndicator: { findMany: mockThreatIndicatorFindMany },
    securityEvent: { findMany: mockSecurityEventFindMany },
    detection: { upsert: mockDetectionUpsert },
  },
}));

import { runCorrelationSweep } from "./siem-correlation-sweep";

const NOW = new Date("2026-06-25T12:00:00.000Z");

beforeEach(() => {
  vi.resetAllMocks();
  mockThreatIndicatorFindMany.mockResolvedValue([]);
  mockDetectionUpsert.mockResolvedValue({ id: "det_1" });
});

describe("runCorrelationSweep", () => {
  it("upserts a detection when an enabled rule matches an event", async () => {
    mockDetectionRuleFindMany.mockResolvedValue([
      {
        id: "r1",
        ruleKey: "pack:cloudtrail-delete",
        name: "Destructive S3 op",
        severity: "high",
        scopeKey: "kernel",
        enabled: true,
        predicate: {
          sourceKind: "aws.cloudtrail",
          equals: { path: "api.operation", value: "DeleteBucket" },
        },
        mitreTechniques: ["T1485"],
      },
    ]);
    mockSecurityEventFindMany.mockResolvedValue([
      {
        eventKey: "e1",
        ocsfClassUid: 6003,
        severityId: 2,
        sourceKind: "aws.cloudtrail",
        scopeKey: "customer:acct_1",
        customerAccountId: "acct_1",
        customerSiteId: null,
        time: NOW,
        observables: [],
        normalized: { api: { operation: "DeleteBucket" } },
      },
    ]);

    const result = await runCorrelationSweep({
      since: new Date("2026-06-25T11:00:00.000Z"),
    });

    expect(result.detectionsUpserted).toBe(1);
    expect(result.eventsScanned).toBe(1);
    expect(result.rules).toBe(1);
    expect(mockDetectionUpsert).toHaveBeenCalledTimes(1);
    const arg = mockDetectionUpsert.mock.calls[0]![0];
    expect(arg.where).toEqual({ detectionKey: "pack:cloudtrail-delete:e1" });
    expect(arg.create).toMatchObject({
      ruleId: "r1",
      severity: "high",
      scopeKey: "customer:acct_1",
      customerAccountId: "acct_1",
      status: "open",
    });
  });

  it("emits nothing when no rule matches the event", async () => {
    mockDetectionRuleFindMany.mockResolvedValue([
      {
        id: "r1",
        ruleKey: "pack:windows-only",
        name: "Windows only",
        severity: "low",
        scopeKey: "kernel",
        enabled: true,
        predicate: { sourceKind: "windows.security" },
        mitreTechniques: [],
      },
    ]);
    mockSecurityEventFindMany.mockResolvedValue([
      {
        eventKey: "e1",
        ocsfClassUid: 6003,
        severityId: 1,
        sourceKind: "aws.cloudtrail",
        scopeKey: "customer:acct_1",
        customerAccountId: "acct_1",
        customerSiteId: null,
        time: NOW,
        observables: [],
        normalized: {},
      },
    ]);

    const result = await runCorrelationSweep();
    expect(result.detectionsUpserted).toBe(0);
    expect(mockDetectionUpsert).not.toHaveBeenCalled();
  });
});
