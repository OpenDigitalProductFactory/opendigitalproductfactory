// BI-853120EE — a sequential standing room's stage receipts are scoped to the
// RUN that earned them, through the real runner (runWorkroomDriveJob).
//
// The defect: applyDrivePlan copies room.receipts into every snapshot
// (workroom-drive.ts, `receipts` in applyDrivePlan and the snapshot it
// persists), and nothing ever clears them. A sequential run concludes with
// stop/success (or sleeps on cycle_complete, BI-D10BB58B). The next calendar
// cycle starts a new run at stage 1 (the success snapshot persists no stage),
// and nextStageKey then walks yesterday's receipts: the agent stage advances on
// yesterday's evidence receipt and the governed stage completes on yesterday's
// decision receipt. The room records success with no person deciding.
//
// What a "run" is for a sequential room: it starts at the first tick after the
// previous run concluded (prior tick stop/success or do_not_wake/cycle_complete
// on an earlier cycle key — the same predicate as cycleCompleted in
// drive-plan-stage.ts), and it lasts until it concludes. It does NOT end at UTC
// midnight: a run in flight across the boundary keeps its receipts.
//
// The harness mirrors the characterization golden
// (drive-sequential-identity.test.ts): each tick feeds the previous persisted
// snapshot back as workspaceState, builds the room the way the production
// loader does (spreading readStoredWorkroomDriveState), applies the production
// persist merge (mergeWorkroomDriveSnapshot), and derives the stage's dispatch
// time from the activity rows written so far with the predicate
// loadStageDispatchTimes uses in SQL.

import { describe, expect, it } from "vitest";

import type { RecordedEvidence } from "@/lib/work-management/stage-evidence-receipts";
import { mergeWorkroomDriveSnapshot } from "@/lib/work-management/workroom-drive-snapshot-merge";
import { readStoredWorkroomDriveState } from "@/lib/work-management/workroom-drive-state";
import { buildWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";

import { runWorkroomDriveJob, type WorkroomDriveEffects, type WorkroomDriveRoom } from "./workroom-drive";

// credential-hygiene-watch@1.0.0 (registry, sequential): `scan` is
// agent:security-engineer (evidence assurance-run), `rotate` is
// role:security-owner, governed-decision (evidence decision-record).
const SHAPE = { key: "credential-hygiene-watch", version: "1.0.0" } as const;
// market-research-brief@1.0.0 (registry, sequential, triggers: claim only):
// `frame` and `research` are agent stages, `act-on-it` is a role-owned
// governed decision.
const CLAIM_SHAPE = { key: "market-research-brief", version: "1.0.0" } as const;
const runKeyOn = (day: string, shape: { key: string; version: string } = SHAPE) => `${shape.key}@${shape.version}:${day}`;

type ActivityRow = { kind: string; payload: Record<string, unknown>; recordedAt: Date };
type Tick = { at: string; action: string; reason: string; stageKey: unknown; receipts: unknown; runKey: unknown };

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The in-memory model of loadStageDispatchTimes' SQL predicate (workroom-drive-data.ts). */
function stageDispatchedAtFrom(activity: readonly ActivityRow[], workspaceState: unknown): Date | null {
  const drive = asObject(asObject(workspaceState)?.workroomDrive);
  const stageKey = typeof drive?.stageKey === "string" ? drive.stageKey : null;
  if (!drive || stageKey === null) return null;
  const pending = asObject(drive.pendingAttention);
  let latest: Date | null = null;
  for (const row of activity) {
    if (row.payload.stageKey !== stageKey) continue;
    const dispatch = row.kind === "workroom-drive" && row.payload.action === "dispatch_agent"
      && row.payload.reason === "agent_stage" && row.payload.lastCycleKey === drive.lastCycleKey;
    const ask = row.kind === "workroom-drive-attention" && row.payload.action === "attention"
      && row.payload.reason === "governed_decision" && pending?.reason === "governed_decision"
      && pending.stageKey === row.payload.stageKey;
    if ((dispatch || ask) && (!latest || row.recordedAt >= latest)) latest = row.recordedAt;
  }
  return latest;
}

/** One standing room driven tick by tick through the real runner. */
function standingRoom(shape: { key: string; version: string } = SHAPE) {
  let workspaceState: Record<string, unknown> = {};
  let lease: { expiresAt: Date | null; holder: string | null } = { expiresAt: null, holder: "PRN-LEASE" };
  const activity: ActivityRow[] = [];
  const evidence: RecordedEvidence[] = [];
  const ticks: Tick[] = [];
  /** Receipts another writer lands on the row between this tick's read and its write. */
  let concurrentReceipts: { stageKey: string; kind: string }[] = [];

  return {
    ticks,
    get drive() { return asObject(workspaceState.workroomDrive); },
    record(at: string, stageKey: string, kind: string) {
      evidence.push({ stageKey, kind, outcome: "completed", recordedAt: new Date(at) });
    },
    landConcurrently(receipts: { stageKey: string; kind: string }[]) { concurrentReceipts = receipts; },
    async tick(at: string): Promise<Tick> {
      const now = new Date(at);
      const stored = readStoredWorkroomDriveState(workspaceState);
      const room: WorkroomDriveRoom = {
        id: "row-run-scope",
        capsuleId: "WC-RUN-SCOPE",
        scopeClaims: [buildWorkShapeClaim(shape, new Date("2026-01-01T00:00:00.000Z"))],
        workspaceState,
        leaseExpiresAt: lease.expiresAt,
        leaseHolderPrincipalId: lease.holder,
        ownerUserId: "user-owner",
        participants: [{
          workroomId: "row-run-scope", principalRef: "PRN-COORD", roles: ["coordinator"], assignmentSource: "explicit",
          enteredReason: null, currentWorkSummary: null, displayName: "Overseer", kind: "agent",
          sponsorPrincipalRef: null, sponsorDisplayName: null, authoritySummary: "Acts within process-coordination authority",
        }],
        coordinatorEligibility: { jsi: "eligible", authorityBinding: "eligible" },
        ...stored,
        substrateReachable: true,
        substrateEmpty: false,
        recordedEvidence: [...evidence].filter((row) => row.recordedAt <= now).reverse(),
        stageDispatchedAt: stageDispatchedAtFrom(activity, workspaceState),
      };
      const effects: WorkroomDriveEffects = {
        resolveAccountability: async () => ({ state: "resolved", principalId: "PRN-OWNER", source: "explicit-room", inheritedFrom: [] }),
        persist: async (input) => {
          let current = workspaceState;
          if (concurrentReceipts.length > 0) {
            const drive = asObject(current.workroomDrive) ?? {};
            const existing = Array.isArray(drive.receipts) ? drive.receipts : [];
            current = { ...current, workroomDrive: { ...drive, receipts: [...existing, ...concurrentReceipts] } };
            concurrentReceipts = [];
          }
          if (!input.observationOnly) {
            const written = mergeWorkroomDriveSnapshot(current, input.snapshot);
            workspaceState = JSON.parse(JSON.stringify({ ...current, workroomDrive: written })) as Record<string, unknown>;
          }
          if (!input.quiet) {
            activity.push({ kind: input.activityKind, payload: JSON.parse(JSON.stringify(input.payload)) as Record<string, unknown>, recordedAt: now });
          }
        },
        acquireLease: async (input) => {
          lease = { expiresAt: input.expiresAt, holder: input.holderPrincipalId };
          return "acquired";
        },
        upsertAgentTask: async () => true,
        deactivateAgentTask: async () => {},
      };
      const result = await runWorkroomDriveJob(now, {
        listRooms: async () => [room],
        effects,
        reconcileNesting: async () => 0,
        reconcileNotifications: async () => {},
      });
      const plan = result.plans[0]!;
      const drive = asObject(workspaceState.workroomDrive);
      const tick = { at, action: plan.action, reason: plan.reason, stageKey: drive?.stageKey ?? null, receipts: drive?.receipts ?? [], runKey: drive?.runKey ?? null };
      ticks.push(tick);
      return tick;
    },
  };
}

/** Day 1: one whole governed run — scan earns its evidence, a person decides, the run succeeds and sleeps. */
async function concludedRunOnDay1() {
  const room = standingRoom();
  expect(await room.tick("2026-10-05T09:00:00.000Z")).toMatchObject({ action: "dispatch_agent", stageKey: "scan" });
  room.record("2026-10-05T09:10:00.000Z", "scan", "assurance-run");
  expect(await room.tick("2026-10-05T09:15:00.000Z")).toMatchObject({ action: "attention", reason: "governed_decision", stageKey: "rotate" });
  room.record("2026-10-05T09:20:00.000Z", "rotate", "decision-record"); // the person decides, on day 1
  expect(await room.tick("2026-10-05T09:30:00.000Z")).toMatchObject({ action: "stop", reason: "success" });
  expect(await room.tick("2026-10-05T09:45:00.000Z")).toMatchObject({ action: "do_not_wake", reason: "cycle_complete" });
  return room;
}

describe("BI-853120EE: a sequential room's receipts are scoped to the run that earned them", () => {
  it("AC-RECEIPT-RUN-SCOPED: the day after a success, the governed stage does not complete without a decision recorded in the new run", async () => {
    const room = await concludedRunOnDay1();

    // Day 2. No new evidence and no new decision is recorded.
    const day2 = [
      await room.tick("2026-10-06T00:05:00.000Z"),
      await room.tick("2026-10-06T00:20:00.000Z"),
      await room.tick("2026-10-06T00:35:00.000Z"),
      await room.tick("2026-10-06T00:50:00.000Z"),
    ];

    // The new run starts at stage 1 and must re-earn it: it is dispatched,
    // produces nothing, and fails closed on the writeback latch.
    expect(day2.map(({ action, reason, stageKey }) => `${action}/${reason}@${String(stageKey)}`)).toEqual([
      "dispatch_agent/agent_stage@scan",
      "pause/executor_writeback_unavailable@scan",
      "pause/executor_writeback_unavailable@scan",
      "pause/executor_writeback_unavailable@scan",
    ]);
    // Nobody decided on day 2, so day 2 never succeeds and never reaches the governed stage.
    expect(day2.filter((tick) => tick.action === "stop" && tick.reason === "success")).toEqual([]);
    expect(day2.filter((tick) => tick.stageKey === "rotate")).toEqual([]);
    // The new run carries no completing receipt of the concluded run.
    const completing = (receipts: unknown) =>
      (receipts as { stageKey: string; kind: string }[]).filter((receipt) => receipt.kind !== "blocked").map((receipt) => receipt.stageKey);
    expect(completing(day2[0]!.receipts)).toEqual([]);
  });

  it("AC-RECEIPT-RUN-SCOPED: the new run completes once it re-earns every stage and a person decides again", async () => {
    const room = await concludedRunOnDay1();
    expect(await room.tick("2026-10-06T00:05:00.000Z")).toMatchObject({ action: "dispatch_agent", stageKey: "scan" });
    room.record("2026-10-06T00:10:00.000Z", "scan", "assurance-run");
    // scan is re-earned from day-2 evidence: the room asks for today's decision.
    expect(await room.tick("2026-10-06T00:20:00.000Z")).toMatchObject({ action: "attention", reason: "governed_decision", stageKey: "rotate" });
    // ...and keeps asking until a person decides in THIS run.
    expect(await room.tick("2026-10-06T00:35:00.000Z")).toMatchObject({ action: "attention", reason: "governed_decision", stageKey: "rotate" });
    room.record("2026-10-06T00:40:00.000Z", "rotate", "decision-record");
    expect(await room.tick("2026-10-06T00:50:00.000Z")).toMatchObject({ action: "stop", reason: "success" });
  });

  it("AC-IN-FLIGHT-SAFE: a run in flight across midnight keeps the receipts it earned before midnight", async () => {
    const room = standingRoom();
    expect(await room.tick("2026-10-05T23:15:00.000Z")).toMatchObject({ action: "dispatch_agent", stageKey: "scan" });
    room.record("2026-10-05T23:20:00.000Z", "scan", "assurance-run");
    expect(await room.tick("2026-10-05T23:30:00.000Z")).toMatchObject({ action: "attention", reason: "governed_decision", stageKey: "rotate" });
    // Midnight passes with the run waiting on its decision: the run does not reset.
    expect(await room.tick("2026-10-06T00:00:00.000Z")).toMatchObject({ action: "attention", reason: "governed_decision", stageKey: "rotate" });
    room.record("2026-10-06T00:05:00.000Z", "rotate", "decision-record");
    // The decision lands in the same run; scan's day-1 receipt still counts, so the run succeeds.
    expect(await room.tick("2026-10-06T00:15:00.000Z")).toMatchObject({ action: "stop", reason: "success" });
    // One run throughout, keyed by the day it started.
    expect([...new Set(room.ticks.map((tick) => tick.runKey))]).toEqual([runKeyOn("2026-10-05")]);
  });

  it("AC-IN-FLIGHT-SAFE: a same-run receipt landed concurrently on the tick that crosses midnight is not dropped by the persist merge", async () => {
    const room = standingRoom();
    expect(await room.tick("2026-10-05T23:30:00.000Z")).toMatchObject({ action: "dispatch_agent", stageKey: "scan" });
    // Between the first post-midnight tick's read and its write, another writer
    // (the run-now drive racing the scheduled one) lands this run's scan receipt.
    room.landConcurrently([{ stageKey: "scan", kind: "stage-evidence-recorded" }]);
    await room.tick("2026-10-06T00:00:00.000Z");
    const receipts = (room.drive?.receipts ?? []) as { stageKey: string; kind: string }[];
    expect(receipts.filter((receipt) => receipt.kind !== "blocked")).toEqual([
      expect.objectContaining({ stageKey: "scan", kind: "stage-evidence-recorded" }),
    ]);
  });

  it("a claim-triggered room's successful run is final: it is not driven back onto stage 1 on a later day (WWMD DI-8DCB9A4B566C)", async () => {
    const room = standingRoom(CLAIM_SHAPE);
    expect(await room.tick("2026-10-05T09:00:00.000Z")).toMatchObject({ action: "dispatch_agent", stageKey: "frame" });
    room.record("2026-10-05T09:05:00.000Z", "frame", "research-question");
    expect(await room.tick("2026-10-05T09:15:00.000Z")).toMatchObject({ action: "dispatch_agent", stageKey: "research" });
    room.record("2026-10-05T09:20:00.000Z", "research", "cited-brief");
    expect(await room.tick("2026-10-05T09:30:00.000Z")).toMatchObject({ action: "attention", reason: "governed_decision", stageKey: "act-on-it" });
    room.record("2026-10-05T09:35:00.000Z", "act-on-it", "decision-record");
    expect(await room.tick("2026-10-05T09:45:00.000Z")).toMatchObject({ action: "stop", reason: "success" });

    const later = [
      await room.tick("2026-10-05T10:00:00.000Z"),
      await room.tick("2026-10-06T00:05:00.000Z"),
      await room.tick("2026-10-06T00:20:00.000Z"),
      await room.tick("2026-10-09T12:00:00.000Z"),
    ];
    expect(later.map(({ action, reason, stageKey }) => `${action}/${reason}@${String(stageKey)}`)).toEqual([
      "do_not_wake/cycle_complete@null",
      "do_not_wake/cycle_complete@null",
      "do_not_wake/cycle_complete@null",
      "do_not_wake/cycle_complete@null",
    ]);
    // The concluded run is the only run the room ever had.
    expect([...new Set(room.ticks.map((tick) => tick.runKey))]).toEqual([runKeyOn("2026-10-05", CLAIM_SHAPE)]);
  });

  it("at most one run starts per calendar key: a run that crosses midnight and succeeds sleeps out that day, and the next run starts the day after", async () => {
    const room = standingRoom();
    await room.tick("2026-10-05T23:45:00.000Z"); // run 1 starts on day 1 and dispatches scan
    room.record("2026-10-05T23:50:00.000Z", "scan", "assurance-run");
    expect(await room.tick("2026-10-06T00:00:00.000Z")).toMatchObject({ action: "attention", stageKey: "rotate" });
    room.record("2026-10-06T00:10:00.000Z", "rotate", "decision-record");
    expect(await room.tick("2026-10-06T00:15:00.000Z")).toMatchObject({ action: "stop", reason: "success" });
    // The rest of day 2 is the cycle the run concluded on: no second run, even with fresh evidence.
    room.record("2026-10-06T08:00:00.000Z", "scan", "assurance-run");
    for (const at of ["2026-10-06T00:30:00.000Z", "2026-10-06T08:15:00.000Z", "2026-10-06T23:45:00.000Z"]) {
      expect(await room.tick(at)).toMatchObject({ action: "do_not_wake", reason: "cycle_complete" });
    }
    // Day 3 starts run 2, with no receipts carried from run 1.
    const day3 = await room.tick("2026-10-07T00:05:00.000Z");
    expect(day3).toMatchObject({ action: "dispatch_agent", stageKey: "scan", runKey: runKeyOn("2026-10-07") });
    expect((day3.receipts as unknown[]).length).toBe(0);

    const keys = room.ticks.map((tick) => tick.runKey);
    expect([...new Set(keys)]).toEqual([runKeyOn("2026-10-05"), runKeyOn("2026-10-07")]);
    // Each run's ticks are contiguous: a run key never comes back once another has started.
    expect(keys.filter((key, index) => index > 0 && key !== keys[index - 1]).length).toBe(1);
    // Every receipt a tick held belonged to that tick's run.
    for (const tick of room.ticks) {
      for (const receipt of tick.receipts as { runKey?: string }[]) expect(receipt.runKey, tick.at).toBe(tick.runKey);
    }
  });
});
