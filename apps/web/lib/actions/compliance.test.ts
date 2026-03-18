import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  can: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    regulation: {
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    obligation: {
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    control: {
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    controlObligationLink: {
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    complianceEvidence: {
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    complianceIncident: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    correctiveAction: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    complianceAudit: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    auditFinding: {
      create: vi.fn(),
      update: vi.fn(),
    },
    regulatorySubmission: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    complianceAuditLog: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    calendarEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    employeeProfile: {
      findUnique: vi.fn(),
    },
    riskAssessment: {
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    riskControl: {
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import {
  listRegulations,
  createRegulation,
  updateRegulation,
  deactivateRegulation,
  createObligation,
  createControl,
  linkControlToObligation,
  unlinkControlFromObligation,
  createIncident,
  createEvidence,
  supersedeEvidence,
  verifyCorrectiveAction,
} from "./compliance";

const mockSession = {
  user: { id: "user-1", email: "admin@test.com", platformRole: "HR-000", isSuperuser: false },
};

const mockEmployeeProfile = { id: "emp-1" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue(mockSession as never);
  vi.mocked(can).mockReturnValue(true);
  vi.mocked(prisma.employeeProfile.findUnique).mockResolvedValue(mockEmployeeProfile as never);
  vi.mocked(prisma.complianceAuditLog.create).mockResolvedValue({} as never);
});

describe("auth", () => {
  it("listRegulations rejects unauthenticated users", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    await expect(listRegulations()).rejects.toThrow("Unauthorized");
  });

  it("createRegulation rejects users without manage_compliance", async () => {
    vi.mocked(can).mockReturnValue(false);
    await expect(
      createRegulation({ name: "Test", shortName: "TST", jurisdiction: "US" }),
    ).rejects.toThrow("Unauthorized");
  });
});

describe("createRegulation", () => {
  it("creates regulation and logs action", async () => {
    vi.mocked(prisma.regulation.create).mockResolvedValue({ id: "reg-1", shortName: "GDPR" } as never);

    const result = await createRegulation({ name: "GDPR", shortName: "GDPR", jurisdiction: "EU" });

    expect(result.ok).toBe(true);
    expect(prisma.regulation.create).toHaveBeenCalledOnce();
    expect(prisma.complianceAuditLog.create).toHaveBeenCalledOnce();

    const createCall = vi.mocked(prisma.regulation.create).mock.calls[0]![0]!;
    expect((createCall as { data: { name: string } }).data.name).toBe("GDPR");
    expect((createCall as { data: { jurisdiction: string } }).data.jurisdiction).toBe("EU");
  });

  it("rejects empty name", async () => {
    const result = await createRegulation({ name: "", shortName: "TST", jurisdiction: "US" });
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Name is required.");
    expect(prisma.regulation.create).not.toHaveBeenCalled();
  });
});

describe("deactivateRegulation", () => {
  it("sets status to inactive and logs", async () => {
    vi.mocked(prisma.regulation.update).mockResolvedValue({} as never);

    const result = await deactivateRegulation("reg-1");

    expect(result.ok).toBe(true);
    expect(prisma.regulation.update).toHaveBeenCalledWith({
      where: { id: "reg-1" },
      data: { status: "inactive" },
    });
    expect(prisma.complianceAuditLog.create).toHaveBeenCalledOnce();
  });
});

describe("linkControlToObligation", () => {
  it("creates link when none exists", async () => {
    vi.mocked(prisma.controlObligationLink.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.controlObligationLink.create).mockResolvedValue({} as never);

    const result = await linkControlToObligation("ctl-1", "obl-1");
    expect(result.ok).toBe(true);
    expect(prisma.controlObligationLink.create).toHaveBeenCalledOnce();
  });

  it("rejects duplicate link", async () => {
    vi.mocked(prisma.controlObligationLink.findUnique).mockResolvedValue({ id: "existing" } as never);

    const result = await linkControlToObligation("ctl-1", "obl-1");
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Link already exists.");
  });
});

describe("createIncident with calendar", () => {
  it("creates calendar event for notifiable incident with deadline", async () => {
    const deadline = new Date("2026-04-01");
    vi.mocked(prisma.complianceIncident.create).mockResolvedValue({ id: "inc-1" } as never);
    vi.mocked(prisma.calendarEvent.create).mockResolvedValue({} as never);

    const result = await createIncident({
      title: "Data Breach",
      occurredAt: new Date(),
      severity: "critical",
      regulatoryNotifiable: true,
      notificationDeadline: deadline,
    });

    expect(result.ok).toBe(true);
    expect(prisma.calendarEvent.create).toHaveBeenCalledOnce();
    const calData = vi.mocked(prisma.calendarEvent.create).mock.calls[0]![0]!;
    expect((calData as { data: { category: string } }).data.category).toBe("compliance");
    expect((calData as { data: { complianceEntityType: string } }).data.complianceEntityType).toBe(
      "incident-notification",
    );
  });

  it("does NOT create calendar event for non-notifiable incident", async () => {
    vi.mocked(prisma.complianceIncident.create).mockResolvedValue({ id: "inc-2" } as never);

    await createIncident({
      title: "Minor Issue",
      occurredAt: new Date(),
      severity: "low",
      regulatoryNotifiable: false,
    });

    expect(prisma.calendarEvent.create).not.toHaveBeenCalled();
  });
});

describe("evidence immutability", () => {
  it("createEvidence works normally", async () => {
    vi.mocked(prisma.complianceEvidence.create).mockResolvedValue({ id: "evd-1" } as never);

    const result = await createEvidence({
      title: "Training Report",
      evidenceType: "training-record",
    });

    expect(result.ok).toBe(true);
    expect(prisma.complianceEvidence.create).toHaveBeenCalledOnce();
  });

  it("supersedeEvidence uses transaction to create new and mark old", async () => {
    const mockTx = {
      complianceEvidence: {
        create: vi.fn().mockResolvedValue({ id: "evd-new" }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    vi.mocked(prisma.$transaction).mockImplementation(
      async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    );

    const result = await supersedeEvidence("evd-old", {
      title: "Updated Report",
      evidenceType: "training-record",
    });

    expect(result.ok).toBe(true);
    expect(result.id).toBe("evd-new");
    expect(mockTx.complianceEvidence.create).toHaveBeenCalledOnce();
    expect(mockTx.complianceEvidence.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "evd-old" },
        data: expect.objectContaining({ status: "superseded", supersededById: "evd-new" }),
      }),
    );
  });

  it("no updateEvidence function is exported", async () => {
    const compliance = await import("./compliance");
    expect("updateEvidence" in compliance).toBe(false);
  });
});

describe("verifyCorrectiveAction", () => {
  it("sets verification fields and status to verified", async () => {
    vi.mocked(prisma.correctiveAction.update).mockResolvedValue({} as never);

    const result = await verifyCorrectiveAction("ca-1", "emp-verifier", "Manual inspection");

    expect(result.ok).toBe(true);
    expect(prisma.correctiveAction.update).toHaveBeenCalledWith({
      where: { id: "ca-1" },
      data: expect.objectContaining({
        verificationMethod: "Manual inspection",
        verifiedByEmployeeId: "emp-verifier",
        status: "verified",
      }),
    });
  });
});
