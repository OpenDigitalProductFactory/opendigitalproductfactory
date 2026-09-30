import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireCapability, revalidatePath } = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@dpf/db", () => ({
  prisma: {
    principal: { findUnique: vi.fn() },
    organization: { findFirst: vi.fn(), update: vi.fn() },
    employeeProfile: { findUnique: vi.fn() },
    complianceAuditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@dpf/db";
import { setOrganizationAccountableOwner } from "./organization-accountable-owner";

describe("setOrganizationAccountableOwner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCapability.mockResolvedValue({ userId: "user-admin" });
    vi.mocked(prisma.principal.findUnique).mockResolvedValue({
      id: "principal-new",
      kind: "human",
      status: "active",
      displayName: "New Owner",
    } as never);
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({
      id: "org-1",
      topAccountablePrincipalId: "principal-old",
    } as never);
    vi.mocked(prisma.employeeProfile.findUnique).mockResolvedValue({ id: "emp-admin" } as never);
    vi.mocked(prisma.organization.update).mockResolvedValue({ id: "org-1" } as never);
    vi.mocked(prisma.complianceAuditLog.create).mockResolvedValue({ id: "audit-1" } as never);
    vi.mocked(prisma.$transaction).mockImplementation(((ops: Promise<unknown>[]) => Promise.all(ops)) as never);
  });

  it("requires manage_platform before reading or writing anything", async () => {
    requireCapability.mockRejectedValue(new Error("Unauthorized"));
    await expect(setOrganizationAccountableOwner("principal-new")).rejects.toThrow("Unauthorized");
    expect(requireCapability).toHaveBeenCalledWith("manage_platform");
    expect(prisma.principal.findUnique).not.toHaveBeenCalled();
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it.each([
    ["an AI coworker", { id: "principal-new", kind: "agent", status: "active", displayName: "Coworker" }],
    ["an inactive person", { id: "principal-new", kind: "human", status: "inactive", displayName: "Former" }],
    ["an unknown principal", null],
  ])("refuses %s without writing", async (_label, target) => {
    vi.mocked(prisma.principal.findUnique).mockResolvedValue(target as never);
    await expect(setOrganizationAccountableOwner("principal-new")).resolves.toEqual({
      ok: false,
      error: "Choose an active person as the accountable owner.",
    });
    expect(prisma.organization.update).not.toHaveBeenCalled();
    expect(prisma.complianceAuditLog.create).not.toHaveBeenCalled();
  });

  it("refuses a blank choice", async () => {
    await expect(setOrganizationAccountableOwner("   ")).resolves.toEqual({
      ok: false,
      error: "Choose an active person as the accountable owner.",
    });
    expect(prisma.principal.findUnique).not.toHaveBeenCalled();
  });

  it("sets the owner on the organization and records the change", async () => {
    await expect(setOrganizationAccountableOwner(" principal-new ")).resolves.toEqual({
      ok: true,
      data: { principalId: "principal-new", displayName: "New Owner", changed: true },
    });
    expect(prisma.principal.findUnique).toHaveBeenCalledWith({
      where: { id: "principal-new" },
      select: { id: true, kind: true, status: true, displayName: true },
    });
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: { topAccountablePrincipalId: "principal-new" },
      select: { id: true },
    });
    expect(prisma.complianceAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "organization",
        entityId: "org-1",
        action: "accountable-owner-changed",
        field: "topAccountablePrincipalId",
        oldValue: "principal-old",
        newValue: "principal-new",
        performedByEmployeeId: "emp-admin",
        agentId: null,
      }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/settings");
  });

  it("is idempotent: choosing the current owner writes nothing", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({
      id: "org-1",
      topAccountablePrincipalId: "principal-new",
    } as never);
    await expect(setOrganizationAccountableOwner("principal-new")).resolves.toEqual({
      ok: true,
      data: { principalId: "principal-new", displayName: "New Owner", changed: false },
    });
    expect(prisma.organization.update).not.toHaveBeenCalled();
    expect(prisma.complianceAuditLog.create).not.toHaveBeenCalled();
  });

  it("reports a missing organization instead of writing", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue(null);
    await expect(setOrganizationAccountableOwner("principal-new")).resolves.toEqual({
      ok: false,
      error: "No organization is recorded for this install yet.",
    });
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });
});
