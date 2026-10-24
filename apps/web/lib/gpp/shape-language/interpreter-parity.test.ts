// AC-INTERPRETER: the reference interpreter and the real work-shape drive
// agree on the next stage for every sequential receipt sequence (PR-3b-2,
// BI-6DA17863). Design: docs/superpowers/specs/
// 2026-10-02-gpp-shape-notation-and-compiler-design.md §6.1, §6.5, §12
// (AC-INTERPRETER); plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3b-2).
//
// `nextStageKey` (lib/work-management/drive-resolution.ts) is exported in this
// PR for this test, with no other change to the drive (plan risk R7: this test
// is its only intended external consumer).
//
// The drive is modelled the way the room runs it: the stage it proposed on the
// last tick is the room's `currentStageKey` on the next one
// (workroom-drive-state.ts), and it reads every receipt recorded so far. One
// tick per event. The interpreter is stepped one event at a time from
// `startShapeInstance`. After every prefix, the interpreter's marked stage must
// equal the drive's proposed stage; when the drive proposes none (cycle
// complete), the interpreter must have stopped on success. The interpreter is
// run on both the registry definition and its decompiled shape document, so the
// document notation and the runtime agree too.
//
// Typed gates (§6.2). Today's drive has one verdict channel: the stage decision
// a person records (`decision-record`, workroom-stage-decision.ts) is the
// completing receipt, and the drive does not route on its choice. So, for a
// stage whose advance carries an enforced, blocking gate (a ratified scope,
// first `outbound-customer-communication`, PR-3b-R), each completing receipt the
// drive sees is also fed to the interpreter as the `admit` verdict it stands
// for. A stage with no typed gate gets the receipt alone, exactly as before.
//
// Sequences come from a seeded PRNG written here (no property-testing package
// is a dependency; plan "Constraints" 2). Each failure message prints the
// sequence seed, the shape and the step.

import { describe, expect, it } from "vitest";

import { nextStageKey } from "@/lib/work-management/drive-resolution";
import { WORK_SHAPE_PRIOR_VERSIONS } from "@/lib/work-management/work-shape-prior-versions";
import { listWorkShapes, type WorkShapeDefinition } from "@/lib/work-management/work-shapes";
import {
  isCompletingWorkroomDriveReceipt,
  WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND,
} from "@/lib/work-management/workroom-drive-receipts";

import { decompile } from "./decompile";
import {
  markedStageKeys,
  startShapeInstance,
  stepShapeInstance,
  type GppShapeEvent,
  type GppShapeMarking,
  type InterpretableShape,
} from "./interpreter";

const ALL_DEFINITIONS: readonly WorkShapeDefinition[] = [...listWorkShapes(), ...WORK_SHAPE_PRIOR_VERSIONS];
const SEQUENCES_PER_SHAPE = 200;
/** The fixed base seed. Sequence n of shape i uses BASE_SEED + i * 100_000 + n. */
const BASE_SEED = 0x6da17863;

/** mulberry32: a small, well-known 32-bit PRNG. Deterministic across hosts. */
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

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)] as T;
}

/** A completing receipt kind the stage could plausibly record. */
function completingKind(random: () => number, definition: WorkShapeDefinition, stageKey: string): string {
  const stage = definition.stages.find((entry) => entry.key === stageKey);
  const kinds = stage && stage.evidence.length > 0 ? stage.evidence : ["decision-record"];
  return pick(random, kinds);
}

/** The next receipt: completing or blocked, for the current stage or another, or a duplicate. */
function nextReceipt(
  random: () => number,
  definition: WorkShapeDefinition,
  current: string,
  history: readonly Receipt[],
): Receipt {
  const roll = random();
  const keys = definition.stages.map((stage) => stage.key);
  if (roll < 0.35) return { stageKey: current, kind: completingKind(random, definition, current) };
  if (roll < 0.5) return { stageKey: current, kind: WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND };
  if (roll < 0.7) {
    const others = keys.filter((key) => key !== current);
    const stageKey = others.length > 0 ? pick(random, others) : current;
    return random() < 0.5
      ? { stageKey, kind: completingKind(random, definition, stageKey) }
      : { stageKey, kind: WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND };
  }
  if (roll < 0.85 && history.length > 0) return { ...pick(random, history) };
  const stageKey = pick(random, keys);
  return random() < 0.7
    ? { stageKey, kind: completingKind(random, definition, stageKey) }
    : { stageKey, kind: WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND };
}

/**
 * The interpreter events one drive receipt stands for: the receipt, then, when
 * it completes a stage whose gate is enforced and blocking, the `admit` that
 * today's recorded decision is (see the header).
 */
function eventsForReceipt(shape: InterpretableShape, receipt: Receipt): GppShapeEvent[] {
  const events: GppShapeEvent[] = [{ type: "receipt", ...receipt }];
  const stage = shape.stages.find((entry) => entry.key === receipt.stageKey);
  const gate = stage?.advance.kind === "governed-decision" ? stage.advance.gate : undefined;
  if (gate && gate.mode === "enforced" && gate.blocking && isCompletingWorkroomDriveReceipt(receipt, receipt.stageKey)) {
    events.push({ type: "gate-verdict", stageKey: receipt.stageKey, verdict: "admit", mode: "enforced" });
  }
  return events;
}

function stepAll(shape: InterpretableShape, marking: GppShapeMarking, events: readonly GppShapeEvent[]): GppShapeMarking {
  return events.reduce((current, event) => stepShapeInstance(shape, current, event), marking);
}

type SequenceOutcome = { visited: Set<string>; completed: boolean };

/** Run one seeded sequence, asserting parity after every prefix. */
function runSequence(definition: WorkShapeDefinition, document: InterpretableShape, seed: number): SequenceOutcome {
  const random = mulberry32(seed);
  const id = `${definition.key}@${definition.version}`;
  const maxSteps = definition.stages.length * 4 + 6;
  const receipts: Receipt[] = [];
  const visited = new Set<string>();

  let driveStage = nextStageKey(definition, null, receipts);
  let onDefinition: GppShapeMarking = startShapeInstance(definition);
  let onDocument: GppShapeMarking = startShapeInstance(document);
  const where = (step: number) => `seed=${seed} shape=${id} step=${step} receipts=${JSON.stringify(receipts)}`;

  expect(markedStageKeys(definition, onDefinition), where(0)).toEqual(driveStage ? [driveStage] : []);
  expect(markedStageKeys(document, onDocument), where(0)).toEqual(driveStage ? [driveStage] : []);

  for (let step = 1; step <= maxSteps && driveStage !== null; step += 1) {
    visited.add(driveStage);
    const receipt = nextReceipt(random, definition, driveStage, receipts);
    receipts.push(receipt);
    driveStage = nextStageKey(definition, driveStage, receipts);
    onDefinition = stepAll(definition, onDefinition, eventsForReceipt(definition, receipt));
    onDocument = stepAll(document, onDocument, eventsForReceipt(document, receipt));

    const expected = driveStage ? [driveStage] : [];
    expect(markedStageKeys(definition, onDefinition), where(step)).toEqual(expected);
    expect(markedStageKeys(document, onDocument), where(step)).toEqual(expected);
    if (driveStage === null) {
      expect(onDefinition.stopped?.kind, where(step)).toBe("success");
      expect(onDocument.stopped?.kind, where(step)).toBe("success");
    } else {
      expect(onDefinition.stopped, where(step)).toBeNull();
      expect(onDocument.stopped, where(step)).toBeNull();
    }
  }
  return { visited, completed: driveStage === null };
}

describe("nextStageKey characterization (the drive's rule, pinned as exported)", () => {
  const shape = {
    key: "char",
    version: "1.0.0",
    title: "char",
    description: "char",
    triggers: ["claim"],
    stages: [
      { key: "a", title: "A", accountablePrincipalRef: "agent:x", advance: { kind: "status-change", condition: "c" }, evidence: [] },
      { key: "b", title: "B", accountablePrincipalRef: "role:y", advance: { kind: "governed-decision", condition: "c", decisionScope: "s" }, evidence: [] },
    ],
    stopConditions: [],
    grants: [],
    measures: [],
    budgets: [],
    reviewPoint: { everyDays: 1, description: "r" },
  } as const satisfies Parameters<typeof nextStageKey>[0];

  it("is exported as a function", () => {
    expect(typeof nextStageKey).toBe("function");
  });

  it("proposes the first stage when the room has no current stage", () => {
    expect(nextStageKey(shape, null, [])).toBe("a");
    expect(nextStageKey(shape, null, [{ stageKey: "a", kind: "draft-artifact" }])).toBe("a");
  });

  it("keeps the current stage until a completing receipt for it exists", () => {
    expect(nextStageKey(shape, "a", [])).toBe("a");
    expect(nextStageKey(shape, "a", [{ stageKey: "b", kind: "decision-record" }])).toBe("a");
    expect(nextStageKey(shape, "a", [{ stageKey: "a", kind: WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND }])).toBe("a");
  });

  it("advances exactly one stage on a completing receipt, governed or not", () => {
    expect(nextStageKey(shape, "a", [{ stageKey: "a", kind: "anything" }])).toBe("b");
    expect(
      nextStageKey(shape, "a", [
        { stageKey: "a", kind: "x" },
        { stageKey: "b", kind: "decision-record" },
      ]),
    ).toBe("b");
  });

  it("proposes no stage after the last stage completes, or for an unknown current stage", () => {
    expect(nextStageKey(shape, "b", [{ stageKey: "b", kind: "decision-record" }])).toBeNull();
    expect(nextStageKey(shape, "zzz", [{ stageKey: "zzz", kind: "x" }])).toBeNull();
    expect(nextStageKey(shape, "zzz", [])).toBe("zzz");
  });

  it("proposes nothing for a shape with no stages", () => {
    expect(nextStageKey({ ...shape, stages: [] }, null, [])).toBeNull();
  });
});

describe("AC-INTERPRETER: interpreter ≡ drive on every registry shape", () => {
  it("covers every registry definition (current and prior), counted from the registry", () => {
    expect(ALL_DEFINITIONS.length).toBe(listWorkShapes().length + WORK_SHAPE_PRIOR_VERSIONS.length);
    expect(ALL_DEFINITIONS.length).toBeGreaterThan(0);
    // Every registry definition is sequential: none declares an explicit flow.
    for (const definition of ALL_DEFINITIONS) expect("flow" in definition, definition.key).toBe(false);
  });

  it.each(ALL_DEFINITIONS.map((definition, index) => [`${definition.key}@${definition.version}`, definition, index] as const))(
    "%s: %#",
    (_id, definition, index) => {
      const { document } = decompile(definition);
      const visited = new Set<string>();
      let completed = 0;
      for (let sequence = 0; sequence < SEQUENCES_PER_SHAPE; sequence += 1) {
        const outcome = runSequence(definition, document, BASE_SEED + index * 100_000 + sequence);
        for (const key of outcome.visited) visited.add(key);
        if (outcome.completed) completed += 1;
      }
      // The generator exercised the whole shape: every stage was current at least once, and some runs completed.
      expect([...visited].sort()).toEqual(definition.stages.map((stage) => stage.key).sort());
      expect(completed).toBeGreaterThan(0);
    },
  );
});
