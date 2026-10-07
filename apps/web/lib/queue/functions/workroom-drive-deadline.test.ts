// Stage deadlines through the drive runner (GPP Phase 3c PR-3c-4, BI-8875C9DF).
// Design: docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md
// §8 ("On expiry: non-interrupting", "Idempotency"); plan:
// docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
// (PR-3c-4, workroom-drive.ts). Beside workroom-drive.test.ts, which stays
// under the module-size ceiling.
//
// The fixture is DEADLINE_FIXTURE with a six-hour deadline on b (afterDays
// 0.25): the drive's marking belongs to one cycle, and a cadence shape's cycle
// is the tick's UTC date (projectWorkShapeCycleBoundary), so a deadline must
// fall inside the day to come due before the marking restarts. It is not
// registered (plan constraint 7), so the shape-claim resolver is overridden for
// its key only. The executable-construct table is a
// mutable copy, set per case: the stage-deadline flag is switched on here for
// the runner cases (the real flag stays off until BI-086DC167, graph markings
// reset at every cycle boundary) and left as it really is for the off cases.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEADLINE_FIXTURE } from "@/lib/work-management/__fixtures__/graph-shape-fixtures";
import { DAY_MS } from "@/lib/work-management/drive-deadlines";
import { resolveDrivePlan, workroomDriveTaskId } from "@/lib/work-management/drive-resolution";
import { projectPersistedWorkroomRoster } from "@/lib/work-management/room-participant-assignment";
import { readWorkShapeDefinitionContract } from "@/lib/work-management/work-shapes";
import { mergeWorkroomDriveSnapshot } from "@/lib/work-management/workroom-drive-snapshot-merge";
import { readStoredWorkroomDriveState } from "@/lib/work-management/workroom-drive-state";
import { buildWorkroomPostureClaim } from "@/lib/work-management/workroom-posture-claim";
import { buildWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";

import { runWorkroomDriveJob, type WorkroomDriveEffects, type WorkroomDriveRoom } from "./workroom-drive";
import type { DeadlineNoticeInput } from "./workroom-drive-deadlines";

const flags = vi.hoisted(() => ({ table: {} as Record<string, boolean>, original: {} as Record<string, boolean> }));
vi.mock("@/lib/gpp/shape-language/executable-constructs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gpp/shape-language/executable-constructs")>();
  flags.original = { ...actual.CONSTRUCT_EXECUTABLE };
  flags.table = { ...actual.CONSTRUCT_EXECUTABLE };
  return { ...actual, CONSTRUCT_EXECUTABLE: flags.table };
});
vi.mock("@/lib/work-management/workroom-shape-claim", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/work-management/workroom-shape-claim")>();
  const { DEADLINE_FIXTURE: base } = await import("@/lib/work-management/__fixtures__/graph-shape-fixtures");
  const fixture = sixHourDeadline(base);
  return {
    ...actual,
    resolveWorkShapeClaim: (scopeClaims: unknown) => {
      const ref = actual.readWorkShapeClaim(scopeClaims);
      return ref?.key === fixture.key && ref.version === fixture.version ? fixture : actual.resolveWorkShapeClaim(scopeClaims);
    },
  };
});

/** DEADLINE_FIXTURE (a → b) with b's deadline at six hours. Hoisted so the module mock can build it. */
function sixHourDeadline(base: typeof DEADLINE_FIXTURE): typeof DEADLINE_FIXTURE {
  return {
    ...base,
    key: "graph-fixture-deadline-hours",
    stages: base.stages.map((stage) => (stage.key === "b" ? { ...stage, deadline: { afterDays: 0.25, description: "Six hours." } } : stage)),
  };
}
const shape = sixHourDeadline(DEADLINE_FIXTURE);
const HOUR_MS = 3_600_000;
const DAY = "2026-03-02";
const T0 = new Date(`${DAY}T09:00:00.000Z`);
const at = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;
const CYCLE = (day: string) => `${shape.key}@${shape.version}:${day}`;
const KEY = `${CYCLE(DAY)}#b#0`;
const PRIMARY = workroomDriveTaskId("WC-DL", shape.key);

type Harness = {
  workspaceState: Record<string, unknown>;
  activities: Array<{ kind: string; summary: string; payload: Record<string, unknown> }>;
  notices: DeadlineNoticeInput[];
  /** What the next notify call answers: true (sent), false (not delivered) or "throw". */
  notifyAnswer: boolean | "throw";
  lease: "acquired" | "held";
  upserts: string[];
};

function coordinator() {
  return {
    workroomId: "row-dl",
    principalRef: "PRN-COORD",
    roles: ["coordinator" as const],
    assignmentSource: "explicit" as const,
    enteredReason: null,
    currentWorkSummary: null,
    displayName: "Overseer",
    kind: "agent" as const,
    sponsorPrincipalRef: null,
    sponsorDisplayName: null,
    authoritySummary: "Acts within process-coordination authority",
  };
}

async function tick(h: Harness, now: Date) {
  const before = { notices: h.notices.length, activities: h.activities.length, upserts: h.upserts.length };
  const stored = readStoredWorkroomDriveState(h.workspaceState);
  const room: WorkroomDriveRoom = {
    id: "row-dl",
    capsuleId: "WC-DL",
    scopeClaims: [
      buildWorkShapeClaim({ key: shape.key, version: shape.version }),
      buildWorkroomPostureClaim({ proactivityLevel: "balanced" }, new Date("2026-03-01T00:00:00.000Z")),
    ],
    workspaceState: h.workspaceState,
    leaseExpiresAt: null,
    leaseHolderPrincipalId: "prn-row-coord",
    ownerUserId: "user-1",
    participants: [coordinator()],
    ...stored,
    receipts: stored.receipts,
    budgetUsage: [],
    stopConditionHits: [],
    reviewDue: false,
    substrateReachable: true,
    substrateEmpty: false,
    coordinatorEligibility: { jsi: "eligible", authorityBinding: "eligible" },
    recordedEvidence: [],
    stageDispatchedAt: null,
    stageDispatchedAtByStage: new Map(),
  };
  const fx: WorkroomDriveEffects = {
    persist: async (input) => {
      if (!input.quiet) h.activities.push({ kind: input.activityKind, summary: input.summary, payload: input.payload });
      if (input.observationOnly) return;
      const written = mergeWorkroomDriveSnapshot(h.workspaceState, input.snapshot, { graphShape: input.graphShape });
      h.workspaceState = JSON.parse(JSON.stringify({ ...h.workspaceState, workroomDrive: written })) as Record<string, unknown>;
    },
    acquireLease: async () => h.lease,
    upsertAgentTask: async (input) => { h.upserts.push(input.taskId); return true; },
    deactivateAgentTask: async () => {},
    notifyDeadline: async (input) => {
      h.notices.push(input);
      if (h.notifyAnswer === "throw") throw new Error("notification store unavailable");
      return h.notifyAnswer;
    },
  };
  const result = await runWorkroomDriveJob(now, { listRooms: async () => [room], effects: fx, reconcileNesting: async () => 0, reconcileNotifications: async () => {} });
  return {
    plan: result.plans[0]!,
    notices: h.notices.slice(before.notices),
    activities: h.activities.slice(before.activities),
    upserts: h.upserts.slice(before.upserts),
  };
}

const drive = (h: Harness) => h.workspaceState.workroomDrive as Record<string, unknown>;
const marking = (h: Harness) => drive(h).marking as { tokens: Array<Record<string, unknown>>; deadlines: Record<string, { raisedAt: string; notifiedAt: string | null }> };

/** b dispatched at T0 and latched (no writeback): the room pauses on the writeback latch, which a deadline never changes. */
function waitingOnB(over: { lastAction?: boolean; deadlines?: Record<string, unknown> } = {}): Harness {
  const token = over.lastAction === false
    ? { node: "stage:b", enteredAt: T0.toISOString(), taskId: PRIMARY }
    : { node: "stage:b", enteredAt: T0.toISOString(), taskId: PRIMARY, lastAction: "dispatch_agent", lastReason: "agent_stage", lastCycleKey: CYCLE(DAY) };
  return {
    workspaceState: { workroomDrive: {
      kind: "workroom-drive", version: 1, action: "dispatch_agent", reason: "agent_stage", stageKey: "b", lastCycleKey: CYCLE(DAY),
      receipts: [{ stageKey: "a", kind: "stage-evidence-recorded" }],
      marking: { format: "drive-marking/1", cycleKey: CYCLE(DAY), tokens: [token], iterations: {}, reworkTaken: {}, deadlines: over.deadlines ?? {}, children: {} },
    } },
    activities: [],
    notices: [],
    notifyAnswer: true,
    lease: "acquired",
    upserts: [],
  };
}

describe("a stage deadline through the runner: notify once, after commit, retried on failure; the work never moves (PR-3c-4)", () => {
  beforeEach(() => {
    Object.assign(flags.table, flags.original, { "stage-deadline": true });
  });

  it("before the deadline nothing is raised; at it, the notice is raised (unsent) with a workroom-drive-deadline activity, and the token stays", async () => {
    const h = waitingOnB();
    const early = await tick(h, at(5 * HOUR_MS));
    expect(early.plan).toMatchObject({ action: "pause", reason: "executor_writeback_unavailable" });
    expect(marking(h).deadlines).toEqual({});
    expect(early.activities.map((activity) => activity.kind)).not.toContain("workroom-drive-deadline");

    const due = await tick(h, at(6 * HOUR_MS));
    // Non-interrupting: the plan is exactly what it was without the deadline.
    expect(due.plan).toMatchObject({ action: "pause", reason: "executor_writeback_unavailable" });
    expect(marking(h).tokens.map((token) => token.node)).toEqual(["stage:b"]);
    expect(marking(h).deadlines).toEqual({ [KEY]: { raisedAt: at(6 * HOUR_MS).toISOString(), notifiedAt: null } });
    // Notify after commit: nothing is sent on the tick that raises it.
    expect(due.notices).toEqual([]);
    const raised = due.activities.filter((activity) => activity.kind === "workroom-drive-deadline");
    expect(raised).toHaveLength(1);
    expect(raised[0]!.summary).toContain("Stage Stage b is past its deadline (Six hours.)");
    expect(raised[0]!.payload).toMatchObject({ deadlines: [{ key: KEY, stageKey: "b", iteration: 0, afterDays: 0.25, escalationRef: "agent:graph-worker", overdueMs: 0 }] });
  });

  it("the committed notice goes out on the next tick; a failed send (false or a throw) retries; a sent one never repeats", async () => {
    const h = waitingOnB();
    await tick(h, at(6 * HOUR_MS));

    h.notifyAnswer = false;
    const notDelivered = await tick(h, at(6 * HOUR_MS + 15 * MIN));
    expect(notDelivered.notices.map((call) => call.notice.key)).toEqual([KEY]);
    expect(marking(h).deadlines[KEY]?.notifiedAt).toBeNull();

    h.notifyAnswer = "throw";
    const failed = await tick(h, at(6 * HOUR_MS + 30 * MIN));
    expect(failed.notices).toHaveLength(1);
    expect(marking(h).deadlines[KEY]?.notifiedAt).toBeNull();

    h.notifyAnswer = true;
    const sent = await tick(h, at(6 * HOUR_MS + 45 * MIN));
    expect(sent.notices).toHaveLength(1);
    expect(sent.notices[0]!.notice).toMatchObject({ key: KEY, stageKey: "b", stageTitle: "Stage b", description: "Six hours.", escalationRef: "agent:graph-worker" });
    expect(marking(h).deadlines[KEY]).toEqual({ raisedAt: at(6 * HOUR_MS).toISOString(), notifiedAt: at(6 * HOUR_MS + 45 * MIN).toISOString() });

    for (const later of [8 * HOUR_MS, 12 * HOUR_MS]) {
      const quiet = await tick(h, at(later));
      expect(quiet.notices).toEqual([]);
      expect(quiet.activities.map((activity) => activity.kind)).not.toContain("workroom-drive-deadline");
    }
    expect(Object.keys(marking(h).deadlines)).toEqual([KEY]);
  });

  it("a tick that commits nothing (a lease held by another worker) sends nothing", async () => {
    const h = waitingOnB({ lastAction: false, deadlines: { [KEY]: { raisedAt: at(6 * HOUR_MS).toISOString(), notifiedAt: null } } });
    h.lease = "held";
    const held = await tick(h, at(6 * HOUR_MS + 15 * MIN));
    expect(held.plan).toMatchObject({ action: "dispatch_agent" });
    expect(held.notices).toEqual([]);
    expect(held.upserts).toEqual([]);
    expect(marking(h).deadlines[KEY]?.notifiedAt).toBeNull();
    // Once the lease is free the dispatch commits, and the notice goes with it.
    h.lease = "acquired";
    const free = await tick(h, at(6 * HOUR_MS + 30 * MIN));
    expect(free.upserts).toEqual([PRIMARY]);
    expect(free.notices.map((call) => call.notice.key)).toEqual([KEY]);
    expect(marking(h).deadlines[KEY]?.notifiedAt).toBe(at(6 * HOUR_MS + 30 * MIN).toISOString());
  });

  it("a run in flight keeps its notice across UTC midnight, never raising it twice; only a new run, after this one concluded, can notice the stage again (BI-086DC167)", async () => {
    const h = waitingOnB();
    await tick(h, at(6 * HOUR_MS));
    await tick(h, at(6 * HOUR_MS + 15 * MIN));
    const notified = structuredClone(marking(h).deadlines);
    expect(notified[KEY]?.notifiedAt).toBe(at(6 * HOUR_MS + 15 * MIN).toISOString());
    // The next UTC day: the same run, the same token, the same notice, nothing raised or sent again.
    for (const later of [DAY_MS - 9 * HOUR_MS + 15 * MIN, DAY_MS]) {
      const nextDay = await tick(h, at(later));
      expect((drive(h).marking as { cycleKey: string }).cycleKey).toBe(CYCLE(DAY));
      expect(marking(h).tokens.map((token) => token.node)).toEqual(["stage:b"]);
      expect(marking(h).deadlines).toEqual(notified);
      expect(nextDay.notices).toEqual([]);
      expect(nextDay.activities.map((activity) => activity.kind)).not.toContain("workroom-drive-deadline");
    }
    // The run concludes; the next run starts on a later day under its own key, owing nothing yet. Its receipts
    // were earned in this run (run-keyed, as the graph earns them), so the next run does not replay them.
    h.workspaceState = { workroomDrive: { ...drive(h), action: "stop", reason: "success", stageKey: null, lastCycleKey: CYCLE("2026-03-03"),
      receipts: [{ stageKey: "a", kind: "stage-evidence-recorded", iteration: 0, runKey: CYCLE(DAY) }],
      marking: { ...(drive(h).marking as Record<string, unknown>), tokens: [] } } };
    await tick(h, new Date("2026-03-04T09:00:00.000Z"));
    expect((drive(h).marking as { cycleKey: string }).cycleKey).toBe(CYCLE("2026-03-04"));
    expect(marking(h).tokens.map((token) => token.node)).toEqual(["stage:a"]);
    expect(marking(h).deadlines).toEqual({});
  });

  it("under the real flags (stage-deadline off, BI-086DC167) the room pauses construct_not_executable: nothing is raised or sent, the marking is kept", async () => {
    Object.assign(flags.table, flags.original);
    expect(flags.table["stage-deadline"]).toBe(false);
    const h = waitingOnB({ deadlines: { [KEY]: { raisedAt: at(6 * HOUR_MS).toISOString(), notifiedAt: null } } });
    const paused = await tick(h, at(9 * HOUR_MS));
    expect(paused.plan).toMatchObject({ action: "pause", reason: "construct_not_executable" });
    expect(paused.notices).toEqual([]);
    expect(marking(h).deadlines[KEY]?.notifiedAt).toBeNull();
    expect(marking(h).tokens.map((token) => token.node)).toEqual(["stage:b"]);
  });
});

// The planner on its own (moved here from drive-resolution.test.ts so it runs under this file's test-only flag table:
// the stage-deadline flag is off until BI-086DC167).
describe("resolveDrivePlan raises a stage deadline and changes nothing else (PR-3c-4)", () => {
  beforeEach(() => {
    Object.assign(flags.table, flags.original, { "stage-deadline": true });
  });
  const NOW = new Date("2026-09-01T12:00:00.000Z");
  const definition = readWorkShapeDefinitionContract(DEADLINE_FIXTURE);
  const cycle = `${DEADLINE_FIXTURE.key}@${DEADLINE_FIXTURE.version}:2026-09-01`;
  const twin = readWorkShapeDefinitionContract({
    ...DEADLINE_FIXTURE,
    stages: DEADLINE_FIXTURE.stages.map(({ deadline: _deadline, ...stage }) => stage),
    flow: { nodes: [], edges: [{ from: "a", to: "b" }, { from: "b", to: "success" }] },
  });
  const plan = (shape: typeof definition, enteredAt: Date, deadlines: Record<string, unknown> = {}) => resolveDrivePlan({
    roomId: "WC-DL", definition: shape, collaborationShape: null, postureLevel: "balanced", currentStageKey: "b",
    participants: projectPersistedWorkroomRoster({ assignments: [coordinator()], presencePrincipalRefs: [] }),
    receipts: [{ stageKey: "a", kind: "stage-evidence-recorded" }], budgetUsage: [], stopConditionHits: [], reviewDue: false,
    substrateReachable: true, substrateEmpty: false, coordinatorEligibility: { jsi: "eligible", authorityBinding: "eligible" }, now: NOW,
    workspaceState: { workroomDrive: { stageKey: "b", marking: {
      format: "drive-marking/1", cycleKey: cycle, tokens: [{ node: "stage:b", enteredAt: enteredAt.toISOString() }],
      iterations: {}, reworkTaken: {}, deadlines, children: {},
    } } },
  });

  it("an overdue token's notice is raised (unsent) and listed; the plan is otherwise the twin's, token and all", () => {
    const entered = new Date(NOW.getTime() - 2 * DAY_MS);
    const raised = plan(definition, entered);
    const without = plan(twin, entered);
    const key = `${cycle}#b#0`;
    expect(raised).toMatchObject({ action: without.action, reason: without.reason, stageKey: "b", taskId: without.taskId });
    expect((raised.marking as { tokens: unknown }).tokens).toEqual((without.marking as { tokens: unknown }).tokens);
    expect((raised.marking as { deadlines: unknown }).deadlines).toEqual({ [key]: { raisedAt: NOW.toISOString(), notifiedAt: null } });
    expect(raised.deadlinesDue?.map((due) => [due.key, due.escalationRef])).toEqual([[key, "agent:graph-worker"]]);
    expect(raised.ledger.at(-1)).toContain("Stage b is past its deadline (Two days.");
    expect(without.deadlinesDue).toBeUndefined();
  });

  it("not yet due, or already raised, raises nothing", () => {
    expect(plan(definition, new Date(NOW.getTime() - 2 * DAY_MS + 1)).deadlinesDue).toBeUndefined();
    const already = { [`${cycle}#b#0`]: { raisedAt: "2026-09-01T00:00:00.000Z", notifiedAt: null } };
    const again = plan(definition, new Date(NOW.getTime() - 3 * DAY_MS), already);
    expect(again.deadlinesDue).toBeUndefined();
    expect((again.marking as { deadlines: unknown }).deadlines).toEqual(already);
  });

  it("under the real flags (stage-deadline off, BI-086DC167) the room pauses construct_not_executable and raises nothing", () => {
    Object.assign(flags.table, flags.original);
    expect(flags.table["stage-deadline"]).toBe(false);
    const paused = plan(definition, new Date(NOW.getTime() - 2 * DAY_MS));
    expect(paused).toMatchObject({ action: "pause", reason: "construct_not_executable", stageKey: "b" });
    expect(paused.deadlinesDue).toBeUndefined();
  });
});
