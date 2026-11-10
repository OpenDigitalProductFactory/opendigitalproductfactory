// EP-SOVEREIGN-SOC P1c — correlation sweep unit tests (mocked Prisma).
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDetectionRuleFindMany,
  mockThreatIndicatorFindMany,
  mockSecurityEventFindMany,
  mockDetectionUpsert,
  mockDetectionFindMany,
  mockDetectionUpdateMany,
  mockSecurityCaseFindUnique,
  mockSecurityCaseCreate,
  mockSecurityCaseUpdate,
  mockAgentFindFirst,
  mockUserFindUnique,
} = vi.hoisted(() => ({
  mockDetectionRuleFindMany: vi.fn(),
  mockThreatIndicatorFindMany: vi.fn(),
  mockSecurityEventFindMany: vi.fn(),
  mockDetectionUpsert: vi.fn(),
  mockDetectionFindMany: vi.fn(),
  mockDetectionUpdateMany: vi.fn(),
  mockSecurityCaseFindUnique: vi.fn(),
  mockSecurityCaseCreate: vi.fn(),
  mockSecurityCaseUpdate: vi.fn(),
  mockAgentFindFirst: vi.fn(),
  mockUserFindUnique: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    detectionRule: { findMany: mockDetectionRuleFindMany },
    threatIndicator: { findMany: mockThreatIndicatorFindMany },
    securityEvent: { findMany: mockSecurityEventFindMany },
    detection: {
      upsert: mockDetectionUpsert,
      findMany: mockDetectionFindMany,
      updateMany: mockDetectionUpdateMany,
    },
    securityCase: {
      findUnique: mockSecurityCaseFindUnique,
      create: mockSecurityCaseCreate,
      update: mockSecurityCaseUpdate,
    },
    agent: { findFirst: mockAgentFindFirst },
    user: { findUnique: mockUserFindUnique },
  },
}));

import { runCorrelationSweep } from "./siem-correlation-sweep";

const NOW = new Date("2026-06-25T12:00:00.000Z");

beforeEach(() => {
  vi.resetAllMocks();
  mockThreatIndicatorFindMany.mockResolvedValue([]);
  mockDetectionUpsert.mockResolvedValue({ id: "det_1" });
  // Default: no un-cased detections to group (tests opt in below).
  mockDetectionFindMany.mockResolvedValue([]);
  mockDetectionUpdateMany.mockResolvedValue({ count: 0 });
  mockSecurityCaseFindUnique.mockResolvedValue(null);
  mockSecurityCaseCreate.mockResolvedValue({ id: "case_1" });
  // Default: entity resolves to neither an agent nor a user (hostname/asset).
  mockAgentFindFirst.mockResolvedValue(null);
  mockUserFindUnique.mockResolvedValue(null);
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
      seedPack: false,
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

    const result = await runCorrelationSweep({ seedPack: false });
    expect(result.detectionsUpserted).toBe(0);
    expect(mockDetectionUpsert).not.toHaveBeenCalled();
    expect(result.casesOpened).toBe(0); // nothing un-cased to group
  });

  it("groups open, un-cased detections into a SecurityCase (Detection --> Case)", async () => {
    mockDetectionRuleFindMany.mockResolvedValue([]); // no scan this test
    mockSecurityEventFindMany.mockResolvedValue([]);
    // Two open, un-cased detections about the same host + ATT&CK family → one case.
    mockDetectionFindMany.mockResolvedValue([
      {
        detectionKey: "dpf-kernel:windows-audit-log-cleared:e1",
        scopeKey: "organization:internal",
        customerAccountId: null,
        customerSiteId: null,
        severity: "high",
        firstSeenAt: NOW,
        lastSeenAt: NOW,
        enrichment: { ruleKey: "dpf-kernel:windows-audit-log-cleared", ruleName: "Windows audit log cleared", mitreTechniques: ["T1070.001"], entityKey: "HOST-1" },
      },
      {
        detectionKey: "dpf-kernel:windows-audit-log-cleared:e2",
        scopeKey: "organization:internal",
        customerAccountId: null,
        customerSiteId: null,
        severity: "high",
        firstSeenAt: NOW,
        lastSeenAt: NOW,
        enrichment: { ruleKey: "dpf-kernel:windows-audit-log-cleared", ruleName: "Windows audit log cleared", mitreTechniques: ["T1070.001"], entityKey: "HOST-1" },
      },
    ]);

    const result = await runCorrelationSweep({ seedPack: false });

    expect(result.casesOpened).toBe(1);
    expect(mockSecurityCaseCreate).toHaveBeenCalledTimes(1);
    const created = mockSecurityCaseCreate.mock.calls[0]![0].data;
    expect(created).toMatchObject({
      scopeKey: "organization:internal",
      severity: "high",
      status: "new",
      verdict: "unknown",
    });
    expect(created.caseKey).toContain("attack:T1070.001");
    expect(created.title).toContain("HOST-1");
    // BI-7D1EC4B9: the case carries the detections it was opened from, not {}.
    expect(created.evidence).toMatchObject({
      openedBy: "correlation-sweep",
      detectionCount: 2,
    });
    expect(created.evidence.detectionKeys).toHaveLength(2);
    // Both detections linked to the new case, exactly once.
    expect(mockDetectionUpdateMany).toHaveBeenCalledTimes(1);
    const link = mockDetectionUpdateMany.mock.calls[0]![0];
    expect(link.data).toEqual({ securityCaseId: "case_1" });
    expect(link.where.detectionKey.in).toHaveLength(2);
  });

  it("resolves a User-id actor entity to a name in the case title (BI-7D1EC4B9)", async () => {
    mockDetectionRuleFindMany.mockResolvedValue([]);
    mockSecurityEventFindMany.mockResolvedValue([]);
    // An internal authorization-denied detection whose entity is a bare User cuid.
    mockDetectionFindMany.mockResolvedValue([
      {
        detectionKey: "dpf-kernel:internal-authz-denied:e1",
        scopeKey: "organization:internal",
        customerAccountId: null,
        customerSiteId: null,
        severity: "medium",
        firstSeenAt: NOW,
        lastSeenAt: NOW,
        enrichment: {
          ruleKey: "dpf-kernel:internal-authz-denied",
          ruleName: "Internal authorization denied",
          entityKey: "user-cuid-placeholder",
        },
      },
    ]);
    // No agent by that id; a user resolves.
    mockAgentFindFirst.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue({ email: "admin@dpf.local" });

    const result = await runCorrelationSweep({ seedPack: false });

    expect(result.casesOpened).toBe(1);
    const created = mockSecurityCaseCreate.mock.calls[0]![0].data;
    expect(created.title).toBe("Internal authorization denied — admin@dpf.local");
    expect(created.title).not.toContain("user-cuid-placeholder");
  });

  it("prefers an agent display name when the entity is an agent principal (BI-7D1EC4B9)", async () => {
    mockDetectionRuleFindMany.mockResolvedValue([]);
    mockSecurityEventFindMany.mockResolvedValue([]);
    mockDetectionFindMany.mockResolvedValue([
      {
        detectionKey: "dpf-kernel:internal-authz-denied:e2",
        scopeKey: "organization:internal",
        customerAccountId: null,
        customerSiteId: null,
        severity: "medium",
        firstSeenAt: NOW,
        lastSeenAt: NOW,
        enrichment: {
          ruleKey: "dpf-kernel:internal-authz-denied",
          ruleName: "Internal authorization denied",
          entityKey: "data-architect",
        },
      },
    ]);
    mockAgentFindFirst.mockResolvedValue({ displayName: "Dana (Data Architect)", name: "data-architect", agentId: "data-architect" });

    const result = await runCorrelationSweep({ seedPack: false });

    expect(result.casesOpened).toBe(1);
    const created = mockSecurityCaseCreate.mock.calls[0]![0].data;
    expect(created.title).toBe("Internal authorization denied — Dana (Data Architect)");
  });

  it("merges into an existing case and ratchets severity, no duplicate", async () => {
    mockDetectionRuleFindMany.mockResolvedValue([]);
    mockSecurityEventFindMany.mockResolvedValue([]);
    mockDetectionFindMany.mockResolvedValue([
      {
        detectionKey: "dpf-kernel:aws-mfa-weakened:e9",
        scopeKey: "organization:internal",
        customerAccountId: null,
        customerSiteId: null,
        severity: "high",
        firstSeenAt: NOW,
        lastSeenAt: NOW,
        enrichment: { ruleKey: "dpf-kernel:aws-mfa-weakened", ruleName: "AWS MFA removed", mitreTechniques: ["T1556"], entityKey: "arn:aws:iam::1:user/x" },
      },
    ]);
    mockSecurityCaseFindUnique.mockResolvedValue({ id: "case_existing", severity: "medium" });

    const result = await runCorrelationSweep({ seedPack: false });

    expect(result.casesOpened).toBe(0); // merged, not opened
    expect(mockSecurityCaseCreate).not.toHaveBeenCalled();
    expect(mockSecurityCaseUpdate).toHaveBeenCalledTimes(1); // medium -> high
    expect(mockSecurityCaseUpdate.mock.calls[0]![0].data).toEqual({ severity: "high" });
    expect(mockDetectionUpdateMany).toHaveBeenCalledTimes(1);
  });
});
