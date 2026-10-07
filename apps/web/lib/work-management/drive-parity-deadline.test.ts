// AC-3C-DEADLINE-PARITY (BI-8875C9DF, GPP Phase 3c PR-3c-4). Design:
// docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md
// §6 ("The parity harness"), §6.3, §8; plan:
// docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
// (PR-3c-4, drive-parity-deadline.test.ts).
//
// The gate the stage-deadline flag flips on. Over the PR-3c-2 parallel
// fixtures with a deadline on every stage, plus deadline-seq (a sequential
// shape with one deadline), seeded sequences interleave deadline events with
// receipts and stops. After EVERY event:
//
// - PARITY. The drive's marked stage keys and stop (kind and stop id) equal
//   the reference interpreter's (on the definition and on its decompiled
//   document). A receipt or stop event is one drive tick: the token step
//   (stepDriveMarking) and then the deadline pass (raiseDueDeadlines), as the
//   planner composes them. A deadline event is a tick at which only time
//   passed (the clock jumps past the six-hour deadline): the drive runs its
//   deadline pass, and the interpreter gets one `deadline` event per notice the
//   pass raised (rule 8: it records nothing and fires nothing). The step is
//   not run on it, keeping the one-firing-per-event alignment the other
//   parity harnesses use.
// - NON-INTERRUPTION. The drive's tokens, iterations and rework counters equal
//   those of the same run on the twin without deadlines.
// - ONE NOTICE PER KEY. Every raised key is `<cycleKey>#<stageKey>#<iteration>`
//   for a token that was on that stage, and no key is ever raised twice.
// - AT LEAST ONCE. After each event a simulated notify pass (seeded success or
//   failure) runs over the unsent notices: a failed send is retried on a later
//   event, and a sent notice is never sent again.
//
// Sequences come from the seeded mulberry32 of interpreter-parity.test.ts (no
// property-testing package; plan constraint 2). A failure prints the seed,
// fixture, step and events. The test calls the pure functions directly and
// never reads CONSTRUCT_EXECUTABLE.

import { describe, expect, it } from "vitest";

import { decompile } from "@/lib/gpp/shape-language/decompile";
import {
  markedStageKeys as interpreterMarked,
  startShapeInstance,
  stepShapeInstance,
  type GppShapeEvent,
  type GppShapeMarking,
  type InterpretableShape,
} from "@/lib/gpp/shape-language/interpreter";
import { checkSoundness } from "@/lib/gpp/shape-language/soundness";

import { DEADLINE_PARITY_FIXTURES, SIX_HOURS } from "./__fixtures__/graph-shapes/deadline";
import { REWORK_1 } from "./__fixtures__/graph-shapes/rework";
import { DAY_MS, deadlineKey, raiseDueDeadlines, unnotifiedDeadlines, withDeadlinesNotified } from "./drive-deadlines";
import { markedStageKeys, startDriveMarking, stepDriveMarking, type DriveMarking, type DriveMarkingStopped } from "./drive-marking";
import type { WorkShapeDefinition } from "./work-shapes";
import { WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND } from "./workroom-drive-receipts";

const SEQUENCES_PER_FIXTURE = 200;
/** Sequence n of fixture i uses BASE_SEED + 9_000_000 + i * 100_000 + n. */
const BASE_SEED = 0x8875c9df + 9_000_000;
const T0 = new Date("2026-03-02T00:00:00.000Z");
const CYCLE = "parity:2026-03-02";
const TICK_MS = 15 * 60_000;
const DEADLINE_MS = SIX_HOURS.afterDays * DAY_MS;

/** mulberry32, as in interpreter-parity.test.ts. */
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

type Receipt = { stageKey: string; kind: string };
type ParityEvent = { receipt: Receipt } | { stop: "failure" | "budget" } | { deadline: true };

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)] as T;
}

function withoutDeadlines(shape: WorkShapeDefinition): WorkShapeDefinition {
  return { ...shape, stages: shape.stages.map(({ deadline: _deadline, ...stage }) => stage) };
}

function completingKind(random: () => number, definition: WorkShapeDefinition, stageKey: string): string {
  const stage = definition.stages.find((entry) => entry.key === stageKey);
  return pick(random, stage && stage.evidence.length > 0 ? stage.evidence : ["decision-record"]);
}

/** Mostly receipts for marked stages, often a deadline (time passing), sometimes noise, rarely a stop. */
function nextEvent(random: () => number, definition: WorkShapeDefinition, marked: readonly string[], history: readonly Receipt[]): ParityEvent {
  const keys = definition.stages.map((stage) => stage.key);
  const roll = random();
  if (roll < 0.01) return { stop: random() < 0.5 ? "failure" : "budget" };
  if (roll < 0.3) return { deadline: true };
  if (roll < 0.7 && marked.length > 0) {
    const stageKey = pick(random, marked);
    return { receipt: { stageKey, kind: completingKind(random, definition, stageKey) } };
  }
  if (roll < 0.78 && marked.length > 0) return { receipt: { stageKey: pick(random, marked), kind: WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND } };
  if (roll < 0.9 && history.length > 0) return { receipt: { ...pick(random, history) } };
  const stageKey = pick(random, keys);
  return { receipt: random() < 0.7 ? { stageKey, kind: completingKind(random, definition, stageKey) } : { stageKey, kind: WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND } };
}

type Coverage = { marked: Set<string>; raisedStages: Set<string>; retried: number; sent: number; stops: Set<string> };

function runSequence(definition: WorkShapeDefinition, document: InterpretableShape, seed: number, coverage: Coverage): void {
  const random = mulberry32(seed);
  const twin = withoutDeadlines(definition);
  const id = `${definition.key}@${definition.version}`;
  const maxSteps = definition.stages.length * 8 + 16;
  const receipts: Receipt[] = [];
  const events: ParityEvent[] = [];
  const raisedKeys: string[] = [];
  const sendCount = new Map<string, number>();
  const failedOnce = new Set<string>();

  let now = T0;
  let drive: DriveMarking = startDriveMarking(definition, CYCLE, now);
  let twinDrive: DriveMarking = startDriveMarking(twin, CYCLE, now);
  let driveStopped: DriveMarkingStopped | null = null;
  let onDefinition: GppShapeMarking = startShapeInstance(definition);
  let onDocument: GppShapeMarking = startShapeInstance(document);
  const where = (step: number) => `seed=${seed} fixture=${id} step=${step} events=${JSON.stringify(events)}`;

  const deadlinePass = (step: number) => {
    const before = drive;
    const { marking, raised } = raiseDueDeadlines(definition, drive, now);
    for (const due of raised) {
      // One notice per key, for a token that is on that stage at that iteration.
      expect(raisedKeys, where(step)).not.toContain(due.key);
      expect(due.key, where(step)).toBe(deadlineKey(CYCLE, due.stageKey, before.iterations[due.stageKey] ?? 0));
      expect(markedStageKeys(definition, before), where(step)).toContain(due.stageKey);
      raisedKeys.push(due.key);
      coverage.raisedStages.add(due.stageKey);
    }
    drive = marking;
    return raised;
  };

  const notifyPass = (step: number) => {
    const sent: string[] = [];
    for (const notice of unnotifiedDeadlines(definition, drive)) {
      // A notice that already went out is never pending again.
      expect(sendCount.get(notice.key) ?? 0, where(step)).toBe(0);
      if (random() < 0.3) {
        failedOnce.add(notice.key);
        continue;
      }
      if (failedOnce.has(notice.key)) coverage.retried += 1;
      sendCount.set(notice.key, 1);
      sent.push(notice.key);
      coverage.sent += 1;
    }
    drive = withDeadlinesNotified(drive, sent, now);
  };

  const assertEqual = (step: number) => {
    const marked = markedStageKeys(definition, drive);
    expect(marked, where(step)).toEqual(interpreterMarked(definition, onDefinition));
    expect(marked, where(step)).toEqual(interpreterMarked(document, onDocument));
    const stopped = driveStopped ? { kind: driveStopped.kind, stopId: driveStopped.stopId } : null;
    for (const interpreted of [onDefinition, onDocument]) {
      expect(stopped, where(step)).toEqual(interpreted.stopped ? { kind: interpreted.stopped.kind, stopId: interpreted.stopped.stopId } : null);
    }
    // Non-interruption: the deadlines changed nothing but `deadlines`.
    expect({ tokens: drive.tokens, iterations: drive.iterations, reworkTaken: drive.reworkTaken }, where(step))
      .toEqual({ tokens: twinDrive.tokens, iterations: twinDrive.iterations, reworkTaken: twinDrive.reworkTaken });
    expect(Object.keys(drive.deadlines).sort(), where(step)).toEqual([...raisedKeys].sort());
    for (const key of marked) coverage.marked.add(key);
    if (driveStopped) coverage.stops.add(driveStopped.kind);
  };

  assertEqual(0);
  for (let step = 1; step <= maxSteps && driveStopped === null; step += 1) {
    const event = nextEvent(random, definition, markedStageKeys(definition, drive), receipts);
    events.push(event);
    if ("deadline" in event) {
      now = new Date(now.getTime() + DEADLINE_MS + 60_000);
      const raised = deadlinePass(step);
      const stageKeys = raised.length > 0 ? raised.map((due) => due.stageKey) : [pick(random, definition.stages.map((stage) => stage.key))];
      for (const stageKey of stageKeys) {
        const deadline: GppShapeEvent = { type: "deadline", stageKey };
        onDefinition = stepShapeInstance(definition, onDefinition, deadline);
        onDocument = stepShapeInstance(document, onDocument, deadline);
      }
    } else {
      now = new Date(now.getTime() + TICK_MS);
      if ("receipt" in event && !receipts.some((entry) => entry.stageKey === event.receipt.stageKey && entry.kind === event.receipt.kind)) {
        receipts.push(event.receipt);
      }
      const observations = { receipts, ...("stop" in event ? { stop: event.stop } : {}) };
      const tick = stepDriveMarking(definition, drive, observations, now);
      const twinTick = stepDriveMarking(twin, twinDrive, observations, now);
      drive = tick.marking;
      twinDrive = twinTick.marking;
      driveStopped = tick.stopped;
      expect(twinTick.stopped, where(step)).toEqual(tick.stopped);
      deadlinePass(step);
      const interpreted: GppShapeEvent = "stop" in event ? { type: "stop", kind: event.stop } : { type: "receipt", ...event.receipt };
      onDefinition = stepShapeInstance(definition, onDefinition, interpreted);
      onDocument = stepShapeInstance(document, onDocument, interpreted);
    }
    notifyPass(step);
    assertEqual(step);
  }
}

describe("AC-3C-DEADLINE-PARITY: deadlines never change the marking; one notice per stage pass, at least once", () => {
  it.each(DEADLINE_PARITY_FIXTURES.map((fixture) => [fixture.key, fixture] as const))("%s passes checkSoundness with zero findings", (_key, fixture) => {
    expect(checkSoundness(decompile(fixture).document)).toEqual([]);
  });

  it("every fixture declares a deadline, and the decompiled document carries it", () => {
    for (const fixture of DEADLINE_PARITY_FIXTURES) {
      const declared = fixture.stages.filter((stage) => stage.deadline).map((stage) => stage.key);
      expect(declared.length, fixture.key).toBeGreaterThan(0);
      expect(decompile(fixture).document.stages.filter((stage) => stage.deadline).map((stage) => stage.key), fixture.key).toEqual(declared);
    }
  });

  it.each(DEADLINE_PARITY_FIXTURES.map((fixture, index) => [fixture.key, fixture, index] as const))(
    "%s: marked stages and stop agree, and the deadline pass is non-interrupting and once-only, after every prefix of 200 seeded sequences",
    (_key, fixture, index) => {
      const document = decompile(fixture).document;
      const coverage: Coverage = { marked: new Set(), raisedStages: new Set(), retried: 0, sent: 0, stops: new Set() };
      for (let n = 0; n < SEQUENCES_PER_FIXTURE; n += 1) runSequence(fixture, document, BASE_SEED + index * 100_000 + n, coverage);
      expect([...coverage.marked].sort()).toEqual(fixture.stages.map((stage) => stage.key).sort());
      // Every stage that declares a deadline came due at least once, a failed send was retried, and sends happened.
      expect([...coverage.raisedStages].sort()).toEqual(fixture.stages.filter((stage) => stage.deadline).map((stage) => stage.key).sort());
      expect(coverage.retried).toBeGreaterThan(0);
      expect(coverage.sent).toBeGreaterThan(0);
      expect(coverage.stops.has("success")).toBe(true);
    },
    60_000,
  );
});

describe("deadline keys across a rework and a new cycle", () => {
  const shape: WorkShapeDefinition = { ...REWORK_1, key: "graph-fixture-rework-1-deadlines", stages: REWORK_1.stages.map((stage) => ({ ...stage, deadline: SIX_HOURS })) };
  const done = (stageKey: string, iteration?: number) => ({ stageKey, kind: "stage-evidence-recorded", ...(iteration ? { iteration } : {}) });

  it("a rework starts a new iteration with a fresh enteredAt, which owes a new notice under a new key", () => {
    let now = T0;
    let marking = startDriveMarking(shape, CYCLE, now);
    marking = stepDriveMarking(shape, marking, { receipts: [done("a")] }, (now = new Date(now.getTime() + TICK_MS))).marking;
    now = new Date(now.getTime() + DEADLINE_MS);
    marking = raiseDueDeadlines(shape, marking, now).marking;
    expect(Object.keys(marking.deadlines)).toEqual([`${CYCLE}#b#0`]);
    // b is sent back to a: iterations of a and b go to 1.
    const verdicts = { b: { verdict: "refuse" as const, mode: "enforced" as const, iteration: 0 } };
    marking = stepDriveMarking(shape, marking, { receipts: [done("a"), done("b")], verdicts }, (now = new Date(now.getTime() + TICK_MS))).marking;
    expect(marking.iterations).toEqual({ a: 1, b: 1 });
    marking = stepDriveMarking(shape, marking, { receipts: [done("a"), done("b"), done("a", 1)] }, (now = new Date(now.getTime() + TICK_MS))).marking;
    expect(raiseDueDeadlines(shape, marking, new Date(now.getTime() + DEADLINE_MS - 1)).raised).toEqual([]);
    const later = raiseDueDeadlines(shape, marking, new Date(now.getTime() + DEADLINE_MS));
    expect(later.raised.map((due) => due.key)).toEqual([`${CYCLE}#b#1`]);
    expect(Object.keys(later.marking.deadlines).sort()).toEqual([`${CYCLE}#b#0`, `${CYCLE}#b#1`]);
  });

  it("the next cycle's fresh marking can notice the same stage again", () => {
    const next = startDriveMarking(shape, "parity:2026-03-03", new Date(T0.getTime() + DAY_MS));
    const raised = raiseDueDeadlines(shape, next, new Date(T0.getTime() + DAY_MS + DEADLINE_MS)).raised;
    expect(raised.map((due) => due.key)).toEqual(["parity:2026-03-03#a#0"]);
  });
});
