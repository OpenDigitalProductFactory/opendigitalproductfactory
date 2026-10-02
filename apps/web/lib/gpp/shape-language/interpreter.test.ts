// Reference interpreter semantics beyond the sequential parity case (PR-3b-2,
// BI-6DA17863). Design: docs/superpowers/specs/
// 2026-10-02-gpp-shape-notation-and-compiler-design.md §6.1 rules 1–8, §6.2
// (gates). The sequential case against the drive is interpreter-parity.test.ts.

import { describe, expect, it } from "vitest";

import { WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND } from "@/lib/work-management/workroom-drive-receipts";

import type { GppShapeDocument } from "./gpp-shape-schema";
import {
  markedStageKeys,
  startShapeInstance,
  stepShapeInstance,
  type GppShapeEvent,
  type GppShapeMarking,
} from "./interpreter";

type Stage = GppShapeDocument["stages"][number];
type Gate = NonNullable<Extract<Stage["advance"], { kind: "governed-decision" }>["gate"]>;

function stage(key: string, gate?: Partial<Gate>): Stage {
  if (!gate) return { key, title: key, accountablePrincipalRef: "role:o", advance: { kind: "status-change", condition: "c" }, evidence: [] };
  return {
    key,
    title: key,
    accountablePrincipalRef: "role:o",
    advance: {
      kind: "governed-decision",
      condition: "c",
      decisionScope: "s",
      gate: { authority: "wwmd", mode: "enforced", blocking: true, resolution: "accountable-human", ...gate },
    },
    evidence: ["decision-record"],
  };
}

function shape(stages: Stage[], flow?: GppShapeDocument["flow"]): GppShapeDocument {
  return {
    format: "gpp-shape/0.1",
    key: "interp",
    version: "1.0.0",
    title: "t",
    description: "d",
    triggers: ["claim"],
    stages,
    ...(flow ? { flow } : {}),
    stopConditions: [
      { kind: "success", condition: "s", disposition: "proceed" },
      { kind: "failure", condition: "f", disposition: "refused" },
      { kind: "budget", condition: "b", disposition: "inconclusive" },
    ],
    grants: [],
    measures: [],
    budgets: [],
    reviewPoint: { everyDays: 1, description: "r" },
    collaborationShape: null,
  };
}

function run(document: GppShapeDocument, events: GppShapeEvent[]): GppShapeMarking {
  return events.reduce((marking, event) => stepShapeInstance(document, marking, event), startShapeInstance(document));
}

const receipt = (stageKey: string, kind = "decision-record"): GppShapeEvent => ({ type: "receipt", stageKey, kind });
const verdict = (stageKey: string, value: "admit" | "hold" | "escalate" | "refuse", mode: "shadow" | "enforced" = "enforced"): GppShapeEvent => ({
  type: "gate-verdict",
  stageKey,
  verdict: value,
  mode,
});

describe("start, completion and stops (§6.1 rules 1, 3, 7)", () => {
  const document = shape([stage("a"), stage("b")]);

  it("starts with one token on the first stage", () => {
    expect(markedStageKeys(document, startShapeInstance(document))).toEqual(["a"]);
  });

  it("a blocked receipt does not complete a stage; a completing one does", () => {
    expect(markedStageKeys(document, run(document, [receipt("a", WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND)]))).toEqual(["a"]);
    expect(markedStageKeys(document, run(document, [receipt("a", "anything")]))).toEqual(["b"]);
  });

  it("fires at most one stage per event, as the drive advances one stage per tick", () => {
    const early = run(document, [receipt("b"), receipt("a")]);
    expect(markedStageKeys(document, early)).toEqual(["b"]);
    expect(run(document, [receipt("b"), receipt("a"), receipt("a")]).stopped?.kind).toBe("success");
  });

  it("a failure or budget stop fires from any marking and ends the instance", () => {
    const stopped = run(document, [{ type: "stop", kind: "budget" }]);
    expect(stopped.stopped).toEqual({ stopId: "stop:budget:1", kind: "budget", disposition: "inconclusive" });
    expect(stopped.tokens).toEqual([]);
    expect(stepShapeInstance(document, stopped, receipt("a"))).toBe(stopped);
  });

  it("never mutates its input marking", () => {
    const start = startShapeInstance(document);
    const snapshot = JSON.stringify(start);
    stepShapeInstance(document, start, receipt("a"));
    expect(JSON.stringify(start)).toBe(snapshot);
  });
});

describe("gates (§6.2)", () => {
  it("enforced and blocking: only admit moves the token; hold and escalate keep it", () => {
    const document = shape([stage("a", {}), stage("b")]);
    expect(markedStageKeys(document, run(document, [receipt("a")]))).toEqual(["a"]);
    expect(markedStageKeys(document, run(document, [receipt("a"), verdict("a", "hold")]))).toEqual(["a"]);
    expect(markedStageKeys(document, run(document, [receipt("a"), verdict("a", "escalate")]))).toEqual(["a"]);
    expect(markedStageKeys(document, run(document, [receipt("a"), verdict("a", "admit")]))).toEqual(["b"]);
    expect(markedStageKeys(document, run(document, [verdict("a", "admit"), receipt("a")]))).toEqual(["b"]);
  });

  it("an admit with no completing receipt does not move the token", () => {
    const document = shape([stage("a", {}), stage("b")]);
    expect(markedStageKeys(document, run(document, [verdict("a", "admit")]))).toEqual(["a"]);
  });

  it("a refuse never defaults to admit: with no route, the token stays", () => {
    const document = shape([stage("a", {}), stage("b")]);
    expect(markedStageKeys(document, run(document, [receipt("a"), verdict("a", "refuse")]))).toEqual(["a"]);
  });

  it("a verdict recorded under a mode other than the gate's never moves the token", () => {
    const document = shape([stage("a", {}), stage("b")]);
    expect(markedStageKeys(document, run(document, [receipt("a"), verdict("a", "admit", "shadow")]))).toEqual(["a"]);
  });

  it("shadow, and enforced non-blocking: the receipt alone moves the token; the verdict is recorded", () => {
    for (const gate of [{ mode: "shadow" as const }, { blocking: false }]) {
      const document = shape([stage("a", gate), stage("b")]);
      const marking = run(document, [verdict("a", "refuse", gate.mode ?? "enforced"), receipt("a")]);
      expect(markedStageKeys(document, marking)).toEqual(["b"]);
      expect(marking.verdicts.a?.verdict).toBe("refuse");
    }
  });

  it("an untyped governed-decision advance moves on its receipt, as today's drive", () => {
    const document = shape([
      { key: "a", title: "a", accountablePrincipalRef: "role:o", advance: { kind: "governed-decision", condition: "c", decisionScope: "s" }, evidence: [] },
      stage("b"),
    ]);
    expect(markedStageKeys(document, run(document, [receipt("a")]))).toEqual(["b"]);
  });

  it("refuse to a stop ends the instance with that stop's disposition", () => {
    const document = shape([stage("a"), stage("b", { onRefuse: "failure" })]);
    const marking = run(document, [receipt("a"), receipt("b"), verdict("b", "refuse")]);
    expect(marking.stopped).toEqual({ stopId: "stop:failure:1", kind: "failure", disposition: "refused" });
  });
});

describe("rework (§6.1 rule 6)", () => {
  const document = shape([stage("a"), stage("b", { onRefuse: "a" })], {
    nodes: [],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "success" },
      { from: "b", to: "a", rework: { maxIterations: 1 } },
    ],
  });

  it("a refuse returns the token to the earlier stage and clears the receipts it returns across", () => {
    const marking = run(document, [receipt("a", "x"), receipt("b"), verdict("b", "refuse")]);
    expect(markedStageKeys(document, marking)).toEqual(["a"]);
    expect(marking.receipts).toEqual([]);
    expect(marking.verdicts).toEqual({});
    expect(marking.reworkTaken).toEqual({ "edge:b->a": 1 });
  });

  it("past maxIterations the token goes to the budget stop", () => {
    const marking = run(document, [
      receipt("a", "x"),
      receipt("b"),
      verdict("b", "refuse"),
      receipt("a", "x"),
      receipt("b"),
      verdict("b", "refuse"),
    ]);
    expect(marking.stopped?.kind).toBe("budget");
  });

  it("an unbounded refuse route (no rework edge) is never taken as a loop; it goes to the budget stop", () => {
    const unbounded = shape([stage("a"), stage("b", { onRefuse: "a" })]);
    expect(run(unbounded, [receipt("a", "x"), receipt("b"), verdict("b", "refuse")]).stopped?.kind).toBe("budget");
  });
});
