import { describe, expect, it, vi } from "vitest";
import { prepareWorkroomReviewSpecialists } from "./review-specialist-preparation";

const principal = (agentId: string) => ({ aliases: [{ aliasValue: agentId }] });
function fixture() {
  const db = { workroom: { findUnique: vi.fn().mockResolvedValue({ id: "room-1", capsuleId: "WC-ONE", status: "working", archivedAt: null, scopeClaims: [], featureBuildId: null,
    createdByPrincipal: principal("author"), participants: [{ principal: principal("ux-design-critic") }] }) }, agent: { findMany: vi.fn().mockResolvedValue([{ agentId: "AGT-906", name: "ux-design-critic", slugId: "ux-design-critic", status: "active", archived: false, lifecycleStage: "production" }, { agentId: "ux-design-critic", name: "ux-design-critic", slugId: "ux-design-critic", status: "active", archived: false, lifecycleStage: "production" }]) }, taskRun: { findMany: vi.fn().mockResolvedValue([]) } };
  return { db, authorize: vi.fn().mockResolvedValue(true) };
}
describe("server-owned specialist preparation", () => {
  it("excludes real authoring participants, even when the requester omits them", async () => {
    const deps = fixture();
    const selection = await prepareWorkroomReviewSpecialists({ userId: "user-1", capsuleId: "WC-ONE", actorAgentId: "codex", changedFiles: ["docs/prototype.html"] }, deps);
    expect(selection.authorAgentIds).toContain("AGT-906");
    expect(selection.unavailableProfessions).toContain("ux-design");
    expect(selection.specialists).toEqual([]);
  });
  it("includes paths from the immutable diff even when the supplied file list omits the prototype", async () => {
    const deps = fixture();
    const result = await prepareWorkroomReviewSpecialists({ userId: "user-1", capsuleId: "WC-ONE", actorAgentId: "codex", changedFiles: ["notes.txt"], artifact: "diff --git a/docs/prototype.html b/docs/prototype.html\n+<button>Continue</button>" }, deps);
    expect(result.requiredProfessions).toContain("ux-design");
  });
  it("refuses room access before reading the eligible-coworker catalog", async () => {
    const deps = fixture(); deps.authorize.mockResolvedValue(false);
    await expect(prepareWorkroomReviewSpecialists({ userId: "user-1", capsuleId: "WC-ONE", actorAgentId: "codex", changedFiles: ["prototype.html"] }, deps)).rejects.toThrow(/room.*access/i);
    expect(deps.db.agent.findMany).not.toHaveBeenCalled();
  });
  it("does not admit new review work in a completed room", async () => {
    const deps = fixture();
    const current = await deps.db.workroom.findUnique({});
    deps.db.workroom.findUnique.mockResolvedValue({ ...current, status: "complete" });
    await expect(prepareWorkroomReviewSpecialists({ userId: "user-1", capsuleId: "WC-ONE", actorAgentId: "codex", changedFiles: ["prototype.html"] }, deps)).rejects.toThrow(/room.*access/i);
    expect(deps.db.agent.findMany).not.toHaveBeenCalled();
  });
  it("includes actual Build Studio task authors in the exclusion set", async () => {
    const deps = fixture();
    deps.db.workroom.findUnique.mockResolvedValue({ id: "room-1", capsuleId: "WC-ONE", status: "working", archivedAt: null, scopeClaims: [], featureBuildId: "build-row", createdByPrincipal: principal("author"), participants: [] });
    deps.db.taskRun.findMany.mockResolvedValue([{ initiatingAgentId: "finance-controller", currentAgentId: "builder" }]);
    const selection = await prepareWorkroomReviewSpecialists({ userId: "user-1", capsuleId: "WC-ONE", actorAgentId: null, changedFiles: ["docs/professions/finance/wiki/controls.md"] }, deps);
    expect(selection.authorAgentIds).toContain("builder");
    expect(deps.db.taskRun.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { buildId: "build-row", source: "build" } }));
  });
});
