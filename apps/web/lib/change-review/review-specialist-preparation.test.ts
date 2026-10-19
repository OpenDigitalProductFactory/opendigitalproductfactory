import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareWorkroomReviewSpecialists } from "./review-specialist-preparation";
import * as shapeClaims from "@/lib/work-management/workroom-shape-claim";
import { getWorkShape } from "@/lib/work-management/work-shapes";
import { PARALLEL_FIXTURE } from "@/lib/work-management/__fixtures__/graph-shape-fixtures";

const scopeClaims = [{ workShape: "delivery-large@1.0.0" }];
afterEach(() => vi.restoreAllMocks());

function declaredStages() {
  const shape = getWorkShape("delivery-large")!;
  const declared = { ...shape, stages: [
    { ...shape.stages[0], key: "design", requiredProfessions: ["ux-design"] },
    { ...shape.stages[1], key: "assure", requiredProfessions: ["data-architect", "security", "finance"] },
    { ...shape.stages[2], key: "later", requiredProfessions: ["enterprise-architecture"] },
  ] };
  vi.spyOn(shapeClaims, "resolveWorkShapeClaim").mockReturnValue(declared);
  return declared;
}

const principal = (agentId: string) => ({ aliases: [{ aliasValue: agentId }] });
function fixture() {
  const db = { workroom: { findUnique: vi.fn().mockResolvedValue({ id: "room-1", capsuleId: "WC-ONE", status: "working", archivedAt: null, scopeClaims, workspaceState: { workroomDrive: { stageKey: "implement" } } as unknown, featureBuildId: null,
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
    deps.db.workroom.findUnique.mockResolvedValue({ id: "room-1", capsuleId: "WC-ONE", status: "working", archivedAt: null, scopeClaims, workspaceState: { workroomDrive: { stageKey: "implement" } }, featureBuildId: "build-row", createdByPrincipal: principal("author"), participants: [] });
    deps.db.taskRun.findMany.mockResolvedValue([{ initiatingAgentId: "finance-controller", currentAgentId: "builder" }]);
    const selection = await prepareWorkroomReviewSpecialists({ userId: "user-1", capsuleId: "WC-ONE", actorAgentId: null, changedFiles: ["docs/professions/finance/wiki/controls.md"] }, deps);
    expect(selection.authorAgentIds).toContain("builder");
    expect(deps.db.taskRun.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { buildId: "build-row", source: "build" } }));
  });

  it("uses the recorded stage's declared professions before a UI path exists", async () => {
    declaredStages();
    const deps = fixture();
    const room = await deps.db.workroom.findUnique({});
    deps.db.workroom.findUnique.mockResolvedValue({ ...room, workspaceState: { workroomDrive: { stageKey: "design" } } });
    const selection = await prepareWorkroomReviewSpecialists({ userId: "user-1", capsuleId: "WC-ONE", actorAgentId: "codex", changedFiles: ["notes.txt"] }, deps);
    expect(selection.requiredProfessions).toEqual(["ux-design"]);
    expect(deps.db.workroom.findUnique).toHaveBeenLastCalledWith(expect.objectContaining({ select: expect.objectContaining({ workspaceState: true }) }));
  });

  it("retains all four obligations on concurrent marked stages, excluding inactive stages", async () => {
    vi.spyOn(shapeClaims, "resolveWorkShapeClaim").mockReturnValue({ ...PARALLEL_FIXTURE,
      stages: PARALLEL_FIXTURE.stages.map(stage => ({ ...stage, requiredProfessions:
        stage.key === "b" ? ["ux-design"] : stage.key === "c" ? ["data-architect", "security", "finance"] : ["enterprise-architecture"],
      })),
    });
    const deps = fixture();
    const room = await deps.db.workroom.findUnique({});
    deps.db.workroom.findUnique.mockResolvedValue({ ...room, workspaceState: { workroomDrive: {
      stageKey: "d", marking: { format: "drive-marking/1", cycleKey: "run-1",
        tokens: ["b", "c"].map(key => ({ node: `stage:${key}`, enteredAt: "2026-10-19T12:00:00.000Z" })),
        iterations: {}, reworkTaken: {}, deadlines: {}, children: {} },
    } } });
    const selection = await prepareWorkroomReviewSpecialists({ userId: "user-1", capsuleId: "WC-ONE", actorAgentId: "codex", changedFiles: ["notes.txt"] }, deps);
    expect(selection.requiredProfessions).toHaveLength(4);
    expect(selection.requiredProfessions).toEqual(expect.arrayContaining(["data-architect", "security", "finance", "ux-design"]));
    expect(selection.requiredProfessions).not.toContain("enterprise-architecture");
  });

  it.each([null, {}, { workroomDrive: {} }, { workroomDrive: { stageKey: "missing" } },
    { workroomDrive: { stageKey: "implement", marking: { format: "unreadable" } } },
    { workroomDrive: { stageKey: "implement", marking: { format: "drive-marking/1", cycleKey: "run-1", tokens: [], iterations: {}, reworkTaken: {}, deadlines: {}, children: {} } } },
  ])("refuses missing, malformed or concluded stage state before catalog access: %j", async workspaceState => {
    const deps = fixture();
    const room = await deps.db.workroom.findUnique({});
    deps.db.workroom.findUnique.mockResolvedValue({ ...room, workspaceState });
    await expect(prepareWorkroomReviewSpecialists({ userId: "user-1", capsuleId: "WC-ONE", actorAgentId: "codex", changedFiles: ["prototype.html"] }, deps)).rejects.toThrow(/stage/i);
    expect(deps.db.agent.findMany).not.toHaveBeenCalled();
  });

  it("refuses an unresolved pinned shape instead of falling back to path-only coverage", async () => {
    const deps = fixture();
    const room = await deps.db.workroom.findUnique({});
    deps.db.workroom.findUnique.mockResolvedValue({ ...room, scopeClaims: [] });
    await expect(prepareWorkroomReviewSpecialists({ userId: "user-1", capsuleId: "WC-ONE", actorAgentId: "codex", changedFiles: ["prototype.html"] }, deps)).rejects.toThrow(/shape/i);
    expect(deps.db.agent.findMany).not.toHaveBeenCalled();
  });
});
