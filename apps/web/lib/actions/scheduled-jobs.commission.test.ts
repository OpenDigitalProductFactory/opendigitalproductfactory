import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolvePrincipal: vi.fn(),
  commission: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability: vi.fn() }));
vi.mock("@/lib/operate/scheduled-jobs/control", () => ({}));
vi.mock("@/lib/operate/scheduled-jobs/register", () => ({}));
vi.mock("@/lib/identity/principal-linking", () => ({
  resolveActiveHumanPrincipalRecordIdForUser: mocks.resolvePrincipal,
}));
vi.mock("@/lib/ecosystem/intake-controller-authority", () => ({
  commissionIntakeController: mocks.commission,
}));

import { commissionIntakeControllerAction } from "./scheduled-jobs";

const admin = { user: { id: "user-1", email: "owner@example.test", platformRole: "admin", isSuperuser: true } };

describe("commissionIntakeControllerAction (BI-FD40397B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(admin);
    mocks.resolvePrincipal.mockResolvedValue("principal-row-owner");
  });

  it("refuses an unauthenticated caller before any lookup", async () => {
    mocks.auth.mockResolvedValue(null);
    await expect(commissionIntakeControllerAction("WC-CONTROLLER")).rejects.toThrow("Unauthorized");
    expect(mocks.commission).not.toHaveBeenCalled();
  });

  it("refuses a caller without platform-management authority", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-2", email: "viewer@example.test", platformRole: null, isSuperuser: false } });
    await expect(commissionIntakeControllerAction("WC-CONTROLLER")).rejects.toThrow("Unauthorized");
    expect(mocks.commission).not.toHaveBeenCalled();
  });

  it("refuses a caller with no active human principal", async () => {
    mocks.resolvePrincipal.mockResolvedValue(null);
    const result = await commissionIntakeControllerAction("WC-CONTROLLER");
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/^not commissioned: /) });
    expect(mocks.commission).not.toHaveBeenCalled();
  });

  it("commissions as the caller's principal and reports the predicate's refusal verbatim", async () => {
    mocks.commission.mockResolvedValueOnce({ ok: false, error: "not commissioned: installation is not a production install" });
    expect(await commissionIntakeControllerAction("WC-CONTROLLER"))
      .toEqual({ ok: false, error: "not commissioned: installation is not a production install" });
    expect(mocks.commission).toHaveBeenCalledWith({ workroomCapsuleId: "WC-CONTROLLER", principalRecordId: "principal-row-owner" });
    expect(mocks.resolvePrincipal).toHaveBeenCalledWith("user-1");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("revalidates the register after a successful commission", async () => {
    mocks.commission.mockResolvedValueOnce({
      ok: true,
      data: { workroomCapsuleId: "WC-CONTROLLER", repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory" },
    });
    const result = await commissionIntakeControllerAction("WC-CONTROLLER");
    expect(result).toMatchObject({ ok: true, data: expect.stringContaining("WC-CONTROLLER") });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/scheduled-jobs");
  });
});
