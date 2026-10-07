// AC-3C-SUBSHAPE-PARITY (BI-8875C9DF, GPP Phase 3c PR-3c-5). Design:
// docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md
// §6 ("The parity harness"), §6.4, §9; plan:
// docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
// (PR-3c-5, drive-parity-sub-shape.test.ts).
//
// The gate the sub-shape flag flips on. Over sub-seq (a middle stage calls a
// two-stage child) and sub-in-branch (a sub-shape inside a parallel branch),
// 200 seeded sequences per fixture of receipts (for the stages that call no
// child), child stops (success, failure, budget, for any stage) and rare stop
// events. The interpreter gets each event as is (rule 9 for a child stop). The
// drive sees a child stop the way it does at runtime: as the child room's own
// drive snapshot (`stop` / `success`, or `stop` with a failure or budget
// disposition), read through subShapeOutcome for the child of the stage's
// current pass. A child's success earns the stage's `child-completion`
// receipt at its iteration (the runner's evidence round trip, collapsed into
// the tick: evidence timing is unit-tested where receipts are earned, plan
// risk R3). After each tick the harness applies the plan's child effects
// (subShapeEffects) the way the runner does: ensure creates the pass's child,
// complete closes it, abandon closes a child no token holds.
//
// After EVERY event: the drive's marked stages and stop equal the
// interpreter's (definition and decompiled document); a sub-shape stage whose
// child stopped without success still holds its token and its token state is
// `stopped` (the parent is held, never stopped: the stop kind is not
// propagated, founder decision 2026-10-02); every child is exactly one per
// pass; and once the drive stops, no child is left live.
//
// Seeded mulberry32 as in interpreter-parity.test.ts (plan constraint 2). A
// failure prints the seed, fixture, step and events. The test never reads
// CONSTRUCT_EXECUTABLE.

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

import { SUB_SHAPE_PARITY_FIXTURES } from "./__fixtures__/graph-shapes/sub-shape";
import { CHILD_COMPLETION_EVIDENCE_KIND } from "./drive-graph-tick";
import { iterationOf, markedStageKeys, startDriveMarking, stepDriveMarking, type DriveMarking, type DriveMarkingStopped } from "./drive-marking";
import {
  liveSubShapeChildren,
  subShapeChildKey,
  subShapeEffects,
  subShapeTokenState,
  withChildEntry,
  type SubShapeChildObservation,
} from "./drive-child-rooms";
import { buildShapeFlowGraph } from "./work-shape-flow-graph";
import type { WorkShapeDefinition } from "./work-shapes";
import { WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND } from "./workroom-drive-receipts";

const SEQUENCES_PER_FIXTURE = 200;
/** Sequence n of fixture i uses BASE_SEED + 11_000_000 + i * 100_000 + n. */
const BASE_SEED = 0x8875c9df + 11_000_000;
const T0 = new Date("2026-03-02T09:00:00.000Z");
const CYCLE = "parity:2026-03-02";
const PARENT = "WC-PARENT";

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

type Receipt = { stageKey: string; kind: string; iteration?: number };
type ChildKind = "success" | "failure" | "budget";
type ParityEvent = { receipt: Receipt } | { stop: "failure" | "budget" } | { childStop: { stageKey: string; kind: ChildKind } };

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)] as T;
}

/** The child room's own drive snapshot for each way a child stops. */
const CHILD_SNAPSHOT: Record<ChildKind, { action: string; reason: string }> = {
  success: { action: "stop", reason: "success" },
  failure: { action: "stop", reason: "refused_to_stop" },
  budget: { action: "stop", reason: "conformance_stop" },
};

function nextEvent(random: () => number, definition: WorkShapeDefinition, marked: readonly string[], history: readonly Receipt[]): ParityEvent {
  const plain = definition.stages.filter((stage) => !stage.subShape).map((stage) => stage.key);
  const subShapes = definition.stages.filter((stage) => stage.subShape).map((stage) => stage.key);
  const markedPlain = marked.filter((key) => plain.includes(key));
  const markedSub = marked.filter((key) => subShapes.includes(key));
  const roll = random();
  if (roll < 0.01) return { stop: random() < 0.5 ? "failure" : "budget" };
  if (roll < 0.35 && markedSub.length > 0) {
    const kind: ChildKind = random() < 0.55 ? "success" : random() < 0.5 ? "failure" : "budget";
    return { childStop: { stageKey: pick(random, markedSub), kind } };
  }
  if (roll < 0.42) return { childStop: { stageKey: pick(random, subShapes), kind: random() < 0.6 ? "success" : "failure" } };
  if (roll < 0.75 && markedPlain.length > 0) return { receipt: { stageKey: pick(random, markedPlain), kind: "assurance-run" } };
  if (roll < 0.82 && markedPlain.length > 0) return { receipt: { stageKey: pick(random, markedPlain), kind: WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND } };
  if (roll < 0.9 && history.length > 0) return { receipt: { ...pick(random, history) } };
  return { receipt: { stageKey: pick(random, plain), kind: random() < 0.7 ? "assurance-run" : WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND } };
}

function interpreterEvent(event: ParityEvent): GppShapeEvent {
  if ("stop" in event) return { type: "stop", kind: event.stop };
  if ("childStop" in event) return { type: "child-stop", ...event.childStop };
  return { type: "receipt", stageKey: event.receipt.stageKey, kind: event.receipt.kind };
}

type Coverage = { marked: Set<string>; childOutcomes: Set<string>; joins: number; stops: Set<string>; held: number; abandoned: number };

function runSequence(definition: WorkShapeDefinition, document: InterpretableShape, seed: number, coverage: Coverage): void {
  const random = mulberry32(seed);
  const id = `${definition.key}@${definition.version}`;
  const maxSteps = definition.stages.length * 8 + 16;
  const receipts: Receipt[] = [];
  const events: ParityEvent[] = [];
  const observations: Record<string, SubShapeChildObservation> = {};
  const childrenCreated = new Map<string, number>();
  const heldBy = new Map<string, ChildKind>();

  let now = T0;
  let drive: DriveMarking = startDriveMarking(definition, CYCLE, now);
  let driveStopped: DriveMarkingStopped | null = null;
  let onDefinition: GppShapeMarking = startShapeInstance(definition);
  let onDocument: GppShapeMarking = startShapeInstance(document);
  const where = (step: number) => `seed=${seed} fixture=${id} step=${step} events=${JSON.stringify(events)}`;

  /** The runner's child effects, applied as if every one committed. */
  const applyEffects = () => {
    const effects = subShapeEffects(definition, drive, PARENT, observations, "left");
    if (driveStopped) effects.ensure = [];
    for (const ensure of effects.ensure) {
      childrenCreated.set(ensure.key, (childrenCreated.get(ensure.key) ?? 0) + 1);
      const capsuleId = `WC-CHILD-${ensure.key}`;
      observations[capsuleId] = { capsuleId, status: "working", action: "dispatch_agent", reason: "agent_stage" };
      drive = withChildEntry(drive, ensure.key, { capsuleId, ref: ensure.ref });
    }
    for (const done of effects.complete) {
      observations[done.childCapsuleId] = { ...observations[done.childCapsuleId]!, status: "complete" };
      drive = withChildEntry(drive, done.key, { capsuleId: done.childCapsuleId, ref: done.ref, state: "completed" });
    }
    for (const gone of effects.abandon) {
      observations[gone.childCapsuleId] = { ...observations[gone.childCapsuleId]!, status: "abandoned" };
      drive = withChildEntry(drive, gone.key, { capsuleId: gone.childCapsuleId, ref: gone.ref, state: "abandoned" });
      coverage.abandoned += 1;
    }
  };

  const assertEqual = (step: number) => {
    const marked = markedStageKeys(definition, drive);
    expect(marked, where(step)).toEqual(interpreterMarked(definition, onDefinition));
    expect(marked, where(step)).toEqual(interpreterMarked(document, onDocument));
    const stopped = driveStopped ? { kind: driveStopped.kind, stopId: driveStopped.stopId } : null;
    for (const interpreted of [onDefinition, onDocument]) {
      expect(stopped, where(step)).toEqual(interpreted.stopped ? { kind: interpreted.stopped.kind, stopId: interpreted.stopped.stopId } : null);
    }
    // A child that stopped without success holds its parent stage: the token stays and is `stopped`, never propagated.
    for (const [stageKey, kind] of heldBy) {
      if (!marked.includes(stageKey)) continue;
      expect(subShapeTokenState(definition, drive, stageKey, observations)?.kind, where(step)).toBe("stopped");
      coverage.held += 1;
      void kind;
    }
    // Exactly one child per pass.
    for (const [key, count] of childrenCreated) expect(count, `${where(step)} key=${key}`).toBe(1);
    if (driveStopped) expect(liveSubShapeChildren(drive), where(step)).toEqual([]);
    for (const key of marked) coverage.marked.add(key);
    if (driveStopped) coverage.stops.add(driveStopped.kind);
  };

  applyEffects();
  assertEqual(0);
  for (let step = 1; step <= maxSteps && driveStopped === null; step += 1) {
    const event = nextEvent(random, definition, markedStageKeys(definition, drive), receipts);
    events.push(event);
    now = new Date(now.getTime() + 15 * 60_000);
    if ("receipt" in event && !receipts.some((entry) => entry.stageKey === event.receipt.stageKey && entry.kind === event.receipt.kind)) {
      receipts.push(event.receipt);
    }
    // A child stop that records nothing (a failure or budget stop, or one for a stage with no live child) is a tick at
    // which only the child's state changed: rule 9 fires nothing on it, so the drive's step is not run on it either,
    // keeping the one-firing-per-event alignment of the other parity harnesses (drive-parity-deadline.test.ts).
    let recorded = !("childStop" in event);
    if ("childStop" in event) {
      const { stageKey, kind } = event.childStop;
      const entry = markedStageKeys(definition, drive).includes(stageKey)
        ? drive.children[subShapeChildKey(drive.cycleKey, stageKey, iterationOf(drive, stageKey))]
        : undefined;
      // The child the drive reads is its current pass's; a stage with no token has no child to stop.
      if (entry && !entry.state) {
        observations[entry.capsuleId] = { ...observations[entry.capsuleId]!, ...CHILD_SNAPSHOT[kind] };
        coverage.childOutcomes.add(kind);
        if (kind === "success") heldBy.delete(stageKey);
        else heldBy.set(stageKey, kind);
        recorded = kind === "success";
      }
    }
    // A child's success earns its stage's completing receipt at the stage's iteration.
    for (const stageKey of markedStageKeys(definition, drive)) {
      if (subShapeTokenState(definition, drive, stageKey, observations)?.kind !== "completing") continue;
      const iteration = iterationOf(drive, stageKey);
      if (!receipts.some((entry) => entry.stageKey === stageKey && entry.kind === CHILD_COMPLETION_EVIDENCE_KIND && (entry.iteration ?? 0) === iteration)) {
        receipts.push({ stageKey, kind: CHILD_COMPLETION_EVIDENCE_KIND, ...(iteration ? { iteration } : {}) });
      }
    }
    if (recorded) {
      const tick = stepDriveMarking(definition, drive, { receipts, ...("stop" in event ? { stop: event.stop } : {}) }, now);
      const before = markedStageKeys(definition, drive);
      drive = tick.marking;
      driveStopped = tick.stopped;
      for (const stageKey of before) if (!markedStageKeys(definition, drive).includes(stageKey)) heldBy.delete(stageKey);
    }
    applyEffects();
    onDefinition = stepShapeInstance(definition, onDefinition, interpreterEvent(event));
    onDocument = stepShapeInstance(document, onDocument, interpreterEvent(event));
    assertEqual(step);
  }
  const graph = buildShapeFlowGraph(definition);
  if ([...graph.nodes.values()].some((node) => node.kind === "parallel-join") && coverage.marked.has("d")) coverage.joins += 1;
}

describe("AC-3C-SUBSHAPE-PARITY: a child's stop moves the parent exactly as the interpreter's rule 9 says", () => {
  it.each(SUB_SHAPE_PARITY_FIXTURES.map((fixture) => [fixture.key, fixture] as const))("%s passes checkSoundness with zero findings, and its document carries the sub-shape", (_key, fixture) => {
    const { document } = decompile(fixture);
    expect(checkSoundness(document)).toEqual([]);
    expect(document.stages.filter((stage) => stage.subShape).map((stage) => stage.key)).toEqual(fixture.stages.filter((stage) => stage.subShape).map((stage) => stage.key));
  });

  it.each(SUB_SHAPE_PARITY_FIXTURES.map((fixture, index) => [fixture.key, fixture, index] as const))(
    "%s: marked stages and stop agree after every prefix of 200 seeded sequences; a stopped child holds its parent; one child per pass",
    (_key, fixture, index) => {
      const document = decompile(fixture).document;
      const coverage: Coverage = { marked: new Set(), childOutcomes: new Set(), joins: 0, stops: new Set(), held: 0, abandoned: 0 };
      for (let n = 0; n < SEQUENCES_PER_FIXTURE; n += 1) runSequence(fixture, document, BASE_SEED + index * 100_000 + n, coverage);
      expect([...coverage.marked].sort()).toEqual(fixture.stages.map((stage) => stage.key).sort());
      expect([...coverage.childOutcomes].sort()).toEqual(["budget", "failure", "success"]);
      expect(coverage.held).toBeGreaterThan(0);
      expect(coverage.stops.has("success")).toBe(true);
      expect(coverage.stops.has("failure") || coverage.stops.has("budget")).toBe(true);
      // A stop event while a child was live abandoned it.
      expect(coverage.abandoned).toBeGreaterThan(0);
    },
    60_000,
  );
});
