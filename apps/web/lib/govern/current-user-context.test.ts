import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { user: { findUnique: mocks.findUnique } } }));
import { currentUserContext } from "./current-user-context";
import { can, getGrantedCapabilities } from "./permissions";

beforeEach(() => vi.resetAllMocks());
describe("current human authority", () => {
  it("uses every current role and ignores unassigned groups", async () => {
    mocks.findUnique.mockResolvedValue({ isActive: true, isSuperuser: false, groups: [
      { platformRole: null }, { platformRole: { roleId: "HR-200" } },
      { platformRole: { roleId: "HR-500" } },
    ] });
    const user = await currentUserContext("human");
    expect(user?.userId).toBe("human");
    expect(can(user!, "view_platform")).toBe(true);
    expect(can(user!, "manage_backlog")).toBe(true);
    expect(can(user!, "manage_agents")).toBe(false);
    expect(getGrantedCapabilities(user!)).toContain("manage_backlog");
  });
  it.each([null, { isActive: false, isSuperuser: true, groups: [] }])("refuses a missing or disabled human even if formerly superuser", async (row) => {
    mocks.findUnique.mockResolvedValue(row);
    expect(await currentUserContext("human")).toBeNull();
  });
  it("reloads permissions after the existing login loses a role", async () => {
    mocks.findUnique.mockResolvedValueOnce({ isActive: true, isSuperuser: false,
      groups: [{ platformRole: { roleId: "HR-000" } }] });
    expect(can((await currentUserContext("human"))!, "manage_agents")).toBe(true);
    mocks.findUnique.mockResolvedValue({ isActive: true, isSuperuser: false, groups: [] });
    expect(can((await currentUserContext("human"))!, "manage_agents")).toBe(false);
  });
});
