import { describe, expect, it } from "vitest";
import { humanCaptureOutcome, humanEscalationWhere, isHumanEscalation } from "./human-escalation";

describe("one human escalation predicate", () => {
  it("applies the same human meaning to the restored domain route", () => {
    expect(isHumanEscalation({ outcomeType: "recommend", escalation: { route: "human" } })).toBe(true);
    expect(humanCaptureOutcome({ outcomeType: "recommend", escalation: { route: "human" } })).toBe("escalate");
    expect(isHumanEscalation({ outcomeType: "defer", escalation: { route: "independent-review" } })).toBe(false);
  });
  it.each(["recommend", "arbitrate", "decline", "defer", "escalate"])("a recorded human route is visible even for %s", (outcomeType) => {
    expect(isHumanEscalation({ outcomeType, escalationRoute: "human" })).toBe(true);
    expect(humanCaptureOutcome({ outcomeType, escalationRoute: "human" })).toBe("escalate");
  });

  it.each(["recommend", "arbitrate", "decline", "defer", "escalate"])("a recorded independent/decided route never asks a person (%s)", (outcomeType) => {
    for (const escalationRoute of ["independent_review", "decided"] as const) {
      expect(isHumanEscalation({ outcomeType, escalationRoute })).toBe(false);
      expect(humanCaptureOutcome({ outcomeType, escalationRoute })).toBeNull();
    }
  });

  it("preserves the exact legacy unresolved and capture meanings", () => {
    expect(isHumanEscalation({ outcomeType: "defer", escalationRoute: null })).toBe(true);
    expect(isHumanEscalation({ outcomeType: "escalate" })).toBe(true);
    expect(isHumanEscalation({ outcomeType: "recommend", escalationRoute: null })).toBe(false);
    expect(humanCaptureOutcome({ outcomeType: "defer" })).toBe("defer");
    expect(humanCaptureOutcome({ outcomeType: "escalate" })).toBe("escalate");
  });

  it("builds the same routed-human OR legacy-NULL predicate for Prisma", () => {
    expect(humanEscalationWhere()).toEqual({ OR: [
      { escalationRoute: "human" },
      { escalationRoute: null, outcomeType: { in: ["defer", "escalate"] } },
    ] });
  });

  it("conjoins existing ownership/visibility conditions without overwriting their OR", () => {
    const existing = { profileId: { in: ["org-profile"] }, OR: [{ buildId: null }, { taskRunId: "own-task" }] };
    const before = structuredClone(existing);
    expect(humanEscalationWhere(existing)).toEqual({ AND: [existing, humanEscalationWhere()] });
    expect(existing).toEqual(before);
  });
});
