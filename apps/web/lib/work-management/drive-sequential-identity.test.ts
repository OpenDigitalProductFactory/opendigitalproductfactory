// AC-3C-SEQ-IDENTICAL: the characterization golden for every sequential room
// (BI-8875C9DF, GPP Phase 3c PR-3c-1). Design: docs/superpowers/specs/
// 2026-10-02-gpp-phase-3c-drive-graph-execution-design.md §5 item 2; plan:
// docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
// (PR-3c-1, "First commit: the golden").
//
// The golden was generated from the drive BEFORE any Phase 3c runtime change
// (the only runtime edit in that commit was the pure extraction of
// mergeWorkroomDriveSnapshot). Every later commit must reproduce it exactly.
//
// THE GENERATOR SECTION BELOW IS FROZEN. Later commits must not edit it; only
// the comparison section at the bottom may grow. A change that legitimately
// alters sequential drive behaviour regenerates the fixture in its own PR
// (DRIVE_SEQUENTIAL_GOLDEN_WRITE=1) with the diff reviewed — never by editing
// the generator.
//
// What it runs: the real runner, `runWorkroomDriveJob(now, { listRooms,
// effects, reconcileNesting, reconcileNotifications })`, over 20 seeded
// sequences for every registry definition (current and frozen prior); every
// fifth sequence runs past midnight so the daily cycle rolls over. Each
// tick feeds the previous tick's persisted snapshot back as the room's
// `workspaceState`, and builds the room the way the production loader does,
// by spreading `readStoredWorkroomDriveState(workspaceState)`. Persist applies
// the exported production merge (mergeWorkroomDriveSnapshot). The dispatch
// time a room carries into the next tick is derived from the activity rows
// the in-memory persist wrote, with the predicate `loadStageDispatchTimes`
// uses in SQL.
//
// What it records: for each sequence, the canonical JSON of every effect call
// (persist with its pre- and post-merge snapshot, lease, task upserts and
// deactivations, stall notices) and every runner result, in call order. The
// fixture keeps one sha256 digest of that trace per sequence plus a readable
// per-tick summary, because the full trace is tens of megabytes (one
// deviation from the plan's "fixture records canonicalJson of every
// snapshot", taken for repository size; the digest is still byte-level).
//
// Reason coverage: every reason in DRIVE_REASONS_BY_ACTION, plus
// executor_writeback_unavailable and cycle_complete, must be reached. Three
// cannot be reached through the runner with registry shapes, so they are
// direct resolveDrivePlan cases recorded in the same fixture: `no_posture`
// (postureLevelOf never returns null), `unknown_principal` (no registry stage
// names such a principal) and `person_stage` (no registry stage names a
// `person:` principal; the plan listed only the first two).

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { describe, expect, it } from "vitest";

import {
  mergeWorkroomDriveSnapshot,
  runWorkroomDriveJob,
  type WorkroomDriveEffects,
  type WorkroomDriveRoom,
} from "@/lib/queue/functions/workroom-drive";

import { DRIVE_REASONS_BY_ACTION } from "./drive-conclusion";
import { resolveDrivePlan, workroomDriveTaskId, type DriveResolutionInput } from "./drive-resolution";
import type { EffectiveHumanAccountability } from "./human-accountability";
import { projectPersistedWorkroomRoster, type ProjectableWorkroomParticipantAssignment } from "./room-participant-assignment";
import type { RecordedEvidence } from "./stage-evidence-receipts";
import { WORK_SHAPE_PRIOR_VERSIONS } from "./work-shape-prior-versions";
import { listWorkShapes, readWorkShapeDefinitionContract, type WorkShapeDefinition } from "./work-shapes";
import { readStoredWorkroomDriveState } from "./workroom-drive-state";
import { buildWorkroomPostureClaim } from "./workroom-posture-claim";
import { buildWorkShapeClaim } from "./workroom-shape-claim";

// ═════════════════════════════ GENERATOR (frozen) ═══════════════════════════

const FIXTURE_PATH = join(__dirname, "__fixtures__", "drive-sequential-golden.json");
const GOLDEN_FORMAT = "drive-sequential-golden/1";
const SEQUENCES_PER_DEFINITION = 20;
const BASE_SEED = 0x8875c9df;
const CLOCK_START = Date.parse("2026-01-01T00:00:00.000Z");
const TICK_MS = 15 * 60 * 1000;
const CYCLE_CROSSING_TICKS = 100;
const CLAIM_RECORDED_AT = new Date("2025-12-31T00:00:00.000Z");

const ALL_DEFINITIONS: readonly WorkShapeDefinition[] = [...listWorkShapes(), ...WORK_SHAPE_PRIOR_VERSIONS];

/** mulberry32, copied from interpreter-parity.test.ts:49-58. Deterministic across hosts. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)] as T;
}

/** Plain JSON: Dates become ISO strings, undefined members drop, exactly as a JSON column stores it. */
function plain<T>(value: T): unknown {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const RESOLVED_OWNER: EffectiveHumanAccountability = {
  state: "resolved",
  principalId: "PRN-GOLDEN-OWNER",
  source: "explicit-room",
  inheritedFrom: [],
};

function participant(
  workroomId: string,
  principalRef: string,
  kind: ProjectableWorkroomParticipantAssignment["kind"],
  roles: ProjectableWorkroomParticipantAssignment["roles"],
): ProjectableWorkroomParticipantAssignment {
  return {
    workroomId,
    principalRef,
    roles,
    assignmentSource: "explicit",
    enteredReason: null,
    currentWorkSummary: null,
    displayName: principalRef,
    kind,
    sponsorPrincipalRef: null,
    sponsorDisplayName: null,
    authoritySummary: "Acts within process-coordination authority",
  };
}

type SequenceSetup = {
  id: string;
  seed: number;
  roomRowId: string;
  capsuleId: string;
  scopeClaims: unknown[];
  participants: ProjectableWorkroomParticipantAssignment[];
  coordinatorEligibility: WorkroomDriveRoom["coordinatorEligibility"];
  ownerUserId: string | null;
  substrateReachable: boolean;
  substrateEmpty: boolean;
  ticks: number;
};

function setupSequence(definition: WorkShapeDefinition, shapeIndex: number, n: number, random: () => number): SequenceSetup {
  const seed = BASE_SEED + shapeIndex * 1000 + n;
  const roomRowId = `row-golden-${shapeIndex}-${n}`;
  const capsuleId = `WC-GOLDEN-${shapeIndex}-${n}`;
  const missingShape = random() < 0.03;
  const claim = buildWorkShapeClaim(
    { key: definition.key, version: missingShape ? "0.0.0" : definition.version },
    CLAIM_RECORDED_AT,
  );
  const scopeClaims: unknown[] = claim ? [claim] : [];
  const postureRoll = random();
  if (postureRoll < 0.08) scopeClaims.push(buildWorkroomPostureClaim({ proactivityLevel: "quiet" }, CLAIM_RECORDED_AT));
  else if (postureRoll < 0.2) scopeClaims.push(buildWorkroomPostureClaim({ proactivityLevel: "assertive" }, CLAIM_RECORDED_AT));
  else if (postureRoll < 0.3) scopeClaims.push(buildWorkroomPostureClaim({ proactivityLevel: "balanced" }, CLAIM_RECORDED_AT));

  const rosterRoll = random();
  let participants: ProjectableWorkroomParticipantAssignment[];
  let coordinatorEligibility: WorkroomDriveRoom["coordinatorEligibility"] = { jsi: "eligible", authorityBinding: "eligible" };
  if (rosterRoll < 0.75) {
    participants = [participant(roomRowId, "PRN-COORD", "agent", ["coordinator"])];
  } else if (rosterRoll < 0.83) {
    participants = [participant(roomRowId, "PRN-MEMBER", "person", ["contributor"])];
  } else if (rosterRoll < 0.9) {
    // Two active coordinators throw inside projectPersistedWorkroomRoster, so the
    // escalate path is reached through an ineligible AI coordinator instead.
    participants = [participant(roomRowId, "PRN-COORD", "agent", ["coordinator"])];
    coordinatorEligibility = { jsi: "eligible", authorityBinding: "narrowed" };
  } else if (rosterRoll < 0.95) {
    participants = [participant(roomRowId, "PRN-COORD-PERSON", "person", ["coordinator"])];
  } else {
    participants = [participant(roomRowId, "PRN-COORD", "agent", ["coordinator"])];
    coordinatorEligibility = { jsi: "stale", authorityBinding: "eligible" };
  }

  return {
    id: `${definition.key}@${definition.version}#${n}`,
    seed,
    roomRowId,
    capsuleId,
    scopeClaims,
    participants,
    coordinatorEligibility,
    ownerUserId: random() < 0.05 ? null : "user-golden-owner",
    substrateReachable: random() >= 0.03,
    substrateEmpty: random() < 0.03,
    // Every fifth sequence runs 100 ticks, past midnight (96 ticks a day), so
    // the golden also covers a cycle rollover: the writeback latch releasing,
    // a completed cycle waking again, and the merge across a new cycle key.
    ticks: n % 5 === 4 ? CYCLE_CROSSING_TICKS : definition.stages.length * 3 + 6,
  };
}

type ActivityRow = { kind: string; payload: Record<string, unknown>; recordedAt: Date };

/** The in-memory model of loadStageDispatchTimes' SQL predicate (workroom-drive-data.ts). */
function stageDispatchedAtFrom(activity: readonly ActivityRow[], workspaceState: unknown): Date | null {
  const drive = asObject(asObject(workspaceState)?.workroomDrive);
  const stageKey = typeof drive?.stageKey === "string" ? drive.stageKey : null;
  if (!drive || stageKey === null) return null;
  const pending = asObject(drive.pendingAttention);
  let latest: Date | null = null;
  for (const row of activity) {
    if (row.payload.stageKey !== stageKey) continue;
    const dispatch = row.kind === "workroom-drive"
      && row.payload.action === "dispatch_agent"
      && row.payload.reason === "agent_stage"
      && typeof drive.lastCycleKey === "string"
      && row.payload.lastCycleKey === drive.lastCycleKey;
    const ask = row.kind === "workroom-drive-attention"
      && row.payload.action === "attention"
      && row.payload.reason === "governed_decision"
      && pending?.reason === "governed_decision"
      && pending.stageKey === row.payload.stageKey;
    if (!dispatch && !ask) continue;
    if (!latest || row.recordedAt.getTime() >= latest.getTime()) latest = row.recordedAt;
  }
  return latest;
}

function evidenceRow(
  random: () => number,
  definition: WorkShapeDefinition,
  currentStageKey: string | null,
  now: Date,
): RecordedEvidence | null {
  const roll = random();
  if (roll >= 0.6) return null;
  const keys = definition.stages.map((stage) => stage.key);
  const stageKey = roll < 0.45 ? currentStageKey ?? keys[0] ?? null : roll < 0.56 ? pick(random, keys) : null;
  const stage = definition.stages.find((entry) => entry.key === stageKey);
  const declared = stage && stage.evidence.length > 0 ? stage.evidence : ["decision-record"];
  const kindRoll = random();
  const kind = kindRoll < 0.85 ? pick(random, declared) : kindRoll < 0.95 ? "undeclared-kind" : null;
  const outcomeRoll = random();
  const outcome = outcomeRoll < 0.75 ? "completed" : outcomeRoll < 0.93 ? "blocked" : null;
  const offset = random() < 0.8 ? 60_000 : 86_400_000;
  return { stageKey, kind, outcome, recordedAt: new Date(now.getTime() - offset) };
}

type SequenceTrace = { digest: string; summary: string; reasons: string[]; taskIds: string[]; snapshots: Record<string, unknown>[] };

async function runSequence(definition: WorkShapeDefinition, shapeIndex: number, n: number): Promise<SequenceTrace> {
  const random = mulberry32(BASE_SEED + shapeIndex * 1000 + n);
  const setup = setupSequence(definition, shapeIndex, n, random);
  const contract = readWorkShapeDefinitionContract(definition);
  const trace: unknown[] = [];
  const summary: string[] = [];
  const reasons: string[] = [];
  const taskIds: string[] = [];
  const snapshots: Record<string, unknown>[] = [];
  const activity: ActivityRow[] = [];
  const evidence: RecordedEvidence[] = [];
  let workspaceState: Record<string, unknown> = {};
  let lease: { expiresAt: Date | null; holder: string | null } = { expiresAt: null, holder: "PRN-LEASE-HOLDER" };
  let budgetUsage: { kind: string; used: number }[] = [];
  let stopConditionHits: string[] = [];
  let reviewDue = false;

  for (let tick = 0; tick < setup.ticks; tick += 1) {
    const now = new Date(CLOCK_START + tick * TICK_MS);
    const stored = readStoredWorkroomDriveState(workspaceState);

    // Seeded room facts for this tick. The per-tick hazard is scaled so a
    // day-crossing sequence meets as many stops as a short one, and so often
    // lives long enough to roll its cycle over.
    const hazard = (0.02 * (definition.stages.length * 3 + 6)) / setup.ticks;
    if (budgetUsage.length === 0 && contract.budgets.length > 0 && random() < hazard) {
      const budget = contract.budgets[0]!;
      budgetUsage = [{ kind: budget.kind, used: budget.limit }];
    }
    if (stopConditionHits.length === 0 && random() < hazard) stopConditionHits = ["failure"];
    if (!reviewDue && random() < hazard) reviewDue = true;
    const row = evidenceRow(random, definition, stored.currentStageKey, now);
    if (row) evidence.push(row);
    const leaseHeld = random() < 0.1;
    const upsertFails = random() < 0.03;
    const concurrentReceipt = random() < 0.05;
    const stallNoticeFails = random() < 0.2;
    const externalStage = pick(random, definition.stages.map((stage) => stage.key));

    const room: WorkroomDriveRoom = {
      id: setup.roomRowId,
      capsuleId: setup.capsuleId,
      coordinatorEligibility: setup.coordinatorEligibility,
      scopeClaims: setup.scopeClaims,
      workspaceState,
      leaseExpiresAt: lease.expiresAt,
      leaseHolderPrincipalId: lease.holder,
      ownerUserId: setup.ownerUserId,
      participants: setup.participants,
      objective: `Golden objective for ${setup.id}`,
      ...stored,
      ...(budgetUsage.length > 0 ? { budgetUsage } : {}),
      ...(stopConditionHits.length > 0 ? { stopConditionHits } : {}),
      ...(reviewDue ? { reviewDue } : {}),
      substrateReachable: setup.substrateReachable,
      substrateEmpty: setup.substrateEmpty,
      recordedEvidence: [...evidence].reverse(),
      stageDispatchedAt: stageDispatchedAtFrom(activity, workspaceState),
    };

    const calls: unknown[] = [];
    const effects: WorkroomDriveEffects = {
      resolveAccountability: async (roomId) => {
        calls.push({ effect: "resolveAccountability", roomId });
        return RESOLVED_OWNER;
      },
      notifyStall: async (input) => {
        calls.push({ effect: "notifyStall", input: plain(input) });
        if (stallNoticeFails) throw new Error("golden: stall notice failed");
      },
      persist: async (input) => {
        let current: Record<string, unknown> = workspaceState;
        if (concurrentReceipt) {
          const drive = asObject(current.workroomDrive);
          if (drive) {
            const receipts = Array.isArray(drive.receipts) ? drive.receipts : [];
            current = { ...current, workroomDrive: { ...drive, receipts: [...receipts, { stageKey: externalStage, kind: "external-receipt" }] } };
          }
        }
        let written: Record<string, unknown> | null = null;
        if (!input.observationOnly) {
          written = mergeWorkroomDriveSnapshot(current, input.snapshot);
          workspaceState = plain({ ...current, workroomDrive: written }) as Record<string, unknown>;
          snapshots.push(written);
        }
        if (!input.quiet) activity.push({ kind: input.activityKind, payload: plain(input.payload) as Record<string, unknown>, recordedAt: now });
        if (typeof input.snapshot.reason === "string") reasons.push(input.snapshot.reason);
        calls.push({ effect: "persist", input: plain(input), written: plain(written) });
      },
      acquireLease: async (input) => {
        calls.push({ effect: "acquireLease", input: plain(input) });
        if (leaseHeld) return "held";
        lease = { expiresAt: input.expiresAt, holder: input.holderPrincipalId };
        return "acquired";
      },
      upsertAgentTask: async (input) => {
        calls.push({ effect: "upsertAgentTask", input: plain(input) });
        if (upsertFails) return false;
        taskIds.push(input.taskId);
        return true;
      },
      deactivateAgentTask: async (taskId) => {
        calls.push({ effect: "deactivateAgentTask", taskId });
        taskIds.push(taskId);
      },
    };

    const result = await runWorkroomDriveJob(now, {
      listRooms: async () => [room],
      effects,
      reconcileNesting: async () => 0,
      reconcileNotifications: async () => {},
    });
    for (const plan of result.plans) reasons.push(plan.reason);
    const persisted = asObject(asObject(workspaceState)?.workroomDrive);
    summary.push(result.plans.map((plan) => `${plan.reason}@${String(persisted?.stageKey ?? "-")}`).join(","));
    trace.push({ tick, now: now.toISOString(), result: plain(result), calls });
  }

  // Run-length encoded, so a long latch or stop reads as one entry.
  const runs: string[] = [];
  for (let index = 0; index < summary.length;) {
    let end = index;
    while (end + 1 < summary.length && summary[end + 1] === summary[index]) end += 1;
    runs.push(end > index ? `${summary[index]} x${end - index + 1}` : summary[index]!);
    index = end + 1;
  }
  return {
    digest: `sha256:${createHash("sha256").update(canonicalJson(trace)).digest("hex")}`,
    summary: runs.join(" | "),
    reasons,
    taskIds,
    snapshots,
  };
}

type DirectCase = { name: string; input: DriveResolutionInput };

/** Reasons the runner cannot reach with registry shapes, generated from direct resolveDrivePlan calls. */
function directCases(): DirectCase[] {
  const base = readWorkShapeDefinitionContract(ALL_DEFINITIONS[0]!);
  const participants = projectPersistedWorkroomRoster({
    assignments: [participant("row-direct", "PRN-COORD", "agent", ["coordinator"])],
    presencePrincipalRefs: [],
  });
  const common = {
    roomId: "WC-GOLDEN-DIRECT",
    collaborationShape: null,
    participants,
    currentStageKey: null,
    receipts: [],
    budgetUsage: [],
    stopConditionHits: [],
    reviewDue: false,
    substrateReachable: true,
    substrateEmpty: false,
    coordinatorEligibility: { jsi: "eligible" as const, authorityBinding: "eligible" as const },
    now: new Date(CLOCK_START),
  };
  const withFirstStagePrincipal = (principal: string) => ({
    ...base,
    stages: base.stages.map((stage, index) =>
      index === 0 ? { ...stage, accountablePrincipalRef: principal, advance: { kind: "status-change" as const, condition: stage.advance.condition } } : stage),
  });
  return [
    { name: "no_posture", input: { ...common, definition: base, postureLevel: null } },
    { name: "unknown_principal", input: { ...common, definition: withFirstStagePrincipal("service:golden"), postureLevel: "balanced" } },
    { name: "person_stage", input: { ...common, definition: withFirstStagePrincipal("person:golden"), postureLevel: "balanced" } },
  ];
}

type GoldenFixture = {
  format: string;
  sequences: Array<{ id: string; seed: number; digest: string; summary: string }>;
  direct: Array<{ name: string; reason: string; digest: string }>;
};

async function generateGolden(): Promise<{ fixture: GoldenFixture; traces: Map<string, SequenceTrace> }> {
  const sequences: GoldenFixture["sequences"] = [];
  const traces = new Map<string, SequenceTrace>();
  for (const [shapeIndex, definition] of ALL_DEFINITIONS.entries()) {
    for (let n = 0; n < SEQUENCES_PER_DEFINITION; n += 1) {
      const trace = await runSequence(definition, shapeIndex, n);
      const id = `${definition.key}@${definition.version}#${n}`;
      traces.set(id, trace);
      sequences.push({ id, seed: BASE_SEED + shapeIndex * 1000 + n, digest: trace.digest, summary: trace.summary });
    }
  }
  const direct = directCases().map(({ name, input }) => {
    const plan = resolveDrivePlan(input);
    return { name, reason: plan.reason, digest: `sha256:${createHash("sha256").update(canonicalJson(plain(plan))).digest("hex")}` };
  });
  return { fixture: { format: GOLDEN_FORMAT, sequences, direct }, traces };
}

// ═══════════════════════════ COMPARISON (may grow) ══════════════════════════

const generated = generateGolden();
generated.catch(() => undefined); // each test awaits it and reports the failure itself

describe("AC-3C-SEQ-IDENTICAL: sequential rooms are byte-identical to the pre-3c golden", () => {
  it("writes the fixture only when explicitly asked", async () => {
    const { fixture } = await generated;
    if (process.env.DRIVE_SEQUENTIAL_GOLDEN_WRITE === "1") {
      writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`);
    }
    expect(fixture.sequences.length).toBe(ALL_DEFINITIONS.length * SEQUENCES_PER_DEFINITION);
  }, 300_000);

  it("every sequence and direct case reproduces the committed golden exactly", async () => {
    const { fixture } = await generated;
    const golden = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as GoldenFixture;
    expect(golden.format).toBe(GOLDEN_FORMAT);
    expect(fixture.sequences.map((entry) => entry.id)).toEqual(golden.sequences.map((entry) => entry.id));
    const mismatched = fixture.sequences
      .map((entry, index) => ({ entry, expected: golden.sequences[index]! }))
      .filter(({ entry, expected }) => entry.digest !== expected.digest || entry.summary !== expected.summary)
      .map(({ entry, expected }) => ({ id: entry.id, seed: entry.seed, expected: expected.summary, actual: entry.summary }));
    expect(mismatched).toEqual([]);
    expect(fixture.direct).toEqual(golden.direct);
  }, 300_000);

  it("reaches every drive reason, plus executor_writeback_unavailable and cycle_complete", async () => {
    const { fixture, traces } = await generated;
    const reached = new Set<string>([
      ...[...traces.values()].flatMap((trace) => trace.reasons),
      ...fixture.direct.map((entry) => entry.reason),
    ]);
    const expected = [
      ...Object.values(DRIVE_REASONS_BY_ACTION).flat(),
      "executor_writeback_unavailable",
      "cycle_complete",
    ];
    expect(expected.filter((reason) => !reached.has(reason))).toEqual([]);
  }, 300_000);

  it("no persisted sequential snapshot carries a marking or pendingAttentions key", async () => {
    const { traces } = await generated;
    for (const [id, trace] of traces) {
      for (const snapshot of trace.snapshots) {
        expect(Object.hasOwn(snapshot, "marking"), id).toBe(false);
        expect(Object.hasOwn(snapshot, "pendingAttentions"), id).toBe(false);
      }
    }
  }, 300_000);

  it("every scheduled or deactivated task id is the room's single deterministic id", async () => {
    const { traces } = await generated;
    for (const [shapeIndex, definition] of ALL_DEFINITIONS.entries()) {
      for (let n = 0; n < SEQUENCES_PER_DEFINITION; n += 1) {
        const trace = traces.get(`${definition.key}@${definition.version}#${n}`)!;
        const expected = workroomDriveTaskId(`WC-GOLDEN-${shapeIndex}-${n}`, definition.key);
        expect([...new Set(trace.taskIds)].filter((taskId) => taskId !== expected)).toEqual([]);
      }
    }
  }, 300_000);
});
