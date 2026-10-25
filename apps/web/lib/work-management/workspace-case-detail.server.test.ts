import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DpfSession } from "@/lib/govern/auth";
import { buildEffectiveAuthContext } from "@/lib/identity/effective-auth-context";
import { baseItem, prismaFor } from "./workspace-case-loader.test-fixtures";
import { loadAuthorizedWorkspaceCase, loadAuthorizedWorkroomProcess } from "./workspace-case-detail.server";
const state = vi.hoisted(() => ({ db: {} as Record<string, unknown>, effective: vi.fn(), flow: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: state.db }));
vi.mock("@/lib/identity/load-effective-auth-context", () => ({ loadEffectiveAuthContext: state.effective }));
vi.mock("./room-participation-prisma.server", () => ({ loadPrismaWorkroomParticipants: vi.fn(async () => []) }));
vi.mock("./room-posture.server", () => ({ loadWorkroomPostureContext: vi.fn(async () => null) }));
vi.mock("./room-structure.server", () => ({ resolveWorkroomStructureForCase: vi.fn(async () => null) }));
vi.mock("./workroom-flow-map.server", () => ({ loadWorkroomFlowMap: state.flow }));
const user: DpfSession["user"] = { id: "user-1", email: "test@example.test", type: "admin", platformRole: null,
  isSuperuser: false, accountId: null, accountName: null, contactId: null };
function effective(clearance = ["public", "internal"]) { return buildEffectiveAuthContext({ user, grantedCapabilities: [],
  principal: { principalId: "PRN-OWNER", kind: "human", sensitivityClearance: clearance } }); }
function setup(item = baseItem) {
  const db = prismaFor([item]);
  db.workroom.findMany = vi.fn(async (args: unknown) => {
    const selection = (args as { where: { capsuleId?: string } }).where.capsuleId;
    return !selection || selection === "WC-SELECTED" ? [{ id: "room-selected", capsuleId: "WC-SELECTED", title: "Selected", status: "ready",
      scopeClaims: [{ workShape: "delivery-small@1.0.0", source: "declared" }] }] : [];
  });
  Object.assign(state.db, db);
  return db;
}
beforeEach(() => { vi.clearAllMocks(); for (const key of Object.keys(state.db)) delete state.db[key];
  state.effective.mockResolvedValue(effective()); state.flow.mockResolvedValue(null); });
describe("shared authorized case and process loader", () => {
  it("retains manual process reads for an authorized case without an execution capsule", async () => {
    const db = setup(); db.workroom.findMany = vi.fn(async () => []);
    const result = await loadAuthorizedWorkroomProcess({ caseKey: "booking:BK-1", workroomRowId: null, user });
    expect(result).toMatchObject({ status: "ok", snapshot: { identity: { caseKey: "booking%3ABK-1", workroomRowId: null, workroom: null }, flowMap: null } });
    expect(state.flow).not.toHaveBeenCalled();
  });
  it("conflicts when a case-only snapshot acquires a capsule", async () => {
    setup();
    expect(await loadAuthorizedWorkroomProcess({ caseKey: "booking:BK-1", workroomRowId: null, user })).toEqual({ status: "changed" });
    expect(state.flow).not.toHaveBeenCalled();
  });
  it.each(["BK-100%", "BK-100%20"])("preserves a raw canonical source ID %s", async sourceId => {
    setup({ ...baseItem, sourceId });
    const caseKey = encodeURIComponent(`booking:${sourceId}`);
    expect(await loadAuthorizedWorkspaceCase({ caseKey, user })).toMatchObject({ canonicalCaseKey: caseKey });
    expect(await loadAuthorizedWorkspaceCase({ caseKey: `booking:${sourceId}`, user })).toMatchObject({ canonicalCaseKey: caseKey });
  });

  it("normalizes encoded and decoded keys and preserves explicit room selection", async () => {
    const db = setup();
    const result = await loadAuthorizedWorkspaceCase({ caseKey: "booking:BK-1", selectedWorkroomId: "WC-SELECTED", user });
    expect(result).toMatchObject({ caseKey: "booking%3ABK-1", canonicalCaseKey: "booking%3ABK-1", detail: { workroomRowId: "room-selected" } });
    expect(db.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workItemId: "row-1", capsuleId: "WC-SELECTED" } }));
  });
  it("returns no content for a nonmember before reading rooms or execution", async () => {
    const db = setup({ ...baseItem, assignedToUserId: "other-user" });
    const read = vi.fn(async () => []); state.db.workroomActivity = { findMany: read };
    expect(await loadAuthorizedWorkspaceCase({ caseKey: "booking:BK-1", user })).toBeNull();
    expect(db.workroom.findMany).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  });
  it("applies sensitivity to the assigned user using the existing policy", async () => {
    const db = setup(); state.effective.mockResolvedValue(effective(["public"]));
    expect(await loadAuthorizedWorkspaceCase({ caseKey: "booking:BK-1", user })).toBeNull();
    expect(db.workroom.findMany).not.toHaveBeenCalled();
  });
  it("never uses the requested row as authority to read an unrelated room", async () => {
    const db = setup();
    expect(await loadAuthorizedWorkroomProcess({ caseKey: "booking:BK-1", workroomRowId: "unrelated-row", user })).toEqual({ status: "changed" });
    expect(state.flow).not.toHaveBeenCalled();
    expect(db.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workItemId: "row-1" } }));
  });
  it("does not fall back to a different room when explicit selection disappears", async () => {
    setup();
    expect(await loadAuthorizedWorkroomProcess({ caseKey: "booking:BK-1", selectedWorkroomId: "WC-OTHER", workroomRowId: "room-selected", user })).toEqual({ status: "not-found" });
    expect(state.flow).not.toHaveBeenCalled();
  });
  it("conflicts on ambiguous selection without loading a companion map", async () => {
    const db = setup();
    db.workroom.findMany = vi.fn(async () => [{ id: "one", capsuleId: "WC-ONE", title: "One", status: "ready" }, { id: "two", capsuleId: "WC-TWO", title: "Two", status: "ready" }]);
    expect(await loadAuthorizedWorkroomProcess({ caseKey: "booking:BK-1", workroomRowId: "one", user })).toEqual({ status: "changed" });
    expect(state.flow).not.toHaveBeenCalled();
  });
  it("exposes canonical anchored identity only after content authorization", async () => {
    const db = setup();
    db.workItem.findFirst = vi.fn(async () => baseItem);
    expect(await loadAuthorizedWorkspaceCase({ caseKey: "work-capsule:WC-SELECTED", user })).toMatchObject({ canonicalCaseKey: "booking%3ABK-1" });
    db.workItem.findFirst = vi.fn(async () => ({ ...baseItem, assignedToUserId: "other-user" }));
    Object.assign(db.workroom, { findFirst: vi.fn(async () => ({ capsuleId: "WC-SELECTED", title: "Hidden", status: "ready", workItemId: "row-1" })) });
    expect(await loadAuthorizedWorkspaceCase({ caseKey: "work-capsule:WC-SELECTED", user })).toBeNull();
  });
  it("retains standalone room admission and refuses nonmembers before execution reads", async () => {
    const db = setup(); db.workItem.findFirst = vi.fn(async () => null);
    Object.assign(db.workroom, { findFirst: vi.fn(async () => ({ id: "standalone", capsuleId: "WC-ALONE", title: "Standalone", status: "ready", workItemId: null,
      createdByPrincipal: { principalId: "PRN-OWNER" } })) });
    expect(await loadAuthorizedWorkspaceCase({ caseKey: "work-capsule:WC-ALONE", user })).toMatchObject({ detail: { workroomRowId: "standalone" } });
    state.effective.mockResolvedValue(buildEffectiveAuthContext({ user, grantedCapabilities: [], principal: { principalId: "PRN-OTHER", kind: "human", sensitivityClearance: ["internal"] } }));
    const read = vi.fn(); state.db.workroomActivity = { findMany: read };
    expect(await loadAuthorizedWorkspaceCase({ caseKey: "work-capsule:WC-ALONE", user })).toBeNull(); expect(read).not.toHaveBeenCalled();
  });
  it("reports a failed map read as partial and clears the map in the same snapshot", async () => {
    setup(); state.flow.mockRejectedValueOnce(new Error("private database failure"));
    const result = await loadAuthorizedWorkroomProcess({ caseKey: "booking:BK-1", workroomRowId: "room-selected", user });
    expect(result).toMatchObject({ status: "ok", snapshot: { flowMap: null, flowHealth: "unavailable", graph: { process: { sourceHealth: "partial" } } } });
    expect(JSON.stringify(result)).not.toContain("private database failure");
  });
  it.each(["%", "not-a-case"])("rejects malformed identity %s before any source read", async caseKey => {
    setup(); expect(await loadAuthorizedWorkspaceCase({ caseKey, user })).toBeNull(); expect(state.effective).not.toHaveBeenCalled();
  });
});
