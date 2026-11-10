// BI-D13FA12A — a drive tick that could not dispatch must not read as dispatched,
// and a room that records no requester or creator still gets its agent task when
// an accountable person can be named.
//
// Live evidence (2026-10-13 23:30Z): 127 Build Studio rooms recorded
// action=dispatch_agent, reason=missing_task_owner, conclusion in-motion, and no
// ScheduledAgentTask. Each had no requester/creator principal but a resolvable
// accountable person (the organization owner).
import { describe, expect, it, vi } from "vitest";

import { PARALLEL_FIXTURE } from "@/lib/work-management/__fixtures__/graph-shape-fixtures";
import { workroomDriveTaskId } from "@/lib/work-management/drive-resolution";
import { mergeWorkroomDriveSnapshot } from "@/lib/work-management/workroom-drive-snapshot-merge";
import { readStoredWorkroomDriveState } from "@/lib/work-management/workroom-drive-state";
import { buildWorkroomPostureClaim } from "@/lib/work-management/workroom-posture-claim";
import { buildWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";
import type { EffectiveHumanAccountability } from "@/lib/work-management/human-accountability";
import { classifyDriveSegment } from "@/lib/work-management/workroom-flow-state";

import { applyDrivePlan, runWorkroomDriveJob, type WorkroomDriveEffects, type WorkroomDriveRoom } from "./workroom-drive";
import { activeUserIdForHumanPrincipal, resolveDriveTaskOwner, resolveRoomDriveTaskOwnerUserId } from "./workroom-drive-task-owner";

// The graph fixture is not registered, so the shape-claim resolver is
// overridden for its key only (as in workroom-drive.test.ts).
vi.mock("@/lib/work-management/workroom-shape-claim", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/work-management/workroom-shape-claim")>();
  const { PARALLEL_FIXTURE: fixture } = await import("@/lib/work-management/__fixtures__/graph-shape-fixtures");
  return {
    ...actual,
    resolveWorkShapeClaim: (scopeClaims: unknown) => {
      const ref = actual.readWorkShapeClaim(scopeClaims);
      return ref?.key === fixture.key && ref.version === fixture.version ? fixture : actual.resolveWorkShapeClaim(scopeClaims);
    },
  };
});

const ORG_OWNER: EffectiveHumanAccountability = {
  state: "resolved",
  principalId: "PRN-ORG-OWNER",
  source: "organization-owner",
  inheritedFrom: [],
};
const NOBODY: EffectiveHumanAccountability = {
  state: "setup-required",
  reason: "no-organization-owner-recorded",
  message: "No accountable human is assigned and the organization has recorded no owner.",
  atWorkroomId: null,
};

function room(over: Partial<WorkroomDriveRoom> = {}): WorkroomDriveRoom {
  return {
    id: "row-bs",
    capsuleId: "WC-BUILD",
    scopeClaims: [],
    workspaceState: {},
    leaseExpiresAt: null,
    leaseHolderPrincipalId: null,
    ownerUserId: null,
    participants: [],
    currentStageKey: null,
    receipts: [],
    budgetUsage: [],
    stopConditionHits: [],
    reviewDue: false,
    substrateReachable: true,
    substrateEmpty: false,
    ...over,
  } as unknown as WorkroomDriveRoom;
}

const TASK_ID = workroomDriveTaskId("WC-BUILD", "delivery-large");

function dispatchPlan() {
  return {
    action: "dispatch_agent",
    reason: "agent_stage",
    roomId: "WC-BUILD",
    shapeKey: "delivery-large",
    shapeVersion: "1.0.0",
    definition: null,
    stageKey: "spec",
    accountablePrincipalRef: null,
    agentId: "spec-author",
    attentionPrincipalRef: null,
    taskId: TASK_ID,
    conformance: null,
    cycle: null,
    deviations: [],
    ledger: ["Stage spec is an agent stage."],
  } as never;
}

function effects(accountability: EffectiveHumanAccountability, userIdFor: (principalId: string) => string | null) {
  const persisted: Array<{ snapshot: Record<string, unknown>; summary: string }> = [];
  const fx = {
    persist: vi.fn(async (input: { snapshot: Record<string, unknown>; summary: string }) => {
      persisted.push({ snapshot: input.snapshot, summary: input.summary });
    }),
    acquireLease: vi.fn(async () => "acquired" as const),
    upsertAgentTask: vi.fn(async () => true),
    deactivateAgentTask: vi.fn(async () => {}),
    resolveAccountability: vi.fn(async () => accountability),
    resolvePrincipalUserId: vi.fn(async (principalId: string) => userIdFor(principalId)),
  };
  return { fx: fx as unknown as WorkroomDriveEffects, raw: fx, persisted };
}

const NOW = new Date("2026-10-13T23:30:00.000Z");

describe("a room with no requester or creator user (BI-D13FA12A)", () => {
  it("dispatches its agent task under the accountable person's user, and says whose", async () => {
    const { fx, raw, persisted } = effects(ORG_OWNER, (id) => (id === "PRN-ORG-OWNER" ? "user-org-owner" : null));
    const outcome = await applyDrivePlan({ room: room(), plan: dispatchPlan(), now: NOW, effects: fx });

    expect(outcome).toBe("dispatched");
    expect(raw.upsertAgentTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: TASK_ID, ownerUserId: "user-org-owner" }));
    const { snapshot, summary } = persisted[0]!;
    expect(snapshot).toMatchObject({ action: "dispatch_agent", reason: "agent_stage" });
    expect(snapshot.taskOwner).toEqual({ userId: "user-org-owner", principalId: "PRN-ORG-OWNER", source: "organization-owner" });
    expect(summary).toContain("organization-owner");
  });

  it("a room that records its owner user dispatches under it without walking accountability", async () => {
    const { fx, raw } = effects(ORG_OWNER, () => "user-org-owner");
    await applyDrivePlan({ room: room({ ownerUserId: "user-requester" }), plan: dispatchPlan(), now: NOW, effects: fx });

    expect(raw.upsertAgentTask).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: "user-requester" }));
    expect(raw.resolveAccountability).not.toHaveBeenCalled();
  });
});

describe("a dispatch with no owner is recorded as a pause, never as dispatched (BI-D13FA12A)", () => {
  it("records pause/missing_task_owner with a conclusion naming the missing owner, and takes no lease or task", async () => {
    const { fx, raw, persisted } = effects(NOBODY, () => null);
    const outcome = await applyDrivePlan({ room: room(), plan: dispatchPlan(), now: NOW, effects: fx });

    expect(outcome).toBe("skipped");
    expect(raw.upsertAgentTask).not.toHaveBeenCalled();
    expect(raw.acquireLease).not.toHaveBeenCalled();
    const { snapshot } = persisted[0]!;
    expect(snapshot).toMatchObject({ action: "pause", reason: "missing_task_owner", taskId: null, stageKey: "spec" });
    const conclusion = snapshot.conclusion as { kind: string; summary: string; blockage: { ownerSetupRequired: string | null } };
    expect(conclusion.kind).not.toBe("in-motion");
    expect(conclusion.blockage.ownerSetupRequired).toContain("recorded no owner");
    expect((snapshot.taskOwner as { missing: string }).missing).toContain("recorded no owner");
    // A pause is a stuck hold, so the stall notice reaches someone after an hour.
    expect((snapshot.hold as { stuckTicks: number }).stuckTicks).toBe(1);
    expect(classifyDriveSegment({ action: "pause", reason: "missing_task_owner" })?.state).toBe("blocked");
  });

  it("an accountable person with no active user account is a named blockage, not a guess", async () => {
    const { fx, raw, persisted } = effects(ORG_OWNER, () => null);
    await applyDrivePlan({ room: room(), plan: dispatchPlan(), now: NOW, effects: fx });

    expect(raw.upsertAgentTask).not.toHaveBeenCalled();
    const { snapshot } = persisted[0]!;
    expect(snapshot).toMatchObject({ action: "pause", reason: "missing_task_owner" });
    const conclusion = snapshot.conclusion as { kind: string; blockage: { ownerPrincipalId: string | null } };
    expect(conclusion.kind).toBe("blocked");
    expect(conclusion.blockage.ownerPrincipalId).toBe("PRN-ORG-OWNER");
    expect((snapshot.taskOwner as { missing: string }).missing).toContain("no active user account");
  });
});

describe("resolveDriveTaskOwner", () => {
  it("a failed principal lookup is reported as missing with the cause", async () => {
    const owner = await resolveDriveTaskOwner("row-1", null, {
      resolveAccountability: async () => ORG_OWNER,
      resolvePrincipalUserId: async () => { throw new Error("alias read timed out"); },
    });
    expect(owner.owner).toMatchObject({ state: "missing" });
    expect(owner.owner.state === "missing" && owner.owner.message).toContain("alias read timed out");
  });
});

describe("activeUserIdForHumanPrincipal", () => {
  const db = (aliases: string[], active: boolean | null) => ({
    principalAlias: { findMany: vi.fn(async () => aliases.map((aliasValue) => ({ aliasValue }))) },
    user: { findUnique: vi.fn(async () => (active === null ? null : { isActive: active })) },
  });

  it("returns the one active user an active human principal maps to", async () => {
    expect(await activeUserIdForHumanPrincipal(db(["user-1"], true), "PRN-1")).toBe("user-1");
  });

  it("returns null for an inactive user, no alias, or an ambiguous alias", async () => {
    expect(await activeUserIdForHumanPrincipal(db(["user-1"], false), "PRN-1")).toBeNull();
    expect(await activeUserIdForHumanPrincipal(db([], true), "PRN-1")).toBeNull();
    expect(await activeUserIdForHumanPrincipal(db(["user-1", "user-2"], true), "PRN-1")).toBeNull();
  });
});

describe("a graph room's branch dispatch follows the same owner rule (BI-D13FA12A)", () => {
  const T0 = new Date("2026-03-02T09:00:00.000Z");
  const PRIMARY = workroomDriveTaskId("WC-FORK", PARALLEL_FIXTURE.key);

  async function firstTick(accountability: EffectiveHumanAccountability, userId: string | null) {
    let workspaceState: Record<string, unknown> = {};
    const upserts: Array<{ taskId: string; ownerUserId: string }> = [];
    let leases = 0;
    const forkRoom = {
      ...room({ id: "row-fork", capsuleId: "WC-FORK", ownerUserId: null }),
      scopeClaims: [
        buildWorkShapeClaim({ key: PARALLEL_FIXTURE.key, version: PARALLEL_FIXTURE.version }),
        buildWorkroomPostureClaim({ proactivityLevel: "balanced" }, new Date("2026-03-01T00:00:00.000Z")),
      ],
      participants: [{
        workroomId: "row-fork", principalRef: "PRN-COORD", roles: ["coordinator"], assignmentSource: "explicit",
        enteredReason: null, currentWorkSummary: null, displayName: "Overseer", kind: "agent",
        sponsorPrincipalRef: null, sponsorDisplayName: null, authoritySummary: "Acts within process-coordination authority",
      }],
      coordinatorEligibility: { jsi: "eligible", authorityBinding: "eligible" },
      ...readStoredWorkroomDriveState(workspaceState),
      recordedEvidence: [],
      stageDispatchedAt: null,
      stageDispatchedAtByStage: new Map(),
    } as unknown as WorkroomDriveRoom;
    const fx: WorkroomDriveEffects = {
      resolveAccountability: async () => accountability,
      resolvePrincipalUserId: async () => userId,
      persist: async (input) => {
        if (input.observationOnly) return;
        const written = mergeWorkroomDriveSnapshot(workspaceState, input.snapshot, { graphShape: input.graphShape });
        workspaceState = JSON.parse(JSON.stringify({ ...workspaceState, workroomDrive: written })) as Record<string, unknown>;
      },
      acquireLease: async () => { leases += 1; return "acquired"; },
      upsertAgentTask: async (input) => { upserts.push({ taskId: input.taskId, ownerUserId: input.ownerUserId }); return true; },
      deactivateAgentTask: async () => {},
    };
    const result = await runWorkroomDriveJob(T0, { listRooms: async () => [forkRoom], effects: fx, reconcileNesting: async () => 0, reconcileNotifications: async () => {} });
    return { result, upserts, leases, drive: workspaceState.workroomDrive as Record<string, unknown> };
  }

  it("dispatches the branch under the accountable person's user", async () => {
    const tick = await firstTick(ORG_OWNER, "user-org-owner");
    expect(tick.upserts).toEqual([{ taskId: PRIMARY, ownerUserId: "user-org-owner" }]);
    expect(tick.drive).toMatchObject({ action: "dispatch_agent", dispatchedStageKeys: ["a"] });
    expect(tick.drive.taskOwner).toMatchObject({ source: "organization-owner" });
  });

  it("with nobody accountable, records pause/missing_task_owner, takes no lease and dispatches nothing", async () => {
    const tick = await firstTick(NOBODY, null);
    expect(tick.upserts).toEqual([]);
    expect(tick.leases).toBe(0);
    expect(tick.result.dispatched).toBe(0);
    expect(tick.drive).toMatchObject({ action: "pause", reason: "missing_task_owner", dispatchedStageKeys: [] });
    expect((tick.drive.conclusion as { kind: string }).kind).not.toBe("in-motion");
  });
});

describe("resolveRoomDriveTaskOwnerUserId (BI-17238133)", () => {
  it("returns the recorded owner without asking accountability", async () => {
    const resolveAccountability = vi.fn();
    expect(await resolveRoomDriveTaskOwnerUserId({ id: "room", recordedOwnerUserId: "u1" }, { resolveAccountability }))
      .toBe("u1");
    expect(resolveAccountability).not.toHaveBeenCalled();
  });
  it("falls back to the accountable person's active user", async () => {
    expect(await resolveRoomDriveTaskOwnerUserId({ id: "room", recordedOwnerUserId: null }, {
      resolveAccountability: async () => ({ state: "resolved", principalId: "p1", source: "organization-owner" }) as never,
      resolvePrincipalUserId: async () => "u2",
    })).toBe("u2");
  });
  it("returns null when no owner can be named", async () => {
    expect(await resolveRoomDriveTaskOwnerUserId({ id: "room", recordedOwnerUserId: null }, {})).toBeNull();
  });
});
