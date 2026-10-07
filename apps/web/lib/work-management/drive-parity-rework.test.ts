// AC-3C-REWORK-PARITY (BI-8875C9DF, GPP Phase 3c PR-3c-3). Design:
// docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md
// §6 ("The parity harness"), §6.2; plan:
// docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
// (PR-3c-3, drive-parity-rework.test.ts). Decision: DI-0D9DFB0FC0EF (defer
// holds on a stage that declares a refuse route).
//
// The drive's token step (stepDriveMarking, drive-marking.ts), fed the verdicts
// the drive derives from recorded decisions (gateVerdictsFor,
// drive-resolution-graph.ts), and the reference interpreter
// (stepShapeInstance, interpreter.ts) are two independent statements of the
// refuse-route and rework rules over one flow graph. This is the gate the
// rework-edge flag flips on: over seeded event sequences on seven fixtures,
// after EVERY prefix the drive's marked stage keys, its stop (kind and stop
// id) and its rework counters equal the interpreter's.
//
// - Events: completing and blocked receipts for marked stages, duplicates of
//   earlier receipts for marked stages, stage decisions (gate verdicts) on
//   marked stages whose gate declares a refuse route, and (rarely) a failure
//   or budget stop event.
// - For the drive, a receipt carries the stage's current iteration (as the
//   drive earns it, earnGraphReceipts), and a decision is a completed
//   `decision-record` evidence row with its `choice`, recorded at the tick's
//   time; the verdict is derived from those rows exactly as the planner does.
//   The choices offered are the stage's real choices (governedDecisionStage),
//   so "Send back" appears only where the gate declares a refuse route.
// - For the interpreter, a decision on a refuse-route stage is a gate verdict:
//   accept and patch admit, refuse refuses, defer HOLDS (DI-0D9DFB0FC0EF; this
//   harness states the mapping itself, independently of the drive's table).
//   On an enforced, blocking gate WITHOUT a refuse route the drive derives no
//   verdict and advances on the receipt, as today; the interpreter would hold
//   such a token (interpreter.ts fireOne), so the harness feeds it an `admit`
//   verdict alongside every completing receipt on that stage. That divergence
//   is recorded in spec §14 Q1, not hidden.
// - Receipts and decisions target marked stages only. The drive earns a
//   receipt only for a marked stage, and a person decides only a pending
//   stage, so this is the production shape of the input; it also keeps the
//   admit feeding above a single firing (at the start of every step no stage
//   is enabled and unfired).
// - One drive tick per event, stepped one event at a time from
//   startShapeInstance on the definition and on its decompiled document.
// - Coverage per fixture: the outcomes the fixture exists for (a rework taken,
//   the budget stop, a refuse to a stop, a refuse with no route keeping its
//   token, a shadow refuse moving on, a defer holding its token) each happened.
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
  type GppGateVerdict,
  type GppShapeEvent,
  type GppShapeMarking,
  type InterpretableShape,
} from "@/lib/gpp/shape-language/interpreter";
import { checkSoundness } from "@/lib/gpp/shape-language/soundness";

import {
  DEFER_ON_REFUSE_ROUTE,
  REFUSE_BOUND_NO_BUDGET_STOP,
  REFUSE_TO_STOP,
  REWORK_1,
  REWORK_2_BOUND,
  REWORK_INSIDE_BRANCH,
  REWORK_PARITY_FIXTURES,
  SHADOW_GATE,
} from "./__fixtures__/graph-shapes/rework";
import {
  gateHolds,
  iterationOf,
  markedStageKeys,
  startDriveMarking,
  stepDriveMarking,
  type DriveMarking,
  type DriveMarkingStopped,
} from "./drive-marking";
import { gateVerdictsFor } from "./drive-resolution-graph";
import type { RecordedEvidence } from "./stage-evidence-receipts";
import { declaresRefuseRoute } from "./work-shape-flow-graph";
import { readWorkShapeDefinitionContract, type WorkShapeDefinition } from "./work-shapes";
import { WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND } from "./workroom-drive-receipts";
import { governedDecisionStage, type StageDecisionChoice } from "./workroom-stage-decision";

const SEQUENCES_PER_FIXTURE = 200;
/** Sequence n of fixture i uses BASE_SEED + 7_000_000 + i * 100_000 + n (distinct from the parallel harness's seeds). */
const BASE_SEED = 0x8875c9df + 7_000_000;
const NOW = new Date("2026-03-02T09:00:00.000Z");
const CYCLE = "parity:2026-03-02";
const tickAt = (step: number) => new Date(NOW.getTime() + step * 900_000);

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

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)] as T;
}

type Receipt = { stageKey: string; kind: string };
type ParityEvent =
  | { receipt: Receipt }
  | { decision: { stageKey: string; choice: StageDecisionChoice } }
  | { stop: "failure" | "budget" };

type Stage = WorkShapeDefinition["stages"][number];
const gateOf = (stage: Stage | undefined) => (stage?.advance.kind === "governed-decision" ? stage.advance.gate : undefined);

/** The harness's own statement of the decision → verdict mapping on a refuse-route stage (DI-0D9DFB0FC0EF). */
const INTERPRETER_VERDICT: Record<StageDecisionChoice, GppGateVerdict> = { accept: "admit", patch: "admit", defer: "hold", refuse: "refuse" };

function completingKind(random: () => number, stage: Stage): string {
  return pick(random, stage.evidence.length > 0 ? stage.evidence : ["decision-record"]);
}

/** Weighted toward sending back, so loops, bounds and stops are reached. */
function pickChoice(random: () => number, offered: readonly StageDecisionChoice[]): StageDecisionChoice {
  const roll = random();
  if (offered.includes("refuse") && roll < 0.45) return "refuse";
  if (offered.includes("defer") && roll < 0.65) return "defer";
  if (offered.includes("patch") && roll < 0.72) return "patch";
  return "accept";
}

function nextEvent(random: () => number, definition: WorkShapeDefinition, marked: readonly string[], history: readonly Receipt[]): ParityEvent | null {
  if (marked.length === 0) return null;
  const stages = definition.stages.filter((stage) => marked.includes(stage.key));
  const deciding = stages.filter((stage) => declaresRefuseRoute(definition, stage.key));
  const roll = random();
  if (roll < 0.01) return { stop: random() < 0.5 ? "failure" : "budget" };
  if (roll < 0.45) {
    const stage = pick(random, stages);
    return { receipt: { stageKey: stage.key, kind: completingKind(random, stage) } };
  }
  if (roll < 0.53) return { receipt: { stageKey: pick(random, stages).key, kind: WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND } };
  if (roll < 0.85 && deciding.length > 0) {
    const stage = pick(random, deciding);
    const offered = governedDecisionStage(readWorkShapeDefinitionContract(definition), stage.key)?.choices ?? [];
    return { decision: { stageKey: stage.key, choice: pickChoice(random, offered) } };
  }
  const repeatable = history.filter((receipt) => marked.includes(receipt.stageKey));
  if (repeatable.length > 0) return { receipt: { ...pick(random, repeatable) } };
  const stage = pick(random, stages);
  return { receipt: { stageKey: stage.key, kind: completingKind(random, stage) } };
}

/** The interpreter events for one harness event (see the header for the admit feeding). */
function interpreterEvents(definition: WorkShapeDefinition, event: ParityEvent): GppShapeEvent[] {
  if ("stop" in event) return [{ type: "stop", kind: event.stop }];
  const stage = definition.stages.find((entry) => entry.key === ("receipt" in event ? event.receipt.stageKey : event.decision.stageKey));
  const gate = gateOf(stage);
  if ("decision" in event) {
    return gate ? [{ type: "gate-verdict", stageKey: event.decision.stageKey, verdict: INTERPRETER_VERDICT[event.decision.choice], mode: gate.mode }] : [];
  }
  const enforcedWithoutRoute = gate !== undefined && gate.mode === "enforced" && gate.blocking
    && !declaresRefuseRoute(definition, event.receipt.stageKey);
  const completing = event.receipt.kind !== WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND;
  return [
    ...(enforcedWithoutRoute && completing && gate ? [{ type: "gate-verdict" as const, stageKey: event.receipt.stageKey, verdict: "admit" as const, mode: gate.mode }] : []),
    { type: "receipt", ...event.receipt },
  ];
}

type Coverage = {
  reworks: number;
  stops: Set<string>;
  refusedWithoutRoute: number;
  heldByDefer: number;
  movedPastShadowRefuse: number;
  advancedOnEnforcedWithoutRoute: number;
  staleReceiptsIgnored: number;
};

function runSequence(definition: WorkShapeDefinition, document: InterpretableShape, seed: number, coverage: Coverage): void {
  const random = mulberry32(seed);
  const contract = readWorkShapeDefinitionContract(definition);
  const id = `${definition.key}@${definition.version}`;
  const maxSteps = definition.stages.length * 10 + 20;
  const receipts: Array<Receipt & { iteration: number }> = [];
  const history: Receipt[] = [];
  const evidence: RecordedEvidence[] = [];
  const events: ParityEvent[] = [];
  const latestChoice = new Map<string, StageDecisionChoice>();

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
      // A stopped interpreter keeps its last counters; the drive's stopped marking keeps them too.
      expect(drive.reworkTaken, where(step)).toEqual(interpreted.reworkTaken);
    }
  };

  assertEqual(0);
  for (let step = 1; step <= maxSteps && driveStopped === null; step += 1) {
    const event = nextEvent(random, definition, markedStageKeys(definition, drive), history);
    if (!event) break;
    events.push(event);
    if ("receipt" in event) {
      const iteration = iterationOf(drive, event.receipt.stageKey);
      if (!receipts.some((entry) => entry.stageKey === event.receipt.stageKey && entry.kind === event.receipt.kind && entry.iteration === iteration)) {
        receipts.push({ ...event.receipt, iteration });
      }
      if (!history.some((entry) => entry.stageKey === event.receipt.stageKey && entry.kind === event.receipt.kind)) history.push(event.receipt);
    }
    if ("decision" in event) {
      evidence.push({ stageKey: event.decision.stageKey, kind: "decision-record", outcome: "completed", choice: event.decision.choice, recordedAt: tickAt(step) });
      latestChoice.set(event.decision.stageKey, event.decision.choice);
    }

    const before = drive;
    const verdicts = gateVerdictsFor(contract, drive, evidence);
    const tick = stepDriveMarking(definition, drive, { receipts, verdicts, ...("stop" in event ? { stop: event.stop } : {}) }, tickAt(step));
    drive = tick.marking;
    driveStopped = tick.stopped;
    for (const interpreterEvent of interpreterEvents(definition, event)) {
      onDefinition = stepShapeInstance(definition, onDefinition, interpreterEvent);
      onDocument = stepShapeInstance(document, onDocument, interpreterEvent);
    }
    assertEqual(step);

    // Coverage.
    if (tick.reworked) coverage.reworks += 1;
    if (driveStopped) coverage.stops.add(driveStopped.kind);
    const holds = gateHolds(definition, drive, { receipts, verdicts: gateVerdictsFor(contract, drive, evidence) });
    for (const [stageKey, hold] of holds) {
      if (hold === "refused_without_route") coverage.refusedWithoutRoute += 1;
      if (hold === "awaiting_verdict" && latestChoice.get(stageKey) === "defer" && verdicts[stageKey]?.verdict === "hold") coverage.heldByDefer += 1;
    }
    const firedStage = definition.stages.find((stage) => stage.key === tick.fired);
    const firedGate = gateOf(firedStage);
    if (firedGate?.mode === "shadow" && latestChoice.get(firedStage!.key) === "refuse" && !tick.reworked) coverage.movedPastShadowRefuse += 1;
    if (firedGate?.mode === "enforced" && firedStage && !declaresRefuseRoute(definition, firedStage.key)) coverage.advancedOnEnforcedWithoutRoute += 1;
    // A receipt from an earlier iteration of a marked stage that did not complete it.
    for (const key of markedStageKeys(definition, before)) {
      const now = iterationOf(before, key);
      if (now > 0 && receipts.some((receipt) => receipt.stageKey === key && receipt.iteration < now && receipt.kind !== WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND)
        && tick.fired !== key) coverage.staleReceiptsIgnored += 1;
    }
  }
}

/** What each fixture must reach across its 200 sequences. */
const MUST_REACH: Record<string, (coverage: Coverage) => void> = {
  [REWORK_1.key]: (c) => {
    expect(c.reworks).toBeGreaterThan(0);
    expect(c.stops.has("success")).toBe(true);
    expect(c.stops.has("budget")).toBe(true);
    expect(c.staleReceiptsIgnored).toBeGreaterThan(0);
  },
  [REWORK_2_BOUND.key]: (c) => {
    expect(c.reworks).toBeGreaterThan(1);
    // Driven past the bound: the third refusal goes to the budget stop.
    expect(c.stops.has("budget")).toBe(true);
    expect(c.stops.has("success")).toBe(true);
  },
  [REFUSE_TO_STOP.key]: (c) => {
    expect(c.reworks).toBe(0);
    expect(c.stops.has("failure")).toBe(true);
    expect(c.stops.has("success")).toBe(true);
  },
  [REFUSE_BOUND_NO_BUDGET_STOP.key]: (c) => {
    expect(c.reworks).toBeGreaterThan(0);
    expect(c.refusedWithoutRoute).toBeGreaterThan(0);
    expect(c.stops.has("success")).toBe(true);
  },
  [SHADOW_GATE.key]: (c) => {
    expect(c.reworks).toBe(0);
    expect(c.movedPastShadowRefuse).toBeGreaterThan(0);
  },
  [DEFER_ON_REFUSE_ROUTE.key]: (c) => {
    expect(c.heldByDefer).toBeGreaterThan(0);
    expect(c.reworks).toBeGreaterThan(0);
    // approve's enforced gate declares no refuse route: it advances on its receipt alone (a recorded deferral is
    // such a receipt; drive-resolution.test.ts proves a defer advances it through the planner).
    expect(c.advancedOnEnforcedWithoutRoute).toBeGreaterThan(0);
    expect(c.stops.has("success")).toBe(true);
  },
  [REWORK_INSIDE_BRANCH.key]: (c) => {
    expect(c.reworks).toBeGreaterThan(0);
    expect(c.stops.has("success")).toBe(true);
    expect(c.staleReceiptsIgnored).toBeGreaterThan(0);
  },
};

describe("AC-3C-REWORK-PARITY: the drive's refuse routes and rework edges equal the reference interpreter", () => {
  it("covers the seven fixtures of the plan, each with its own coverage expectation", () => {
    expect(REWORK_PARITY_FIXTURES.map((fixture) => fixture.key).sort()).toEqual(Object.keys(MUST_REACH).sort());
  });

  it.each(REWORK_PARITY_FIXTURES.filter((fixture) => fixture !== REFUSE_BOUND_NO_BUDGET_STOP).map((fixture) => [fixture.key, fixture] as const))(
    "%s passes checkSoundness with zero findings",
    (_key, fixture) => {
      expect(checkSoundness(decompile(fixture).document)).toEqual([]);
    },
  );

  it("refuse-bound-no-budget-stop is deliberately not S-6-sound (it declares no budget stop), and nothing else", () => {
    expect(checkSoundness(decompile(REFUSE_BOUND_NO_BUDGET_STOP).document).map((finding) => finding.rule)).toEqual(["S-6"]);
  });

  it.each(REWORK_PARITY_FIXTURES.map((fixture, index) => [fixture.key, fixture, index] as const))(
    "%s: marked stages, stop and rework counters agree after every prefix of 200 seeded sequences",
    (_key, fixture, index) => {
      const document = decompile(fixture).document;
      const coverage: Coverage = { reworks: 0, stops: new Set(), refusedWithoutRoute: 0, heldByDefer: 0, movedPastShadowRefuse: 0, advancedOnEnforcedWithoutRoute: 0, staleReceiptsIgnored: 0 };
      for (let n = 0; n < SEQUENCES_PER_FIXTURE; n += 1) runSequence(fixture, document, BASE_SEED + index * 100_000 + n, coverage);
      MUST_REACH[fixture.key]!(coverage);
    },
    60_000,
  );
});
