import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  revalidatePath: vi.fn(),
  resolvePrincipal: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability: mocks.requireCapability }));
vi.mock("@/lib/identity/principal-linking", () => ({ resolvePrincipalIdForUser: mocks.resolvePrincipal }));
vi.mock("@dpf/db", () => ({
  prisma: { platformConfig: { findUnique: mocks.findUnique, upsert: mocks.upsert } },
}));

import { confirmInstallationOperatingPurpose } from "./installation-operating-intent";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCapability.mockResolvedValue({ userId: "principal-1" });
  mocks.resolvePrincipal.mockResolvedValue("PRN-1");
  mocks.findUnique.mockResolvedValue(null);
  mocks.upsert.mockResolvedValue({});
});

describe("confirmInstallationOperatingPurpose", () => {
  it("refuses an unknown purpose without writing", async () => {
    await expect(confirmInstallationOperatingPurpose("production")).resolves.toMatchObject({ ok: false });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("records owner confirmation without granting another capability", async () => {
    const result = await confirmInstallationOperatingPurpose("operate-organization");

    expect(result).toEqual({ ok: true, primaryPurpose: "operate-organization" });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: "installation.operating-intent.v1" },
      create: expect.objectContaining({ key: "installation.operating-intent.v1" }),
    }));
    const stored = mocks.upsert.mock.calls[0][0].create.value;
    expect(stored).toMatchObject({
      schemaVersion: 1,
      primaryPurpose: "operate-organization",
      confirmation: { status: "confirmed", confirmedByPrincipalId: "PRN-1" },
    });
    expect(stored).not.toHaveProperty("grants");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/workspace");
  });
});
