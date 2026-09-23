import { describe, expect, it } from "vitest";

import {
  AXIS_TO_CAPABILITY_PLANE,
  JOB_DEFINITION_AXES,
  isJobDefinitionComplete,
  unansweredAxes,
  validateJobDefinition,
  type CoworkerJobDefinition,
} from "./coworker-job-definition";

// WHAT THESE GUARD. The contract's whole value is that an axis cannot be left
// UNANSWERED — the door's failure was never a bad answer, it was no question.
// So the tests below are mostly about the ways "answered" could be faked:
// an empty reason, an unparseable date, or a waiver that quietly outlives its
// own review.

const REVIEW = "2099-01-01";

function answerAll(state: "satisfied" | "waived" = "satisfied"): CoworkerJobDefinition {
  return {
    agentId: "field-safety-auditor",
    axes: Object.fromEntries(
      JOB_DEFINITION_AXES.map((axis) => [
        axis,
        state === "satisfied"
          ? { state, evidence: `${axis} is satisfied by a named, checkable piece of substrate here.` }
          : { state, reason: `${axis} is deliberately deferred for a reason stated at length here.`, reviewBy: REVIEW },
      ]),
    ),
  };
}

describe("an axis cannot be left unanswered", () => {
  it("reports every unanswered axis, not just the first", () => {
    const def: CoworkerJobDefinition = { agentId: "x", axes: {} };
    expect(unansweredAxes(def)).toEqual([...JOB_DEFINITION_AXES]);
    expect(validateJobDefinition(def)).toHaveLength(JOB_DEFINITION_AXES.length);
  });

  it("names the axis and tells the author both ways out", () => {
    const problems = validateJobDefinition({ agentId: "x", axes: {} });
    const cadence = problems.find((p) => p.axis === "cadence");
    expect(cadence?.code).toBe("unanswered");
    expect(cadence?.detail).toContain("waive it");
  });

  it("a fully answered definition is complete", () => {
    expect(isJobDefinitionComplete(answerAll())).toBe(true);
    expect(isJobDefinitionComplete(answerAll("waived"))).toBe(true);
  });
});

describe("a waiver is not a blank", () => {
  it("refuses a reason too thin to disagree with", () => {
    const def = answerAll("waived");
    def.axes.context = { state: "waived", reason: "n/a", reviewBy: REVIEW };
    const problem = validateJobDefinition(def).find((p) => p.axis === "context");
    expect(problem?.code).toBe("thin-justification");
  });

  it("refuses a satisfied claim with no evidence behind it", () => {
    const def = answerAll();
    def.axes.measures = { state: "satisfied", evidence: "done" };
    const problem = validateJobDefinition(def).find((p) => p.axis === "measures");
    expect(problem?.code).toBe("thin-justification");
  });

  it("refuses an unparseable review date", () => {
    const def = answerAll("waived");
    def.axes.cadence = { state: "waived", reason: "Deferred while the room-owned ruling lands.", reviewBy: "someday" };
    const problem = validateJobDefinition(def).find((p) => p.axis === "cadence");
    expect(problem?.code).toBe("unparseable-review-date");
  });
});

describe("a waiver expires", () => {
  it("fails once the review date passes", () => {
    // THE LOAD-BEARING RULE. When this fires in anger the answer is to
    // re-decide the axis, never to push the date out because the build is red.
    const def = answerAll("waived");
    def.axes.accountabilities = {
      state: "waived",
      reason: "Deferred until the archetype's value stream declares this stage.",
      reviewBy: "2026-01-01",
    };
    const problem = validateJobDefinition(def, new Date("2026-06-01")).find(
      (p) => p.axis === "accountabilities",
    );
    expect(problem?.code).toBe("expired-waiver");
    expect(problem?.detail).toContain("re-decide");
  });

  it("passes while the date is still ahead", () => {
    const def = answerAll("waived");
    expect(isJobDefinitionComplete(def, new Date("2026-06-01"))).toBe(true);
  });

  it("treats the review date as inclusive — the day it is due, it is due", () => {
    const def = answerAll("waived");
    def.axes.purpose = { state: "waived", reason: "A reason long enough to be an actual sentence here.", reviewBy: "2026-06-01" };
    const problem = validateJobDefinition(def, new Date("2026-06-01")).find((p) => p.axis === "purpose");
    expect(problem?.code).toBe("expired-waiver");
  });
});

describe("this contract is not a second completeness model", () => {
  it("maps its capability axes onto the measure's own plane names", () => {
    // If these drift from capability-completeness.ts, the platform has two
    // opinions about what a complete coworker is — which is the defect this
    // codebase keeps finding in other guises.
    expect(Object.values(AXIS_TO_CAPABILITY_PLANE).sort()).toEqual([
      "cadence",
      "corpus",
      "evidence",
      "governance",
      "identity",
      "shape",
      "toolsAndSkills",
    ]);
  });

  it("leaves exactly supervision and tailoring unmapped, on purpose", () => {
    const unmapped = JOB_DEFINITION_AXES.filter((a) => !AXIS_TO_CAPABILITY_PLANE[a]);
    // The measure grades a coworker's CAPABILITY. These two are facts about its
    // PLACE — who it answers to, and which install it is on.
    expect(unmapped).toEqual(["supervision", "tailoring"]);
  });

  it("keeps cadence pointed at the room-owned ruling, not a per-coworker toggle", () => {
    const src = JOB_DEFINITION_AXES.includes("cadence");
    expect(src).toBe(true);
    expect(AXIS_TO_CAPABILITY_PLANE.cadence).toBe("cadence");
  });
});
