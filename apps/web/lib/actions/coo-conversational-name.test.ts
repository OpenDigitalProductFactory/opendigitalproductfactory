import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireCapability, revalidatePath } = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@dpf/db", () => ({
  prisma: {
    organization: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    platformSetupProgress: {
      findUnique: vi.fn(),
    },
    employeeProfile: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import { saveCooConversationalName } from "./coo-conversational-name";

describe("saveCooConversationalName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCapability.mockResolvedValue({ userId: "user-1" });
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({
      id: "org-1",
      cooConversationalName: null,
    } as never);
    vi.mocked(prisma.employeeProfile.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.organization.update).mockResolvedValue({
      id: "org-1",
      cooConversationalName: null,
    } as never);
  });

  it("requires manage_platform before reading or writing organization state", async () => {
    requireCapability.mockRejectedValue(new Error("Unauthorized"));
    await expect(saveCooConversationalName({ name: "Navigator" })).rejects.toThrow("Unauthorized");
    expect(requireCapability).toHaveBeenCalledWith("manage_platform");
    expect(prisma.organization.findFirst).not.toHaveBeenCalled();
  });

  it("normalizes and saves an organization-scoped name", async () => {
    await expect(saveCooConversationalName({ name: "  Number   Two " })).resolves.toEqual({
      ok: true,
      value: "Number Two",
    });
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: { cooConversationalName: "Number Two" },
      select: { cooConversationalName: true },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/workspace");
    expect(revalidatePath).toHaveBeenCalledWith("/platform/ai/agent/AGT-ORCH-000");
  });

  it("resolves the setup organization from the supplied progress record", async () => {
    vi.mocked(prisma.platformSetupProgress.findUnique).mockResolvedValue({ organizationId: "org-setup" } as never);
    await saveCooConversationalName({ name: "General", setupProgressId: "progress-1" });
    expect(prisma.organization.findFirst).not.toHaveBeenCalled();
    expect(prisma.organization.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "org-setup" },
    }));
  });

  it("rejects a real employee name without writing", async () => {
    vi.mocked(prisma.employeeProfile.findFirst).mockResolvedValue({ id: "employee-1" } as never);
    await expect(saveCooConversationalName({ name: "mark" })).resolves.toEqual({
      ok: false,
      error: "Choose a name that is not already used by a person in your organization.",
    });
    expect(prisma.employeeProfile.findFirst).toHaveBeenCalledWith({
      where: { displayName: { equals: "mark", mode: "insensitive" } },
      select: { id: true },
    });
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it("clears back to the canonical COO default", async () => {
    await expect(saveCooConversationalName({ name: null })).resolves.toEqual({ ok: true, value: null });
    expect(prisma.organization.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { cooConversationalName: null },
    }));
  });
});
