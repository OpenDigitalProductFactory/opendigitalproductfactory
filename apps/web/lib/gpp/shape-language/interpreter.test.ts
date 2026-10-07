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

// GPP Phase 3c PR-3c-4 (BI-8875C9DF), written from parent §6.1 rule 8 ("timers never change M") and the
// Phase 3c design §8 (a deadline is non-interrupting: it never routes to a refuse route or a stop).
describe("stage deadlines (§6.1 rule 8)", () => {
  const deadline = (stageKey: string): GppShapeEvent => ({ type: "deadline", stageKey });
  const document = shape([stage("a"), stage("b", { onRefuse: "failure" }), stage("c")]);

  it("returns the marking unchanged, whatever stage it names", () => {
    const start = startShapeInstance(document);
    for (const key of ["a", "b", "c", "no-such-stage"]) expect(stepShapeInstance(document, start, deadline(key))).toBe(start);
  });

  it("records nothing: a receipt or verdict waiting to fire does not fire on a deadline", () => {
    // b is enabled by the receipt recorded before a moved on; one firing per event leaves it for the next event.
    const waiting = run(document, [receipt("b"), receipt("a", "x")]);
    expect(markedStageKeys(document, waiting)).toEqual(["b"]);
    const after = stepShapeInstance(document, waiting, deadline("b"));
    expect(after).toBe(waiting);
    expect(after.receipts).toEqual(waiting.receipts);
  });

  it("never routes the token to its refuse route or a stop, and never moves it on", () => {
    const atB = run(document, [receipt("a", "x")]);
    const overdue = [deadline("b"), deadline("b"), deadline("a")].reduce((marking, event) => stepShapeInstance(document, marking, event), atB);
    expect(markedStageKeys(document, overdue)).toEqual(["b"]);
    expect(overdue.stopped).toBeNull();
    expect(overdue.reworkTaken).toEqual({});
  });

  it("interleaved with receipts, the run equals the same run without the deadlines", () => {
    const events = [receipt("a", "x"), receipt("b"), verdict("b", "admit"), receipt("c", "y")];
    const withDeadlines = events.flatMap((event) => [deadline("b"), event, deadline("c")]);
    expect(run(document, withDeadlines)).toEqual(run(document, events));
  });

  it("on a stopped instance it is ignored like every other event", () => {
    const stopped = run(document, [{ type: "stop", kind: "failure" }]);
    expect(stepShapeInstance(document, stopped, deadline("a"))).toBe(stopped);
  });
});

// GPP Phase 3c PR-3c-5 (BI-8875C9DF), written from the Phase 3c design §6.4 and §9.2 (rule 9): a child's success
// on a marked stage behaves as a completing receipt for it; a failure or budget stop leaves the marking unchanged.
describe("sub-shape child stops (rule 9)", () => {
  const childStop = (stageKey: string, kind: "success" | "failure" | "budget"): GppShapeEvent => ({ type: "child-stop", stageKey, kind });
  const document = shape([stage("a"), stage("b"), stage("c")]);

  it("success on a marked stage completes it, exactly as a completing receipt would", () => {
    const atB = run(document, [receipt("a", "x")]);
    const onSuccess = stepShapeInstance(document, atB, childStop("b", "success"));
    expect(markedStageKeys(document, onSuccess)).toEqual(["c"]);
    expect(markedStageKeys(document, onSuccess)).toEqual(markedStageKeys(document, stepShapeInstance(document, atB, receipt("b", "child-completion"))));
    expect(onSuccess.receipts).toContainEqual({ stageKey: "b", kind: "child-completion" });
  });

  it("failure or budget leaves the marking unchanged: the token waits, and no stop is propagated", () => {
    const atB = run(document, [receipt("a", "x")]);
    for (const kind of ["failure", "budget"] as const) {
      const after = stepShapeInstance(document, atB, childStop("b", kind));
      expect(after).toBe(atB);
      expect(after.stopped).toBeNull();
    }
  });

  it("a child stop for a stage that holds no token changes nothing, even a success", () => {
    const atB = run(document, [receipt("a", "x")]);
    for (const kind of ["success", "failure", "budget"] as const) expect(stepShapeInstance(document, atB, childStop("c", kind))).toBe(atB);
  });

  it("behind an enforced, blocking gate the child's success is the receipt; the gate still needs its verdict", () => {
    const gated = shape([stage("a"), stage("b", {}), stage("c")]);
    const waiting = stepShapeInstance(gated, run(gated, [receipt("a", "x")]), childStop("b", "success"));
    expect(markedStageKeys(gated, waiting)).toEqual(["b"]);
    expect(markedStageKeys(gated, stepShapeInstance(gated, waiting, verdict("b", "admit")))).toEqual(["c"]);
  });

  it("in a parallel branch it completes only its own branch", () => {
    const forked = shape([stage("a"), stage("b"), stage("c"), stage("d")], {
      nodes: [{ id: "p", type: "parallel-split" }, { id: "j", type: "parallel-join", pairs: "p" }],
      edges: [
        { from: "a", to: "p" }, { from: "p", to: "b" }, { from: "p", to: "c" },
        { from: "b", to: "j" }, { from: "c", to: "j" }, { from: "j", to: "d" }, { from: "d", to: "success" },
      ],
    });
    const branches = run(forked, [receipt("a", "x")]);
    expect(markedStageKeys(forked, branches)).toEqual(["b", "c"]);
    expect(markedStageKeys(forked, stepShapeInstance(forked, branches, childStop("b", "success")))).toEqual(["c"]);
  });
});
