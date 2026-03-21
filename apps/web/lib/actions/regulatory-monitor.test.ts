import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/routed-inference", () => ({ routeAndCall: vi.fn() }));
vi.mock("@/lib/actions/compliance", () => ({ createObligation: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
    regulatoryMonitorScan: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    regulatoryAlert: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    regulation: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    complianceAuditLog: { create: vi.fn() },
    calendarEvent: { create: vi.fn() },
    employeeProfile: { findUnique: vi.fn() },
  },
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { routeAndCall } from "@/lib/routed-inference";
import { createObligation } from "@/lib/actions/compliance";
import {
  triggerRegulatoryMonitorScan,
  reviewAlert,
  dismissAlert,
  createObligationFromAlert,
} from "./regulatory-monitor";

const mockSession = {
  user: { id: "user-1", email: "admin@test.com", platformRole: "HR-000", isSuperuser: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue(mockSession as never);
  vi.mocked(can).mockReturnValue(true);
  vi.mocked(prisma.employeeProfile.findUnique).mockResolvedValue({ id: "emp-1" } as never);
  vi.mocked(prisma.complianceAuditLog.create).mockResolvedValue({} as never);
  vi.mocked(prisma.calendarEvent.create).mockResolvedValue({} as never);
});

describe("triggerRegulatoryMonitorScan", () => {
  it("rejects if scan already running", async () => {
    vi.mocked(prisma.regulatoryMonitorScan.findFirst).mockResolvedValue({ id: "existing" } as never);
    const result = await triggerRegulatoryMonitorScan("manual");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("already in progress");
  });

  it("creates scan and processes regulations", async () => {
    vi.mocked(prisma.regulatoryMonitorScan.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.regulatoryMonitorScan.create).mockResolvedValue({ id: "scan-1", scanId: "SCAN-TEST" } as never);
    vi.mocked(prisma.regulatoryMonitorScan.update).mockResolvedValue({} as never);
    vi.mocked(prisma.regulation.findMany).mockResolvedValue([
      {
        id: "reg-1", name: "GDPR", shortName: "GDPR", jurisdiction: "EU",
        sourceUrl: null, lastKnownVersion: null, sourceCheckDate: null,
      },
    ] as never);
    vi.mocked(prisma.regulation.update).mockResolvedValue({} as never);
    vi.mocked(routeAndCall).mockResolvedValue({
      content: JSON.stringify({
        hasChanged: true, confidence: "high", summary: "New deadline",
        severity: "high", suggestedAction: "Update obligations",
      }),
      inputTokens: 100, outputTokens: 50, toolCalls: [],
      providerId: "test", modelId: "test", downgraded: false, downgradeMessage: null, routeDecision: {} as any,
    } as never);
    vi.mocked(prisma.regulatoryAlert.create).mockResolvedValue({ id: "alert-1" } as never);

    const result = await triggerRegulatoryMonitorScan("manual");
    expect(result.ok).toBe(true);
    expect(prisma.regulatoryAlert.create).toHaveBeenCalledOnce();
    expect(prisma.regulation.update).toHaveBeenCalled(); // sourceCheckDate + changeDetected
  });

  it("skips alert for low confidence changes", async () => {
    vi.mocked(prisma.regulatoryMonitorScan.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.regulatoryMonitorScan.create).mockResolvedValue({ id: "scan-1" } as never);
    vi.mocked(prisma.regulatoryMonitorScan.update).mockResolvedValue({} as never);
    vi.mocked(prisma.regulation.findMany).mockResolvedValue([
      {
        id: "reg-1", name: "SOX", shortName: "SOX", jurisdiction: "US",
        sourceUrl: null, lastKnownVersion: null, sourceCheckDate: null,
      },
    ] as never);
    vi.mocked(prisma.regulation.update).mockResolvedValue({} as never);
    vi.mocked(routeAndCall).mockResolvedValue({
      content: JSON.stringify({
        hasChanged: true, confidence: "low", summary: "Possible change",
        severity: "low", suggestedAction: "Verify",
      }),
      inputTokens: 100, outputTokens: 50, toolCalls: [],
      providerId: "test", modelId: "test", downgraded: false, downgradeMessage: null, routeDecision: {} as any,
    } as never);

    const result = await triggerRegulatoryMonitorScan("manual");
    expect(result.ok).toBe(true);
    expect(prisma.regulatoryAlert.create).not.toHaveBeenCalled();
  });

  it("handles no regulations gracefully", async () => {
    vi.mocked(prisma.regulatoryMonitorScan.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.regulatoryMonitorScan.create).mockResolvedValue({ id: "scan-1" } as never);
    vi.mocked(prisma.regulatoryMonitorScan.update).mockResolvedValue({} as never);
    vi.mocked(prisma.regulation.findMany).mockResolvedValue([]);

    const result = await triggerRegulatoryMonitorScan("manual");
    expect(result.ok).toBe(true);
    expect(result.message).toContain("0 regulations");
  });
});

describe("reviewAlert", () => {
  it("sets status to reviewed with resolution", async () => {
    vi.mocked(prisma.regulatoryAlert.update).mockResolvedValue({} as never);
    vi.mocked(prisma.regulatoryAlert.findUniqueOrThrow).mockResolvedValue({ regulationId: "reg-1" } as never);
    vi.mocked(prisma.regulatoryAlert.count).mockResolvedValue(0);
    vi.mocked(prisma.regulation.update).mockResolvedValue({} as never);

    const result = await reviewAlert("alert-1", "regulation-updated", "Reviewed and updated");
    expect(result.ok).toBe(true);
    expect(prisma.regulatoryAlert.update).toHaveBeenCalledOnce();
  });

  it("rejects invalid resolution", async () => {
    const result = await reviewAlert("alert-1", "bogus");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Resolution must be one of");
  });
});

describe("dismissAlert", () => {
  it("sets status to dismissed", async () => {
    vi.mocked(prisma.regulatoryAlert.update).mockResolvedValue({} as never);
    vi.mocked(prisma.regulatoryAlert.findUniqueOrThrow).mockResolvedValue({ regulationId: "reg-1" } as never);
    vi.mocked(prisma.regulatoryAlert.count).mockResolvedValue(0);
    vi.mocked(prisma.regulation.update).mockResolvedValue({} as never);

    const result = await dismissAlert("alert-1", "False positive");
    expect(result.ok).toBe(true);
  });
});

describe("createObligationFromAlert", () => {
  it("creates obligation and marks alert actioned", async () => {
    vi.mocked(createObligation).mockResolvedValue({ ok: true, message: "Created", id: "obl-1" } as never);
    vi.mocked(prisma.regulatoryAlert.update).mockResolvedValue({} as never);

    const result = await createObligationFromAlert("alert-1", {
      title: "New breach deadline",
      regulationId: "reg-1",
    });

    expect(result.ok).toBe(true);
    expect(createObligation).toHaveBeenCalledOnce();
    expect(prisma.regulatoryAlert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "actioned", resolution: "obligation-created" }),
      }),
    );
  });
});
