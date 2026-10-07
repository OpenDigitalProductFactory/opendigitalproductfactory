// AC-3C-MARKING-DURABLE (BI-8875C9DF, GPP Phase 3c PR-3c-1). Design:
// docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md
// §4.2 ("A graph room's marking survives every tick", review blocker 1), §5
// (kill switch); plan: docs/superpowers/plans/
// 2026-10-02-gpp-phase-3c-drive-graph-execution.md (PR-3c-1,
// drive-marking-durable.test.ts).
//
// Through the real runner, runWorkroomDriveJob, with an in-memory persist that
// applies the production merge (mergeWorkroomDriveSnapshot). Two test-only
// overrides, both module mocks: the executable-construct table (the kill
// switch is flipped per scenario) and the shape-claim resolver (the graph
// fixtures are not registered, by design).
//
// - Kill switch: flag on, off, on. The room pauses construct_not_executable
//   with its stageKey and marking intact, then resumes the same marking.
// - Posture quiet, then balanced: a stored marking holding reworkTaken keeps it.
// - A malformed stored marking survives a marking_unreadable pause byte-for-byte.
// - A run in flight crosses the calendar boundary with its marking intact; the
//   next run starts only after the run concluded, under a new calendar key, and
//   at most one run starts per calendar key (BI-086DC167).
// - lease_held changes nothing.
// - The merge keeps the row's marking when a graph snapshot lacks one.

import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  mergeWorkroomDriveSnapshot,
  runWorkroomDriveJob,
  type WorkroomDriveEffects,
  type WorkroomDriveRoom,
} from "@/lib/queue/functions/workroom-drive";

import { REWORK_FIXTURE } from "./__fixtures__/graph-shape-fixtures";
import type { RecordedEvidence } from "./stage-evidence-receipts";
import type { WorkShapeDefinition } from "./work-shapes";
import { readStoredWorkroomDriveState } from "./workroom-drive-state";
import { buildWorkroomPostureClaim } from "./workroom-posture-claim";

const flags = vi.hoisted(() => ({ table: {} as Record<string, boolean>, original: {} as Record<string, boolean> }));

vi.mock("@/lib/gpp/shape-language/executable-constructs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gpp/shape-language/executable-constructs")>();
  flags.original = { ...actual.CONSTRUCT_EXECUTABLE };
  flags.table = { ...actual.CONSTRUCT_EXECUTABLE };
  return { ...actual, CONSTRUCT_EXECUTABLE: flags.table };
});

const FIXTURES: Record<string, WorkShapeDefinition> = { [REWORK_FIXTURE.key]: REWORK_FIXTURE };

vi.mock("@/lib/work-management/workroom-shape-claim", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/work-management/workroom-shape-claim")>();
  return {
    ...actual,
    resolveWorkShapeClaim: (scopeClaims: unknown) => {
      const ref = actual.readWorkShapeClaim(scopeClaims);
      const fixture = ref ? FIXTURES[ref.key] : undefined;
      return fixture && fixture.version === ref?.version ? fixture : actual.resolveWorkShapeClaim(scopeClaims);
    },
  };
});

const DAY = "2026-03-02";
const T0 = new Date(`${DAY}T09:00:00.000Z`);
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const CYCLE = `${REWORK_FIXTURE.key}@${REWORK_FIXTURE.version}:${DAY}`;

type Harness = {
  workspaceState: Record<string, unknown>;
  evidence: RecordedEvidence[];
  dispatchedAt: Map<string, Date>;
  posture: "quiet" | "balanced";
  leaseHeld: boolean;
  persisted: Array<{ snapshot: Record<string, unknown>; observationOnly: boolean; graphShape: boolean }>;
};

function harness(workspaceState: Record<string, unknown> = {}): Harness {
  return { workspaceState, evidence: [], dispatchedAt: new Map(), posture: "balanced", leaseHeld: false, persisted: [] };
}

async function tick(h: Harness, now: Date) {
  const stored = readStoredWorkroomDriveState(h.workspaceState);
  const room: WorkroomDriveRoom = {
    id: "row-durable",
    capsuleId: "WC-DURABLE",
    scopeClaims: [
      { workShape: `${REWORK_FIXTURE.key}@${REWORK_FIXTURE.version}`, recordedAt: "2026-03-01T00:00:00.000Z" },
      buildWorkroomPostureClaim({ proactivityLevel: h.posture }, new Date("2026-03-01T00:00:00.000Z")),
    ],
    workspaceState: h.workspaceState,
    leaseExpiresAt: null,
    leaseHolderPrincipalId: "PRN-LEASE",
    ownerUserId: "user-owner",
    participants: [{
      workroomId: "row-durable", principalRef: "PRN-COORD", roles: ["coordinator"], assignmentSource: "explicit",
      enteredReason: null, currentWorkSummary: null, displayName: "Overseer", kind: "agent",
      sponsorPrincipalRef: null, sponsorDisplayName: null, authoritySummary: "",
    }],
    ...stored,
    substrateReachable: true,
    substrateEmpty: false,
    coordinatorEligibility: { jsi: "eligible", authorityBinding: "eligible" },
    recordedEvidence: [...h.evidence].reverse(),
    stageDispatchedAt: null,
    stageDispatchedAtByStage: new Map(h.dispatchedAt),
  };
  const effects: WorkroomDriveEffects = {
    resolveAccountability: async () => ({ state: "resolved", principalId: "PRN-OWNER", source: "explicit-room", inheritedFrom: [] }),
    persist: async (input) => {
      h.persisted.push({ snapshot: input.snapshot, observationOnly: input.observationOnly === true, graphShape: input.graphShape === true });
      if (input.observationOnly) return;
      const written = mergeWorkroomDriveSnapshot(h.workspaceState, input.snapshot, { graphShape: input.graphShape });
      h.workspaceState = JSON.parse(JSON.stringify({ ...h.workspaceState, workroomDrive: written })) as Record<string, unknown>;
      if (input.snapshot.action === "dispatch_agent" && typeof input.snapshot.stageKey === "string") h.dispatchedAt.set(input.snapshot.stageKey, now);
    },
    acquireLease: async () => (h.leaseHeld ? "held" : "acquired"),
    upsertAgentTask: async () => true,
    deactivateAgentTask: async () => {},
  };
  const result = await runWorkroomDriveJob(now, { listRooms: async () => [room], effects, reconcileNesting: async () => 0, reconcileNotifications: async () => {} });
  return result.plans[0]!;
}

const drive = (h: Harness) => h.workspaceState.workroomDrive as Record<string, unknown>;

beforeEach(() => {
  Object.assign(flags.table, flags.original);
});

describe("AC-3C-MARKING-DURABLE", () => {
  it("kill switch: flag on, off, on — the room pauses with its stage and marking intact, then resumes the same marking", async () => {
    flags.table["rework-edge"] = true;
    const h = harness();
    expect(await tick(h, at(0))).toMatchObject({ action: "dispatch_agent", reason: "agent_stage" });
    h.evidence.push({ stageKey: "a", kind: "assurance-run", outcome: "completed", recordedAt: at(5) });
    expect(await tick(h, at(15))).toMatchObject({ action: "dispatch_agent", reason: "agent_stage" });
    expect(drive(h).stageKey).toBe("b");
    const onB = structuredClone(drive(h).marking) as { tokens: Array<{ node: string; enteredAt: string }> };
    expect(onB.tokens).toEqual([expect.objectContaining({ node: "stage:b", enteredAt: at(15).toISOString() })]);

    flags.table["rework-edge"] = false;
    expect(await tick(h, at(30))).toMatchObject({ action: "pause", reason: "construct_not_executable" });
    expect(drive(h).stageKey).toBe("b");
    expect(canonicalJson(drive(h).marking)).toBe(canonicalJson(onB));
    expect(drive(h).conclusion).toMatchObject({ kind: "blocked" });

    flags.table["rework-edge"] = true;
    // Resumed on b, not restarted at a: b's own latch holds (it was dispatched this cycle without writeback).
    expect(await tick(h, at(45))).toMatchObject({ action: "pause", reason: "executor_writeback_unavailable" });
    expect(drive(h).stageKey).toBe("b");
    expect((drive(h).marking as typeof onB).tokens).toEqual([expect.objectContaining({ node: "stage:b", enteredAt: at(15).toISOString() })]);
  });

  it("posture quiet, then balanced: a stored marking holding reworkTaken keeps it", async () => {
    flags.table["rework-edge"] = true;
    const stored = {
      format: "drive-marking/1", cycleKey: CYCLE,
      tokens: [{ node: "stage:a", enteredAt: at(-60).toISOString(), lastAction: "dispatch_agent", lastReason: "agent_stage", lastCycleKey: CYCLE }],
      iterations: { a: 1, b: 1 }, reworkTaken: { "edge:b->a": 1 }, deadlines: {}, children: {},
    };
    const h = harness({ workroomDrive: { kind: "workroom-drive", version: 1, action: "dispatch_agent", reason: "agent_stage", stageKey: "a", lastCycleKey: CYCLE, receipts: [], marking: stored, pendingAttentions: [] } });
    h.posture = "quiet";
    expect(await tick(h, at(0))).toMatchObject({ action: "do_not_wake", reason: "quiet" });
    expect(drive(h).marking).toEqual(stored);
    expect(drive(h).stageKey).toBe("a");
    expect(drive(h).pendingAttentions).toEqual([]);

    h.posture = "balanced";
    await tick(h, at(15));
    expect((drive(h).marking as typeof stored).reworkTaken).toEqual({ "edge:b->a": 1 });
    expect((drive(h).marking as typeof stored).iterations).toEqual({ a: 1, b: 1 });
  });

  it("a malformed stored marking survives a marking_unreadable pause byte-for-byte", async () => {
    const malformed = { format: "drive-marking/1", cycleKey: CYCLE, tokens: [{ node: "stage:nowhere" }], extra: [1, { two: 2 }] };
    const h = harness({ workroomDrive: { kind: "workroom-drive", version: 1, stageKey: "b", lastCycleKey: CYCLE, receipts: [], marking: malformed } });
    flags.table["rework-edge"] = true;
    for (const minutes of [0, 15, 30]) {
      expect(await tick(h, at(minutes))).toMatchObject({ action: "pause", reason: "marking_unreadable" });
      expect(canonicalJson(drive(h).marking)).toBe(canonicalJson(malformed));
      expect(drive(h).stageKey).toBe("b");
    }
  });

  it("a run in flight crosses the calendar boundary: its run key, token clock, iterations and rework counters are kept (BI-086DC167)", async () => {
    flags.table["rework-edge"] = true;
    const yesterday = `${REWORK_FIXTURE.key}@${REWORK_FIXTURE.version}:2026-03-01`;
    const inFlight = {
      format: "drive-marking/1", cycleKey: yesterday,
      tokens: [{ node: "stage:b", enteredAt: "2026-03-01T12:00:00.000Z", lastAction: "dispatch_agent", lastReason: "agent_stage", lastCycleKey: yesterday }],
      iterations: { a: 1, b: 1 }, reworkTaken: { "edge:b->a": 1 }, deadlines: {}, children: {},
    };
    // a's second pass completed yesterday, in this run.
    const receipts = [{ stageKey: "a", kind: "stage-evidence-recorded", iteration: 1, runKey: yesterday }];
    const h = harness({ workroomDrive: { kind: "workroom-drive", version: 1, action: "dispatch_agent", reason: "agent_stage", stageKey: "b", lastCycleKey: yesterday, receipts, marking: inFlight } });
    // The writeback latch is still bounded by the calendar day: b gets its one retry today.
    expect(await tick(h, at(0))).toMatchObject({ action: "dispatch_agent", reason: "agent_stage" });
    expect(drive(h).stageKey).toBe("b");
    expect(drive(h).lastCycleKey).toBe(CYCLE);
    expect(drive(h).marking).toMatchObject({
      cycleKey: yesterday,
      tokens: [{ node: "stage:b", enteredAt: "2026-03-01T12:00:00.000Z", lastAction: "dispatch_agent", lastCycleKey: CYCLE }],
      iterations: { a: 1, b: 1 },
      reworkTaken: { "edge:b->a": 1 },
    });
    expect(drive(h).receipts).toEqual(receipts);
  });

  it("a concluded run sleeps out the calendar day it concluded on, keeping the concluded marking; the next run starts the next day (BI-086DC167)", async () => {
    flags.table["rework-edge"] = true;
    const yesterday = `${REWORK_FIXTURE.key}@${REWORK_FIXTURE.version}:2026-03-01`;
    // Started yesterday, succeeded today.
    const concluded = { format: "drive-marking/1", cycleKey: yesterday, tokens: [], iterations: {}, reworkTaken: {}, deadlines: {}, children: {} };
    const h = harness({ workroomDrive: { kind: "workroom-drive", version: 1, action: "stop", reason: "success", stageKey: null, lastCycleKey: CYCLE, receipts: [], marking: concluded } });
    for (const minutes of [15, 30]) {
      expect(await tick(h, at(minutes))).toMatchObject({ action: "do_not_wake", reason: "cycle_complete" });
      expect(drive(h).marking).toEqual(concluded);
    }
    const tomorrow = new Date("2026-03-03T00:15:00.000Z");
    expect(await tick(h, tomorrow)).toMatchObject({ action: "dispatch_agent", reason: "agent_stage" });
    expect(drive(h).marking).toMatchObject({ cycleKey: `${REWORK_FIXTURE.key}@${REWORK_FIXTURE.version}:2026-03-03`, tokens: [{ node: "stage:a", enteredAt: tomorrow.toISOString() }] });
  });

  it("GUARD: at most one run starts per calendar key, and each run is keyed by the day it started (BI-086DC167)", async () => {
    flags.table["rework-edge"] = true;
    const h = harness();
    const runs: Array<{ runKey: string; startedOn: string }> = [];
    let lastRun: string | null = null;
    const complete = (stageKey: string, now: Date) => h.evidence.push({ stageKey, kind: "assurance-run", outcome: "completed", recordedAt: new Date(now.getTime() + 60_000) });
    const step = async (now: Date) => {
      await tick(h, now);
      const run = (drive(h).marking as { cycleKey: string; tokens: Array<{ enteredAt: string }> } | undefined);
      if (run && run.cycleKey !== lastRun) {
        lastRun = run.cycleKey;
        runs.push({ runKey: run.cycleKey, startedOn: `${REWORK_FIXTURE.key}@${REWORK_FIXTURE.version}:${now.toISOString().slice(0, 10)}` });
      }
    };
    const day = (date: string, time: string) => new Date(`${date}T${time}:00.000Z`);

    // Day 1: a run starts and succeeds the same day; a quiet tick and a live one later that day start nothing new.
    await step(day("2026-03-02", "09:00"));
    complete("a", day("2026-03-02", "09:00"));
    await step(day("2026-03-02", "09:15"));
    complete("b", day("2026-03-02", "09:15"));
    await step(day("2026-03-02", "09:30"));
    expect(drive(h)).toMatchObject({ action: "stop", reason: "success" });
    h.posture = "quiet";
    await step(day("2026-03-02", "10:00"));
    h.posture = "balanced";
    for (const time of ["10:15", "18:00", "23:45"]) {
      await step(day("2026-03-02", time));
      expect(drive(h)).toMatchObject({ action: "do_not_wake", reason: "cycle_complete" });
    }

    // Day 2: the next run starts, and runs over three days (b never completes until day 4).
    await step(day("2026-03-03", "00:00"));
    complete("a", day("2026-03-03", "00:00"));
    for (const date of ["2026-03-03", "2026-03-04"]) for (const time of ["06:00", "12:00", "23:45"]) await step(day(date, time));
    await step(day("2026-03-05", "00:15"));
    complete("b", day("2026-03-05", "00:15"));
    await step(day("2026-03-05", "00:30"));
    expect(drive(h)).toMatchObject({ action: "stop", reason: "success" });
    for (const time of ["06:00", "23:45"]) await step(day("2026-03-05", time));

    // Day 6: the third run.
    await step(day("2026-03-06", "00:00"));

    expect(runs).toEqual([
      { runKey: `${REWORK_FIXTURE.key}@${REWORK_FIXTURE.version}:2026-03-02`, startedOn: `${REWORK_FIXTURE.key}@${REWORK_FIXTURE.version}:2026-03-02` },
      { runKey: `${REWORK_FIXTURE.key}@${REWORK_FIXTURE.version}:2026-03-03`, startedOn: `${REWORK_FIXTURE.key}@${REWORK_FIXTURE.version}:2026-03-03` },
      { runKey: `${REWORK_FIXTURE.key}@${REWORK_FIXTURE.version}:2026-03-06`, startedOn: `${REWORK_FIXTURE.key}@${REWORK_FIXTURE.version}:2026-03-06` },
    ]);
    expect(new Set(runs.map((run) => run.runKey)).size).toBe(runs.length);
  });

  it("lease_held changes nothing", async () => {
    flags.table["rework-edge"] = true;
    const h = harness();
    await tick(h, at(0));
    h.evidence.push({ stageKey: "a", kind: "assurance-run", outcome: "completed", recordedAt: at(5) });
    const before = canonicalJson(h.workspaceState);
    h.leaseHeld = true;
    expect(await tick(h, at(15))).toMatchObject({ action: "dispatch_agent" });
    expect(h.persisted.at(-1)).toMatchObject({ observationOnly: true, graphShape: true });
    expect(canonicalJson(h.workspaceState)).toBe(before);
  });

  it("every persisted graph snapshot carries a marking", async () => {
    flags.table["rework-edge"] = true;
    const h = harness();
    await tick(h, at(0));
    flags.table["rework-edge"] = false;
    await tick(h, at(15));
    flags.table["rework-edge"] = true;
    h.posture = "quiet";
    await tick(h, at(30));
    for (const entry of h.persisted.filter((row) => !row.observationOnly)) {
      expect(entry.graphShape).toBe(true);
      expect(Object.hasOwn(entry.snapshot, "marking")).toBe(true);
    }
  });
});

describe("mergeWorkroomDriveSnapshot for a graph snapshot", () => {
  const marking = { format: "drive-marking/1", cycleKey: CYCLE, tokens: [], iterations: {}, reworkTaken: {}, deadlines: {}, children: {} };
  const current = { workroomDrive: { lastCycleKey: CYCLE, receipts: [], marking, pendingAttentions: [{ stageKey: "a", principalRef: "role:owner", reason: "governed_decision" }] } };

  it("keeps the row's marking and pendingAttentions when the snapshot lacks them, on the same cycle", () => {
    const merged = mergeWorkroomDriveSnapshot(current, { lastCycleKey: CYCLE, receipts: [] }, { graphShape: true });
    expect(merged.marking).toBe(marking);
    expect(merged.pendingAttentions).toEqual(current.workroomDrive.pendingAttentions);
  });

  it("keeps the snapshot's own marking, and never touches a sequential snapshot or another sequential cycle", () => {
    const own = { ...marking, tokens: [{ node: "stage:a", enteredAt: T0.toISOString() }] };
    expect(mergeWorkroomDriveSnapshot(current, { lastCycleKey: CYCLE, receipts: [], marking: own }, { graphShape: true }).marking).toBe(own);
    expect(Object.hasOwn(mergeWorkroomDriveSnapshot(current, { lastCycleKey: CYCLE, receipts: [] }), "marking")).toBe(false);
    expect(Object.hasOwn(mergeWorkroomDriveSnapshot(current, { lastCycleKey: "other", receipts: [] }), "marking")).toBe(false);
  });

  // BI-086DC167: on the graph path "the same cycle" is the same RUN, which crosses UTC midnight.
  it("compares run keys on the graph path: a tick crossing midnight in the same run keeps the row's receipts and marking; a new run does not merge", () => {
    const row = { workroomDrive: { lastCycleKey: CYCLE, receipts: [{ stageKey: "a", kind: "stage-evidence-recorded", iteration: 0, runKey: CYCLE }], marking } };
    const tomorrow = `${REWORK_FIXTURE.key}@${REWORK_FIXTURE.version}:2026-03-03`;
    const sameRun = mergeWorkroomDriveSnapshot(row, { lastCycleKey: tomorrow, receipts: [], marking }, { graphShape: true });
    expect(sameRun.receipts).toEqual(row.workroomDrive.receipts);
    const carried = mergeWorkroomDriveSnapshot(row, { lastCycleKey: tomorrow, receipts: [] }, { graphShape: true });
    expect(carried.marking).toBe(marking);
    expect(carried.receipts).toEqual(row.workroomDrive.receipts);
    const nextRun = mergeWorkroomDriveSnapshot(row, { lastCycleKey: tomorrow, receipts: [], marking: { ...marking, cycleKey: tomorrow } }, { graphShape: true });
    expect(nextRun.receipts).toEqual([]);
    // Sequential snapshots still compare the calendar key, exactly as before.
    expect(mergeWorkroomDriveSnapshot(row, { lastCycleKey: tomorrow, receipts: [] }).receipts).toEqual([]);
  });
});
