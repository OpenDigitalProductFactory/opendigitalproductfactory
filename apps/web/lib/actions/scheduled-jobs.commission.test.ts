import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolvePrincipal: vi.fn(),
  commission: vi.fn(),
  revalidatePath: vi.fn(),
  loadReadiness: vi.fn(),
  appointOwner: vi.fn(),
  accessRefusal: vi.fn(),
  executeAppointment: vi.fn(),
  principalFindUnique: vi.fn(),
  workroomFindUnique: vi.fn(),
  activityCreate: vi.fn(),
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

vi.mock("@/lib/ecosystem/intake-controller-readiness", () => ({
  loadIntakeControllerReadiness: mocks.loadReadiness,
  appointIntakeControllerOwner: mocks.appointOwner,
}));
vi.mock("@/lib/work-capsules/oauth-workroom-ownership", () => ({
  coordinatorAppointmentAccessRefusal: mocks.accessRefusal,
}));
vi.mock("@/lib/work-management/execute-coordinator-appointment.server", () => ({
  executeCoordinatorAppointment: mocks.executeAppointment,
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    principal: { findUnique: mocks.principalFindUnique },
    workroom: { findUnique: mocks.workroomFindUnique },
    workroomActivity: { create: mocks.activityCreate },
  },
}));

import {
  becomeIntakeControllerOwnerAction,
  commissionIntakeControllerAction,
  loadIntakeControllerPanelAction,
} from "./scheduled-jobs";

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

describe("loadIntakeControllerPanelAction (BI-FD40397B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(admin);
    mocks.resolvePrincipal.mockResolvedValue("principal-row-owner");
  });

  it("evaluates the checklist for the signed-in person and says whether they may act", async () => {
    mocks.loadReadiness.mockResolvedValue({ rows: [] });
    expect(await loadIntakeControllerPanelAction()).toEqual({ ok: true, data: { readiness: { rows: [] }, canManage: true } });
    expect(mocks.loadReadiness).toHaveBeenCalledWith({ viewerPrincipalRecordId: "principal-row-owner" });
  });

  it("shows a read-only checklist to a viewer without platform-management authority", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-2", platformRole: null, isSuperuser: false } });
    mocks.loadReadiness.mockResolvedValue({ rows: [] });
    expect(await loadIntakeControllerPanelAction()).toMatchObject({ ok: true, data: { canManage: false } });
  });

  it("returns a load failure as an error state rather than throwing", async () => {
    mocks.loadReadiness.mockRejectedValue(new Error("database unavailable"));
    expect(await loadIntakeControllerPanelAction()).toEqual({ ok: false, error: "database unavailable" });
  });
});

describe("becomeIntakeControllerOwnerAction (BI-FD40397B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(admin);
    mocks.resolvePrincipal.mockResolvedValue("principal-row-owner");
  });

  it("refuses a caller without platform-management authority before any write", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-2", platformRole: null, isSuperuser: false } });
    await expect(becomeIntakeControllerOwnerAction("WC-STANDING")).rejects.toThrow("Unauthorized");
    expect(mocks.appointOwner).not.toHaveBeenCalled();
  });

  it("refuses a caller with no active person record", async () => {
    mocks.resolvePrincipal.mockResolvedValue(null);
    expect(await becomeIntakeControllerOwnerAction("WC-STANDING")).toMatchObject({ ok: false });
    expect(mocks.appointOwner).not.toHaveBeenCalled();
  });

  it("wires the governed appointment writer, its access rule and the room activity record", async () => {
    mocks.appointOwner.mockImplementation(async (input) => {
      expect(input).toMatchObject({ capsuleId: "WC-STANDING", userId: "user-1", principalRecordId: "principal-row-owner" });
      expect(input.appoint).toBe(mocks.executeAppointment);
      expect(input.accessRefusal).toBe(mocks.accessRefusal);
      mocks.principalFindUnique.mockResolvedValue({ principalId: "PRN-OWNER" });
      expect(await input.resolvePrincipalRef("principal-row-owner")).toBe("PRN-OWNER");
      mocks.workroomFindUnique.mockResolvedValue({ id: "row-standing" });
      await input.recordActivity({ capsuleId: "WC-STANDING", userId: "user-1", summary: "Mark took ownership.", principalRef: "PRN-OWNER" });
      return { ok: true, data: "Mark now owns WC-STANDING." };
    });
    expect(await becomeIntakeControllerOwnerAction("WC-STANDING")).toEqual({ ok: true, data: "Mark now owns WC-STANDING." });
    expect(mocks.activityCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ workCapsuleId: "row-standing", kind: "governed-action", recordedById: "user-1" }),
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/scheduled-jobs");
  });

  it("does not revalidate after a refusal", async () => {
    mocks.appointOwner.mockResolvedValue({ ok: false, error: "Not admitted." });
    expect(await becomeIntakeControllerOwnerAction("WC-STANDING")).toEqual({ ok: false, error: "Not admitted." });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
