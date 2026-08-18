// EP-SOVEREIGN-SOC P2c — SIEM coworker tool handler tests (mocked Prisma).
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  detectionFindMany: vi.fn(),
  detectionUpdateMany: vi.fn(),
  securityCaseCreate: vi.fn(),
  securityCaseFindUnique: vi.fn(),
  securityCaseUpdate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    securityEvent: { findMany: vi.fn() },
    detection: { findMany: m.detectionFindMany, updateMany: m.detectionUpdateMany },
    securityCase: {
      create: m.securityCaseCreate,
      findUnique: m.securityCaseFindUnique,
      update: m.securityCaseUpdate,
    },
    detectionRule: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

import {
  openSecurityCaseHandler,
  proposeResponseHandler,
  queryDetectionsHandler,
  updateSecurityCaseHandler,
} from "@/lib/mcp/siem-handlers";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("queryDetectionsHandler", () => {
  it("returns the detections found", async () => {
    m.detectionFindMany.mockResolvedValue([
      { detectionKey: "p:r:e1", severity: "high", status: "open", riskScore: 75, lastSeenAt: new Date() },
    ]);
    const res = await queryDetectionsHandler({ status: "open" }, "u1");
    expect(res.success).toBe(true);
    expect(res.data?.count).toBe(1);
  });
});

describe("openSecurityCaseHandler", () => {
  it("creates a case (verdict unknown) and links the given detections", async () => {
    m.securityCaseCreate.mockResolvedValue({ id: "sc1" });
    m.detectionUpdateMany.mockResolvedValue({ count: 2 });
    const res = await openSecurityCaseHandler(
      {
        title: "Suspicious logon burst",
        scopeKey: "customer:acct_1",
        severity: "high",
        detectionKeys: ["p:r:e1", "p:r:e2"],
      },
      "u1",
      { agentId: "AGT-SOC-TRIAGE" },
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("sc1");
    const created = m.securityCaseCreate.mock.calls[0]![0].data;
    expect(created).toMatchObject({ status: "triaging", verdict: "unknown", severity: "high" });
    expect(String(created.caseKey)).toMatch(/^case:manual:/);
    expect(m.detectionUpdateMany).toHaveBeenCalledWith({
      where: { detectionKey: { in: ["p:r:e1", "p:r:e2"] } },
      data: { securityCaseId: "sc1", status: "linked" },
    });
  });

  it("rejects when required fields are missing", async () => {
    const res = await openSecurityCaseHandler({ title: "x" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("missing_fields");
  });
});

describe("updateSecurityCaseHandler", () => {
  it("appends a timeline note and sets the verdict", async () => {
    m.securityCaseFindUnique.mockResolvedValue({ id: "sc1", timeline: [], status: "triaging", verdict: "unknown" });
    m.securityCaseUpdate.mockResolvedValue({ id: "sc1", status: "investigating", verdict: "malicious", confidence: "high" });
    const res = await updateSecurityCaseHandler(
      { caseKey: "case:manual:1", status: "investigating", verdict: "malicious", confidence: "high", timelineNote: "lateral movement confirmed" },
      "u1",
      { agentId: "AGT-SOC-INVESTIGATOR" },
    );
    expect(res.success).toBe(true);
    const data = m.securityCaseUpdate.mock.calls[0]![0].data;
    expect(data.status).toBe("investigating");
    expect(data.verdict).toBe("malicious");
    expect(Array.isArray(data.timeline)).toBe(true);
    expect((data.timeline as unknown[]).length).toBe(1);
  });
});

describe("proposeResponseHandler", () => {
  it("records a response proposal on the case timeline and does NOT execute", async () => {
    m.securityCaseFindUnique.mockResolvedValue({ id: "sc1", timeline: [] });
    m.securityCaseUpdate.mockResolvedValue({ id: "sc1" });
    const res = await proposeResponseHandler(
      { caseKey: "case:manual:1", actionType: "isolate_host", target: "HOST1", reversible: true, blastRadius: "single-host", rationale: "contain" },
      "u1",
      { agentId: "AGT-SOC-IR-LEAD" },
    );
    expect(res.success).toBe(true);
    expect(res.message).toMatch(/NOT executed/);
    // P3: a mutating action (isolate_host = high) is gated needs-human at the band.
    expect(res.data?.authorityDecision).toBe("needs-human-approval");
    expect(res.message).toMatch(/needs-human-approval/);
    const data = m.securityCaseUpdate.mock.calls[0]![0].data;
    const timeline = data.timeline as Array<Record<string, unknown>>;
    expect(timeline[0]).toMatchObject({
      kind: "response-proposal",
      actionType: "isolate_host",
      status: "proposed",
      authorityDecision: "needs-human-approval",
    });
  });
});
