import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
    regulation: { findMany: vi.fn(), count: vi.fn() },
    obligation: { count: vi.fn() },
    control: { count: vi.fn() },
    complianceIncident: { count: vi.fn() },
    correctiveAction: { count: vi.fn() },
    policy: { count: vi.fn() },
    regulatoryAlert: { count: vi.fn() },
    complianceSnapshot: { create: vi.fn(), findMany: vi.fn() },
    regulatorySubmission: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    complianceAuditLog: { create: vi.fn() },
    employeeProfile: { findUnique: vi.fn() },
  },
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { takeComplianceSnapshot, getPostureTrend, transitionSubmissionStatus } from "./reporting";

const mockSession = {
  user: { id: "user-1", email: "admin@test.com", platformRole: "HR-000", isSuperuser: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue(mockSession as never);
  vi.mocked(can).mockReturnValue(true);
  vi.mocked(prisma.employeeProfile.findUnique).mockResolvedValue({ id: "emp-1" } as never);
  vi.mocked(prisma.complianceAuditLog.create).mockResolvedValue({} as never);
});

describe("takeComplianceSnapshot", () => {
  it("creates snapshot with denormalized metrics", async () => {
    // Mock all the posture queries
    vi.mocked(prisma.regulation.count).mockResolvedValue(3);
    vi.mocked(prisma.obligation.count).mockResolvedValueOnce(10).mockResolvedValueOnce(8); // total, then covered
    vi.mocked(prisma.control.count).mockResolvedValueOnce(15).mockResolvedValueOnce(12); // total, then implemented
    vi.mocked(prisma.complianceIncident.count).mockResolvedValue(1);
    vi.mocked(prisma.correctiveAction.count).mockResolvedValue(0);
    vi.mocked(prisma.policy.count).mockResolvedValue(5);
    vi.mocked(prisma.regulatoryAlert.count).mockResolvedValue(2);
    vi.mocked(prisma.regulation.findMany).mockResolvedValue([]); // for gap assessment
    vi.mocked(prisma.complianceSnapshot.create).mockResolvedValue({ id: "snap-1" } as never);

    const result = await takeComplianceSnapshot("manual");
    expect(result.ok).toBe(true);
    expect(prisma.complianceSnapshot.create).toHaveBeenCalledOnce();
    expect(prisma.complianceAuditLog.create).toHaveBeenCalledOnce();
  });
});

describe("getPostureTrend", () => {
  it("returns snapshots in reverse chronological order", async () => {
    const mockSnapshots = [
      { snapshotId: "SNAP-2", takenAt: new Date("2026-03-01"), overallScore: 85 },
      { snapshotId: "SNAP-1", takenAt: new Date("2026-02-01"), overallScore: 75 },
    ];
    vi.mocked(prisma.complianceSnapshot.findMany).mockResolvedValue(mockSnapshots as never);

    const trend = await getPostureTrend(12);
    expect(trend).toHaveLength(2);
    expect(trend[0].snapshotId).toBe("SNAP-2");
  });
});

describe("transitionSubmissionStatus", () => {
  it("allows valid transition draft → pending", async () => {
    vi.mocked(prisma.regulatorySubmission.findUniqueOrThrow).mockResolvedValue({ status: "draft" } as never);
    vi.mocked(prisma.regulatorySubmission.update).mockResolvedValue({} as never);

    const result = await transitionSubmissionStatus("sub-1", "pending");
    expect(result.ok).toBe(true);
    expect(prisma.regulatorySubmission.update).toHaveBeenCalledOnce();
  });

  it("rejects invalid transition draft → submitted", async () => {
    vi.mocked(prisma.regulatorySubmission.findUniqueOrThrow).mockResolvedValue({ status: "draft" } as never);

    const result = await transitionSubmissionStatus("sub-1", "submitted");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Cannot transition");
  });

  it("sets submittedAt on transition to submitted", async () => {
    vi.mocked(prisma.regulatorySubmission.findUniqueOrThrow).mockResolvedValue({ status: "pending" } as never);
    vi.mocked(prisma.regulatorySubmission.update).mockResolvedValue({} as never);

    await transitionSubmissionStatus("sub-1", "submitted");

    const updateCall = vi.mocked(prisma.regulatorySubmission.update).mock.calls[0]![0]!;
    expect((updateCall as { data: Record<string, unknown> }).data.submittedAt).toBeInstanceOf(Date);
  });
});
