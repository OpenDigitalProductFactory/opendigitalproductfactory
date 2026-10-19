// Stage deadlines, pure (BI-8875C9DF, GPP Phase 3c PR-3c-4). Design:
// docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md §8.
// The parity with the reference interpreter is drive-parity-deadline.test.ts;
// the notice through the runner is lib/queue/functions/workroom-drive-deadline.test.ts.

import { describe, expect, it } from "vitest";

import { DEADLINE_FIXTURE } from "./__fixtures__/graph-shape-fixtures";
import {
  DAY_MS,
  deadlineEscalationRef,
  deadlineKey,
  openDeadlines,
  overdueDeadlines,
  parseDeadlineKey,
  raiseDueDeadlines,
  unnotifiedDeadlines,
  withDeadlinesNotified,
} from "./drive-deadlines";
import type { DriveMarking } from "./drive-marking";
import type { WorkShapeDefinition, WorkShapeStage } from "./work-shapes";

const T0 = new Date("2026-03-02T09:00:00.000Z");
const CYCLE = "graph-fixture-deadline@1.0.0:2026-03-02";
const at = (ms: number) => new Date(T0.getTime() + ms);

/** DEADLINE_FIXTURE: a → b, and b declares a two-day deadline. */
function marking(over: Partial<DriveMarking> = {}): DriveMarking {
  return {
    format: "drive-marking/1",
    cycleKey: CYCLE,
    tokens: [{ node: "stage:b", enteredAt: T0.toISOString() }],
    iterations: {},
    reworkTaken: {},
    deadlines: {},
    children: {},
    ...over,
  };
}

describe("deadline keys", () => {
  it("are <cycleKey>#<stageKey>#<iteration> and parse back, even when the cycle key holds #", () => {
    expect(deadlineKey(CYCLE, "b", 0)).toBe(`${CYCLE}#b#0`);
    expect(parseDeadlineKey(`${CYCLE}#b#2`)).toEqual({ cycleKey: CYCLE, stageKey: "b", iteration: 2 });
    expect(parseDeadlineKey("c#1#x#3")).toEqual({ cycleKey: "c#1", stageKey: "x", iteration: 3 });
    for (const bad of ["", "b#0", "c#b#-1", "c#b#1.5", "c#b#x"]) expect(parseDeadlineKey(bad), bad).toBeNull();
  });
});

describe("overdue", () => {
  it("a token is overdue exactly when now ≥ enteredAt + afterDays", () => {
    expect(overdueDeadlines(DEADLINE_FIXTURE, marking(), at(2 * DAY_MS - 1))).toEqual([]);
    const [due] = overdueDeadlines(DEADLINE_FIXTURE, marking(), at(2 * DAY_MS));
    expect(due).toMatchObject({
      key: `${CYCLE}#b#0`,
      stageKey: "b",
      iteration: 0,
      description: "Two days.",
      afterDays: 2,
      enteredAt: T0.toISOString(),
      dueAt: at(2 * DAY_MS).toISOString(),
      overdueMs: 0,
      escalationRef: "agent:graph-worker",
    });
    expect(overdueDeadlines(DEADLINE_FIXTURE, marking(), at(3 * DAY_MS))[0]?.overdueMs).toBe(DAY_MS);
  });

  it("a stage without a deadline, or not marked, owes nothing", () => {
    expect(overdueDeadlines(DEADLINE_FIXTURE, marking({ tokens: [{ node: "stage:a", enteredAt: T0.toISOString() }] }), at(9 * DAY_MS))).toEqual([]);
    expect(overdueDeadlines(DEADLINE_FIXTURE, marking({ tokens: [] }), at(9 * DAY_MS))).toEqual([]);
  });

  it("the escalation target is the gate's escalation role, else the stage's accountable principal", () => {
    const stage = (gate: object | undefined): WorkShapeStage => ({
      key: "s",
      title: "S",
      accountablePrincipalRef: "role:owner",
      advance: gate
        ? { kind: "governed-decision", condition: "c", decisionScope: "x", gate: { authority: "wwmd", mode: "enforced", blocking: true, resolution: "accountable-human", ...gate } }
        : { kind: "status-change", condition: "c" },
      evidence: ["decision-record"],
    });
    expect(deadlineEscalationRef(stage(undefined))).toBe("role:owner");
    expect(deadlineEscalationRef(stage({}))).toBe("role:owner");
    expect(deadlineEscalationRef(stage({ escalation: { role: "role:legal" } }))).toBe("role:legal");
  });
});

describe("raise: one notice per cycle, stage and iteration; tokens untouched", () => {
  it("raises once with notifiedAt null, and the same key never again", () => {
    const first = raiseDueDeadlines(DEADLINE_FIXTURE, marking(), at(2 * DAY_MS));
    expect(first.raised.map((due) => due.key)).toEqual([`${CYCLE}#b#0`]);
    expect(first.marking.deadlines).toEqual({ [`${CYCLE}#b#0`]: { raisedAt: at(2 * DAY_MS).toISOString(), notifiedAt: null } });
    expect(first.marking.tokens).toEqual(marking().tokens);
    const again = raiseDueDeadlines(DEADLINE_FIXTURE, first.marking, at(5 * DAY_MS));
    expect(again.raised).toEqual([]);
    expect(again.marking).toBe(first.marking);
  });

  it("never changes tokens, iterations or rework counters", () => {
    const before = marking({ iterations: { b: 1 }, reworkTaken: { "edge:b->a": 1 } });
    const { marking: after } = raiseDueDeadlines(DEADLINE_FIXTURE, before, at(9 * DAY_MS));
    expect(after.tokens).toEqual(before.tokens);
    expect(after.iterations).toEqual(before.iterations);
    expect(after.reworkTaken).toEqual(before.reworkTaken);
    expect(after.children).toEqual(before.children);
  });

  it("a rework (a new iteration, entered afresh) owes a new notice under a new key", () => {
    const raised = raiseDueDeadlines(DEADLINE_FIXTURE, marking(), at(2 * DAY_MS)).marking;
    const reworked = { ...raised, iterations: { a: 1, b: 1 }, tokens: [{ node: "stage:b", enteredAt: at(3 * DAY_MS).toISOString() }] };
    expect(overdueDeadlines(DEADLINE_FIXTURE, reworked, at(4 * DAY_MS))).toEqual([]);
    expect(raiseDueDeadlines(DEADLINE_FIXTURE, reworked, at(5 * DAY_MS)).raised.map((due) => due.key)).toEqual([`${CYCLE}#b#1`]);
  });

  it("a new cycle can notice the same stage again", () => {
    const next = marking({ cycleKey: "graph-fixture-deadline@1.0.0:2026-03-09", tokens: [{ node: "stage:b", enteredAt: at(7 * DAY_MS).toISOString() }] });
    expect(raiseDueDeadlines(DEADLINE_FIXTURE, next, at(9 * DAY_MS)).raised.map((due) => due.key)).toEqual(["graph-fixture-deadline@1.0.0:2026-03-09#b#0"]);
  });

  it("parallel branches each owe their own notice, in document order", () => {
    const shape: WorkShapeDefinition = {
      ...DEADLINE_FIXTURE,
      stages: DEADLINE_FIXTURE.stages.map((stage) => ({ ...stage, deadline: { afterDays: 1, description: `${stage.key} in a day.` } })),
    };
    const both = marking({ tokens: [{ node: "stage:a", enteredAt: T0.toISOString() }, { node: "stage:b", enteredAt: at(DAY_MS).toISOString() }] });
    expect(raiseDueDeadlines(shape, both, at(2 * DAY_MS)).raised.map((due) => due.stageKey)).toEqual(["a", "b"]);
  });
});

describe("notice bookkeeping", () => {
  const key = `${CYCLE}#b#0`;
  const raised = marking({ deadlines: { [key]: { raisedAt: at(2 * DAY_MS).toISOString(), notifiedAt: null } } });

  it("unnotified lists a raised, unsent notice with what the notice says", () => {
    expect(unnotifiedDeadlines(DEADLINE_FIXTURE, raised)).toEqual([
      { key, stageKey: "b", stageTitle: "Stage b", iteration: 0, description: "Two days.", afterDays: 2, raisedAt: at(2 * DAY_MS).toISOString(), escalationRef: "agent:graph-worker" },
    ]);
    expect(unnotifiedDeadlines(DEADLINE_FIXTURE, marking({ deadlines: { "junk": { raisedAt: T0.toISOString(), notifiedAt: null } } }))).toEqual([]);
  });

  it("withDeadlinesNotified writes notifiedAt once, and never overwrites a sent one", () => {
    const sent = withDeadlinesNotified(raised, [key, "absent"], at(3 * DAY_MS));
    expect(sent.deadlines[key]).toEqual({ raisedAt: at(2 * DAY_MS).toISOString(), notifiedAt: at(3 * DAY_MS).toISOString() });
    expect(unnotifiedDeadlines(DEADLINE_FIXTURE, sent)).toEqual([]);
    expect(withDeadlinesNotified(sent, [key], at(4 * DAY_MS))).toBe(sent);
  });

  it("open deadlines are the raised notices whose token is still on that stage at that iteration", () => {
    expect(openDeadlines(DEADLINE_FIXTURE, raised).map((entry) => entry.stageKey)).toEqual(["b"]);
    expect(openDeadlines(DEADLINE_FIXTURE, { ...raised, tokens: [] })).toEqual([]);
    expect(openDeadlines(DEADLINE_FIXTURE, { ...raised, iterations: { b: 1 } })).toEqual([]);
  });
});
