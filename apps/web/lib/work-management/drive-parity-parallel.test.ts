// AC-3C-PARALLEL-PARITY (BI-8875C9DF, GPP Phase 3c PR-3c-2). Design:
// docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md
// §6 ("The parity harness"), §6.1; plan:
// docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
// (PR-3c-2, drive-parity-parallel.test.ts).
//
// The drive's token step (stepDriveMarking, drive-marking.ts) and the
// reference interpreter (stepShapeInstance, interpreter.ts) are two
// independent statements of the parallel split/join rules over one flow
// graph. This is the gate the parallel-split-join flag flips on: over seeded
// event sequences on four fixtures, including the R2D four-branch deploy fork,
// after EVERY prefix the drive's marked stage keys and its stop (kind and stop
// id) equal the interpreter's.
//
// - Events: completing and blocked receipts for marked and unmarked stages,
//   duplicates, and (rarely) a failure or budget stop event.
// - One drive tick per event: stepDriveMarking with every receipt recorded so
//   far, as interpreter-parity.test.ts feeds nextStageKey (the earned set;
//   evidence timing is unit-tested where receipts are earned, plan risk R3),
//   and the event's stop, if any. The interpreter is stepped one event at a
//   time from startShapeInstance, on the definition and on its decompiled
//   document.
// - Coverage: across the sequences every stage was marked, every join
//   completed (its successor was marked), and both the success stop and a
//   stop event were reached, at least once per fixture.
//
// Sequences come from the seeded mulberry32 of interpreter-parity.test.ts (no
// property-testing package; plan constraint 2). A failure prints the seed,
// fixture, step and events. The test calls the pure step directly and never
// reads CONSTRUCT_EXECUTABLE, so the flag can be rolled back independently.

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

import { PARALLEL_PARITY_FIXTURES, R2D_DEPLOY_FORK, R2D_TARGETS } from "./__fixtures__/graph-shapes/parallel";
import { markedStageKeys, startDriveMarking, stepDriveMarking, type DriveMarking, type DriveMarkingStopped } from "./drive-marking";
import { buildShapeFlowGraph } from "./work-shape-flow-graph";
import type { WorkShapeDefinition } from "./work-shapes";
import { WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND } from "./workroom-drive-receipts";

const SEQUENCES_PER_FIXTURE = 200;
/** Sequence n of fixture i uses BASE_SEED + i * 100_000 + n. */
const BASE_SEED = 0x8875c9df;
const NOW = new Date("2026-03-02T09:00:00.000Z");
const CYCLE = "parity:2026-03-02";

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
type ParityEvent = { receipt: Receipt } | { stop: "failure" | "budget" };

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)] as T;
}

function completingKind(random: () => number, definition: WorkShapeDefinition, stageKey: string): string {
  const stage = definition.stages.find((entry) => entry.key === stageKey);
  return pick(random, stage && stage.evidence.length > 0 ? stage.evidence : ["decision-record"]);
}

/** The next event: mostly a completing receipt for a marked stage, sometimes noise, rarely a stop. */
function nextEvent(random: () => number, definition: WorkShapeDefinition, marked: readonly string[], history: readonly Receipt[]): ParityEvent {
  const keys = definition.stages.map((stage) => stage.key);
  const roll = random();
  if (roll < 0.012) return { stop: random() < 0.5 ? "failure" : "budget" };
  if (roll < 0.55 && marked.length > 0) {
    const stageKey = pick(random, marked);
    return { receipt: { stageKey, kind: completingKind(random, definition, stageKey) } };
  }
  if (roll < 0.65 && marked.length > 0) return { receipt: { stageKey: pick(random, marked), kind: WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND } };
  if (roll < 0.8) {
    const unmarked = keys.filter((key) => !marked.includes(key));
    const stageKey = unmarked.length > 0 ? pick(random, unmarked) : pick(random, keys);
    return { receipt: random() < 0.6 ? { stageKey, kind: completingKind(random, definition, stageKey) } : { stageKey, kind: WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND } };
  }
  if (roll < 0.92 && history.length > 0) return { receipt: { ...pick(random, history) } };
  const stageKey = pick(random, keys);
  return { receipt: random() < 0.7 ? { stageKey, kind: completingKind(random, definition, stageKey) } : { stageKey, kind: WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND } };
}

function interpreterEvent(event: ParityEvent): GppShapeEvent {
  return "stop" in event ? { type: "stop", kind: event.stop } : { type: "receipt", ...event.receipt };
}

/** Join node id → the stage key its token moves on to. */
function joinSuccessors(definition: WorkShapeDefinition): Map<string, string> {
  const graph = buildShapeFlowGraph(definition);
  const out = new Map<string, string>();
  for (const node of graph.nodes.values()) {
    if (node.kind !== "parallel-join") continue;
    const next = graph.nodes.get((graph.successors.get(node.id) ?? [])[0] ?? "");
    if (next?.stageKey !== undefined) out.set(node.id, next.stageKey);
  }
  return out;
}

type Coverage = { marked: Set<string>; joins: Set<string>; stops: Set<string> };

function runSequence(definition: WorkShapeDefinition, document: InterpretableShape, seed: number, coverage: Coverage): void {
  const random = mulberry32(seed);
  const id = `${definition.key}@${definition.version}`;
  const joins = joinSuccessors(definition);
  const maxSteps = definition.stages.length * 6 + 12;
  const receipts: Receipt[] = [];
  const events: ParityEvent[] = [];

  let drive: DriveMarking = startDriveMarking(definition, CYCLE, NOW);
  let driveStopped: DriveMarkingStopped | null = null;
  let onDefinition: GppShapeMarking = startShapeInstance(definition);
  let onDocument: GppShapeMarking = startShapeInstance(document);
  const where = (step: number) => `seed=${seed} fixture=${id} step=${step} events=${JSON.stringify(events)}`;
  const assertEqual = (step: number) => {
    const marked = markedStageKeys(definition, drive);
    expect(marked, where(step)).toEqual(interpreterMarked(definition, onDefinition));
    expect(marked, where(step)).toEqual(interpreterMarked(document, onDocument));
    const stopped = driveStopped ? { kind: driveStopped.kind, stopId: driveStopped.stopId } : null;
    for (const interpreted of [onDefinition, onDocument]) {
      expect(stopped, where(step)).toEqual(interpreted.stopped ? { kind: interpreted.stopped.kind, stopId: interpreted.stopped.stopId } : null);
    }
    for (const key of marked) coverage.marked.add(key);
    for (const [join, successor] of joins) if (marked.includes(successor)) coverage.joins.add(join);
    if (driveStopped) coverage.stops.add(driveStopped.kind);
  };

  assertEqual(0);
  for (let step = 1; step <= maxSteps && driveStopped === null; step += 1) {
    const event = nextEvent(random, definition, markedStageKeys(definition, drive), receipts);
    events.push(event);
    if ("receipt" in event && !receipts.some((entry) => entry.stageKey === event.receipt.stageKey && entry.kind === event.receipt.kind)) {
      receipts.push(event.receipt);
    }
    const tick = stepDriveMarking(definition, drive, { receipts, ...("stop" in event ? { stop: event.stop } : {}) }, new Date(NOW.getTime() + step * 900_000));
    drive = tick.marking;
    driveStopped = tick.stopped;
    onDefinition = stepShapeInstance(definition, onDefinition, interpreterEvent(event));
    onDocument = stepShapeInstance(document, onDocument, interpreterEvent(event));
    assertEqual(step);
  }
}

describe("AC-3C-PARALLEL-PARITY: the drive's parallel step equals the reference interpreter", () => {
  it("the R2D fixture forks into four branches, each plan → fulfill → validate → observe", () => {
    const graph = buildShapeFlowGraph(R2D_DEPLOY_FORK);
    expect(graph.successors.get("node:fork")).toEqual(R2D_TARGETS.map((target) => `stage:${target}-plan`));
    expect(graph.predecessors.get("node:targets-done")).toEqual(R2D_TARGETS.map((target) => `stage:${target}-observe`));
    expect(R2D_DEPLOY_FORK.stages.map((stage) => stage.key)).toEqual([
      "deploy",
      ...R2D_TARGETS.flatMap((target) => ["plan", "fulfill", "validate", "observe"].map((step) => `${target}-${step}`)),
      "release",
    ]);
  });

  it.each(PARALLEL_PARITY_FIXTURES.map((fixture) => [fixture.key, fixture] as const))("%s passes checkSoundness with zero findings", (_key, fixture) => {
    expect(checkSoundness(decompile(fixture).document)).toEqual([]);
  });

  it.each(PARALLEL_PARITY_FIXTURES.map((fixture, index) => [fixture.key, fixture, index] as const))(
    "%s: marked stages and stop agree after every prefix of 200 seeded sequences, covering every stage and join",
    (_key, fixture, index) => {
      const document = decompile(fixture).document;
      const coverage: Coverage = { marked: new Set(), joins: new Set(), stops: new Set() };
      for (let n = 0; n < SEQUENCES_PER_FIXTURE; n += 1) runSequence(fixture, document, BASE_SEED + index * 100_000 + n, coverage);
      expect([...coverage.marked].sort()).toEqual(fixture.stages.map((stage) => stage.key).sort());
      expect([...coverage.joins].sort()).toEqual([...joinSuccessors(fixture).keys()].sort());
      // Both kinds of ending were compared: the success stop through the join, and a stop event from a parallel marking.
      expect(coverage.stops.has("success")).toBe(true);
      expect(coverage.stops.has("failure") || coverage.stops.has("budget")).toBe(true);
    },
    60_000,
  );
});
