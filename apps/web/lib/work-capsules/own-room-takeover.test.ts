import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ access: vi.fn(), dependencies: vi.fn() }));
vi.mock("@/lib/auth/oauth-identity-binding", () => ({ APPROVED_EXTERNAL_ROLES: ["AGT-EXT-CLAUDE", "AGT-EXT-CODEX", "AGT-EXT-GROK"] }));
vi.mock("./bounded-handoff-dependencies", () => ({ assertBoundedHandoffDependencies: m.dependencies }));
vi.mock("@/lib/work-management/workroom-agent-access.server", async (original) => ({
  ...await original<typeof import("@/lib/work-management/workroom-agent-access.server")>(), resolveAgentWorkroomAccess: m.access,
}));
import { assessOwnRoomTakeover } from "./own-room-takeover";
import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";

// BI-1986D3C1: production, 2026-11-11. A new Claude session of the same owner
// takes over a room whose Codex or Claude session left days ago. 26 such
// one-call takeovers reached the owner as approvals in nine days.
const claude: WorkCapsuleActor = { userId: "owner", principalId: "human", agentId: "AGT-EXT-CLAUDE", agentPrincipalId: "claude" };
const takeover = { capsuleId: "WC-1", toExecutorKind: "claude-desktop", toExecutorRef: "new-session" };

function fixture() {
  const room: Record<string, unknown> = { id: "row-1", capsuleId: "WC-1", executorKind: "codex-desktop", executorRef: "gone-session",
    leaseHolderPrincipalId: "human", leaseExpiresAt: new Date("2026-11-08T00:00:00Z"), featureBuildId: null, taskRunId: null,
    archivedAt: null, headBranch: "fix/work", headSha: "a".repeat(40), repositoryFullName: "owner/repo" };
  const roster = [{ principalId: "human", roles: ["coordinator"], lifecycle: "active", principal: { kind: "human" } }];
  const state = { level: "action", sensitivity: "internal" as string | null, policy: {} as Record<string, unknown>, human: "human" };
  m.access.mockImplementation(async () => ({ decision: { level: state.level }, agentPrincipalId: "PRN-claude",
    authorityContext: state.level === "action" ? {
      humanPrincipal: { id: state.human, principalId: "PRN-human", kind: "human", status: "active", sensitivityClearance: ["internal"] },
      agentPrincipal: { id: "claude", principalId: "PRN-claude", kind: "agent", status: "active", sensitivityClearance: ["internal"] },
      room: { createdByPrincipalId: "human", requestedByPrincipalId: "human", leaseHolderPrincipalId: room.leaseHolderPrincipalId,
        participants: roster, workItem: { evidence: { workroomPolicy: state.policy } } },
      sensitivityCeiling: state.sensitivity,
    } : undefined }));
  const db = { workroom: { findUnique: vi.fn(async () => ({ ...room })) } } as unknown as CapsuleDb;
  return { room, roster, state, db };
}
const assess = (f: ReturnType<typeof fixture>, actor = claude, call: Record<string, unknown> = takeover) =>
  assessOwnRoomTakeover({ db: f.db, actor, takeover: call as typeof takeover });

beforeEach(() => { vi.clearAllMocks(); m.dependencies.mockResolvedValue(undefined); });

describe("own-room takeover (BI-1986D3C1)", () => {
  it("lets the owner's assistant take over the owner's room after the previous session left", async () => {
    const f = fixture();
    await expect(assess(f)).resolves.toMatchObject({ capsuleId: "WC-1" });
    expect(m.access).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner", agentId: "AGT-EXT-CLAUDE", requested: "action", handover: true }), f.db);
    // Only the outgoing session's reservation on this branch could be stranded.
    expect(m.dependencies).toHaveBeenCalledWith(f.db, expect.objectContaining({ sourceExecutorRef: "gone-session", destinationExecutorRef: "gone-session" }));
  });

  it("allows a room with no lease holder, and a rebind to the same session skips the reservation check", async () => {
    const f = fixture(); f.room.leaseHolderPrincipalId = null; f.room.executorRef = "new-session";
    await expect(assess(f)).resolves.toBeTruthy();
    expect(m.dependencies).not.toHaveBeenCalled();
  });

  const outside: [string, (f: ReturnType<typeof fixture>) => void, string][] = [
    ["another person holds the lease", (f) => { f.room.leaseHolderPrincipalId = "other-human"; }, "takeover-other-holder"],
    ["the assistant may not act in the room", (f) => { f.state.level = "none"; }, "handoff-room-admission-required"],
    ["the person is admitted but does not own the room", (f) => { f.roster[0]!.roles = ["observer"]; f.room.leaseHolderPrincipalId = null; }, "handoff-owner-required"],
    ["the access resolved another person", (f) => { f.state.human = "other-human"; }, "handoff-room-admission-required"],
    ["the room is restricted", (f) => { f.state.sensitivity = "restricted"; }, "handoff-restricted-boundary"],
    ["the case policy is restricted", (f) => { f.state.policy = { sensitivityCeiling: "restricted" }; }, "handoff-restricted-boundary"],
    ["a build owns the room", (f) => { f.room.featureBuildId = "FB-1"; }, "handoff-build-boundary"],
    ["the room is archived", (f) => { f.room.archivedAt = new Date(); }, "handoff-build-boundary"],
  ];
  it.each(outside)("still needs the owner when %s", async (_, alter, code) => {
    const f = fixture(); alter(f);
    await expect(assess(f)).rejects.toMatchObject({ code });
  });

  it("refuses a takeover for a different assistant surface", async () => {
    await expect(assess(fixture(), claude, { ...takeover, toExecutorKind: "codex-desktop" })).rejects.toMatchObject({ code: "handoff-unsupported-assistant" });
  });

  it("refuses a caller that is not an authenticated assistant", async () => {
    await expect(assess(fixture(), { userId: "owner", principalId: "human", agentId: undefined } as unknown as WorkCapsuleActor)).rejects.toMatchObject({ code: "takeover-authenticated-assistant-required" });
  });

  it("refuses when the lease holder changed since the caller read it", async () => {
    await expect(assess(fixture(), claude, { ...takeover, expectedLeaseHolderPrincipalId: null })).rejects.toMatchObject({ code: "handoff-source-changed" });
  });

  it("keeps the outgoing session's live reservation on this branch as a refusal", async () => {
    const f = fixture();
    m.dependencies.mockRejectedValue(Object.assign(new Error("Executor gone-session still holds lease NPEL-x."), { code: "handoff-lease-dependency", name: "BoundedHandoffRefusal" }));
    await expect(assess(f)).rejects.toMatchObject({ code: "handoff-lease-dependency" });
  });
});

// BI-53BED66C: the room's drive dispatched a stage to a platform coworker,
// whose lease then lapsed. That coworker acts for no person, so the owner's
// own assistant takes the room over without the owner's approval.
describe("own-room takeover after a platform coworker's lease lapsed (BI-53BED66C)", () => {
  function coworkerHeld(kind: string | null, expiresAt: Date) {
    const f = fixture();
    f.room.leaseHolderPrincipalId = "build-specialist"; f.room.leaseExpiresAt = expiresAt;
    (f.db as unknown as { $queryRaw: unknown }).$queryRaw = vi.fn(async (sql: TemplateStringsArray) =>
      sql.join("").includes("clock_timestamp") ? [{ now: new Date("2026-11-13T19:27:00Z") }] : kind ? [{ kind }] : []);
    return f;
  }
  it("takes over a room whose lapsed lease a coworker held", async () => {
    await expect(assess(coworkerHeld("agent", new Date("2026-11-13T06:10:00Z")))).resolves.toMatchObject({ capsuleId: "WC-1" });
  });
  it.each([
    ["the coworker's lease is live", "agent", new Date("2026-11-13T20:00:00Z")],
    ["the lapsed holder is a person", "human", new Date("2026-11-13T06:10:00Z")],
    ["the holder's kind is unknown", null, new Date("2026-11-13T06:10:00Z")],
  ] as const)("still needs the owner when %s", async (_, kind, expiresAt) => {
    await expect(assess(coworkerHeld(kind, expiresAt))).rejects.toMatchObject({ code: "takeover-other-holder" });
  });
});
