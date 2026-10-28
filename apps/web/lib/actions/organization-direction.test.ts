import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  save: vi.fn(),
  load: vi.fn(),
  applyMissionPrompt: vi.fn(),
  revalidatePath: vi.fn(),
  orgFindFirst: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@dpf/db", () => ({ prisma: { organization: { findFirst: mocks.orgFindFirst } } }));
vi.mock("@/lib/onboarding/apply-mission-prompt", () => ({ applyMissionPrompt: mocks.applyMissionPrompt }));
vi.mock("@/lib/organization-direction/direction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/organization-direction/direction")>();
  return { ...actual, saveOrganizationDirection: mocks.save, loadOrganizationDirection: mocks.load };
});

import { saveDirectionAction } from "./organization-direction";

const VALID = { mission: "M", vision: "V", outcomes: [{ id: null, statement: "O", measure: "" }] };

describe("saveDirectionAction (BI-916216E7 AC-2, AC-3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.orgFindFirst.mockResolvedValue({ id: "org-1" });
    mocks.save.mockResolvedValue({ version: 4 });
    mocks.load.mockResolvedValue({ mission: "M", vision: "V", outcomes: [{ id: "o1", statement: "O", measure: null }], version: 4 });
    mocks.applyMissionPrompt.mockResolvedValue({ applied: true });
  });

  it("refuses anyone who is not a signed-in admin", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1", type: "customer" } });
    expect(await saveDirectionAction(VALID, "settings")).toMatchObject({ ok: false });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("refuses an invalid payload without writing", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1", type: "admin" } });
    const result = await saveDirectionAction({ mission: "", vision: "", outcomes: [{ statement: "", measure: "x" }] }, "settings");
    expect(result).toMatchObject({ ok: false });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("saves as the signed-in owner, refreshes Block 0 and returns the new version", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1", type: "admin" } });
    const result = await saveDirectionAction(VALID, "setup");
    expect(result).toEqual({ ok: true, data: { version: 4, outcomes: [{ id: "o1", statement: "O", measure: null }] } });
    expect(mocks.save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      organizationId: "org-1",
      changedByUserId: "u1",
      source: "setup",
    }));
    expect(mocks.applyMissionPrompt).toHaveBeenCalledWith(expect.objectContaining({ mission: "M", updatedBy: "owner" }));
  });

  it("still reports the save when the Block 0 refresh fails", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1", type: "admin" } });
    mocks.applyMissionPrompt.mockRejectedValue(new Error("prompt store down"));
    expect(await saveDirectionAction(VALID, "settings")).toMatchObject({ ok: true });
  });
});
