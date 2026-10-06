import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/work-capsules/activity-events", () => ({ publishRecordedWorkCapsuleActivity: vi.fn() }));
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));

// GPP Phase 3c PR-3c-2: a graph fixture with two governed branches is not
// registered (plan constraint 7), so the claim resolver is overridden for its
// key only; every registry shape resolves as before.
vi.mock("./workroom-shape-claim", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./workroom-shape-claim")>();
  const { SPLIT_TWO_DECISIONS } = await import("./__fixtures__/graph-shapes/parallel");
  return {
    ...actual,
    resolveWorkShapeClaim: (scopeClaims: unknown) => {
      const ref = actual.readWorkShapeClaim(scopeClaims);
      return ref?.key === SPLIT_TWO_DECISIONS.key ? SPLIT_TWO_DECISIONS : actual.resolveWorkShapeClaim(scopeClaims);
    },
  };
});

import { buildWorkShapeClaim } from "./workroom-shape-claim";
import { SPLIT_TWO_DECISIONS } from "./__fixtures__/graph-shapes/parallel";
import {
  loadWorkroomStageDecisionView,
  recordWorkroomStageDecisionForUser,
  type StageDecisionDb,
} from "./workroom-stage-decision.server";

const now = new Date("2026-09-29T12:00:00.000Z");
const OWNER_PRINCIPAL = "principal-owner";

function fakeDb(overrides: { pendingAttention?: unknown; scopeClaims?: unknown; ownerPrincipal?: string | null; callerPrincipal?: string | null; workspaceState?: unknown } = {}) {
  const claim = buildWorkShapeClaim({ key: "dependency-advisory-watch", version: "1.0.0" }, now);
  const room = {
    id: "room-row-1",
    capsuleId: "WC-DECIDE",
    archivedAt: null,
    scopeClaims: overrides.scopeClaims ?? [claim],
    workspaceState: overrides.workspaceState ?? { workroomDrive: { stageKey: "decide", pendingAttention: overrides.pendingAttention === undefined
      ? { reason: "governed_decision", stageKey: "decide", principalRef: "role:security-owner" }
      : overrides.pendingAttention } },
  };
  const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "activity-1", ...args.data }));
  const db = {
    workroom: {
      findUnique: vi.fn(async () => room),
      findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(),
    },
    workroomActivity: {
      create,
      findMany: vi.fn(async () => [
        { payload: { stageKey: "raise", outcome: "completed" }, summary: "2 findings raised" },
        { payload: { stageKey: "sweep", outcome: "completed" }, summary: "14 advisories read" },
      ]),
    },
    workroomRelation: { findMany: vi.fn(async () => []) },
    workroomParticipant: { findMany: vi.fn(async () => []) },
    organization: { findFirst: vi.fn(async () => ({ topAccountablePrincipalId: overrides.ownerPrincipal === undefined ? OWNER_PRINCIPAL : overrides.ownerPrincipal })) },
    principal: {
      findMany: vi.fn(async () => [{ id: OWNER_PRINCIPAL, displayName: "Alex Owner" }]),
      findFirst: vi.fn(async () => {
        const id = overrides.callerPrincipal === undefined ? OWNER_PRINCIPAL : overrides.callerPrincipal;
        return id ? { id } : null;
      }),
    },
  };
  return { db: db as unknown as StageDecisionDb, create, room };
}

const accept = { userId: "user-owner", roomRowId: "room-row-1", stageKey: "decide", choice: "accept", now };

describe("recordWorkroomStageDecisionForUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes exactly one completed decision-record evidence row for the accountable owner", async () => {
    const { db, create } = fakeDb();
    expect(await recordWorkroomStageDecisionForUser(db, { ...accept, rationale: "Not reachable in prod" })).toEqual({ ok: true });
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      workCapsuleId: "room-row-1",
      kind: "evidence-recorded",
      recordedById: "user-owner",
      recordedByAgentId: null,
      payload: {
        kind: "decision-record",
        stageKey: "decide",
        outcome: "completed",
        result: {
          choice: "accept",
          rationale: "Not reachable in prod",
          decisionScope: "security-advisory-response",
          principalRef: "role:security-owner",
          decidedBy: "accountable-owner-fallback",
        },
      },
    });
  });

  it("records a deferral with its date", async () => {
    const { db, create } = fakeDb();
    expect(await recordWorkroomStageDecisionForUser(db, { ...accept, choice: "defer", deferUntil: "2026-10-15" })).toEqual({ ok: true });
    expect(create.mock.calls[0][0].data.payload).toMatchObject({ result: { choice: "defer", deferUntil: "2026-10-15" } });
  });

  it("refuses a different stage than the one the room is waiting on", async () => {
    const { db, create } = fakeDb();
    const result = await recordWorkroomStageDecisionForUser(db, { ...accept, stageKey: "raise" });
    expect(result.ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses a room whose attention is not a governed decision", async () => {
    const { db, create } = fakeDb({ pendingAttention: { reason: "role_stage", stageKey: "decide", principalRef: "role:security-owner" } });
    expect((await recordWorkroomStageDecisionForUser(db, accept)).ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses a caller who is not the accountable owner, naming who can decide", async () => {
    const { db, create } = fakeDb({ callerPrincipal: "principal-someone-else" });
    expect(await recordWorkroomStageDecisionForUser(db, accept)).toEqual({
      ok: false, error: "Only Alex Owner (the room's accountable owner) can record this decision.",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("fails closed when the caller has no active human principal or no owner is recorded", async () => {
    const noCaller = fakeDb({ callerPrincipal: null });
    expect((await recordWorkroomStageDecisionForUser(noCaller.db, accept)).ok).toBe(false);
    const noOwner = fakeDb({ ownerPrincipal: null });
    expect((await recordWorkroomStageDecisionForUser(noOwner.db, accept)).ok).toBe(false);
    expect(noCaller.create).not.toHaveBeenCalled();
    expect(noOwner.create).not.toHaveBeenCalled();
  });

  it("refuses a deferral without a date", async () => {
    const { db, create } = fakeDb();
    expect(await recordWorkroomStageDecisionForUser(db, { ...accept, choice: "defer" })).toEqual({
      ok: false, error: "A deferral needs a date to come back to it.",
    });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("two decisions pending at once on parallel branches (GPP Phase 3c PR-3c-2)", () => {
  beforeEach(() => vi.clearAllMocks());
  const pending = (stageKey: string) => ({ reason: "governed_decision", stageKey, principalRef: "role:owner" });
  const twoWaiting = () => fakeDb({
    scopeClaims: [buildWorkShapeClaim({ key: SPLIT_TWO_DECISIONS.key, version: SPLIT_TWO_DECISIONS.version }, now)],
    workspaceState: { workroomDrive: { stageKey: "legal", pendingAttention: pending("legal"), pendingAttentions: [pending("legal"), pending("security")] } },
  });

  it("records a decision on either waiting stage, by the stage key the control posts", async () => {
    for (const stageKey of ["security", "legal"]) {
      const { db, create } = twoWaiting();
      expect(await recordWorkroomStageDecisionForUser(db, { ...accept, stageKey })).toEqual({ ok: true });
      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0][0].data.payload).toMatchObject({ kind: "decision-record", stageKey, outcome: "completed", result: { choice: "accept" } });
    }
  });

  it("refuses a stage that is not one of the waiting decisions", async () => {
    const { db, create } = twoWaiting();
    expect((await recordWorkroomStageDecisionForUser(db, { ...accept, stageKey: "ship" })).ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("deciding one leaves the other pending: once the drive lists only it, only it can be decided", async () => {
    const { db, create } = fakeDb({
      scopeClaims: [buildWorkShapeClaim({ key: SPLIT_TWO_DECISIONS.key, version: SPLIT_TWO_DECISIONS.version }, now)],
      workspaceState: { workroomDrive: { stageKey: "security", pendingAttention: pending("security"), pendingAttentions: [pending("security")] } },
    });
    expect((await recordWorkroomStageDecisionForUser(db, { ...accept, stageKey: "legal" })).ok).toBe(false);
    expect(await recordWorkroomStageDecisionForUser(db, { ...accept, stageKey: "security" })).toEqual({ ok: true });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("loadWorkroomStageDecisionView", () => {
  it("lets the accountable owner decide and summarises what earlier stages found", async () => {
    const { db } = fakeDb();
    const view = await loadWorkroomStageDecisionView(db, { caseKey: "case-1", roomRowId: "room-row-1", userId: "user-owner" });
    expect(view).toMatchObject({
      stageKey: "decide", canDecide: true, deciderName: "Alex Owner", refusal: null,
      choices: ["accept", "patch", "defer"],
      findings: [
        { stageKey: "sweep", summary: "14 advisories read" },
        { stageKey: "raise", summary: "2 findings raised" },
      ],
    });
  });

  it("shows others who decides and no control", async () => {
    const { db } = fakeDb({ callerPrincipal: "principal-someone-else" });
    const view = await loadWorkroomStageDecisionView(db, { caseKey: "case-1", roomRowId: "room-row-1", userId: "user-x" });
    expect(view).toMatchObject({ canDecide: false, deciderName: "Alex Owner" });
  });

  it("is absent when the room is not waiting on a governed decision", async () => {
    const { db } = fakeDb({ pendingAttention: null });
    expect(await loadWorkroomStageDecisionView(db, { caseKey: "case-1", roomRowId: "room-row-1", userId: "user-owner" })).toBeNull();
  });
});
