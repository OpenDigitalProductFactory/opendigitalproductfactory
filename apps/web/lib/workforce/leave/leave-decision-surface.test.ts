import { describe, expect, it } from "vitest";
import { mapOrgDecisionToLeaveOutcome } from "./leave-decision-surface";

// D2.2 surface adapter. Maps the WWWD org-business-decision response
// (evaluate_org_business_decision) into the surface-agnostic LeaveDecisionOutcome
// that resolveLeaveDecision consumes. Conservative by design: only a genuine
// recommend/arbitrate verdict WITH a valid approve|deny option produces a
// recommendation; everything else escalates by exception — the coworker never
// invents a decision the surface declined.

describe("mapOrgDecisionToLeaveOutcome", () => {
  it("maps a recommend/approve verdict to recommend-approve", () => {
    expect(
      mapOrgDecisionToLeaveOutcome({ outcomeType: "recommend", recommendedOptionId: "approve", allowed: true }),
    ).toBe("recommend-approve");
  });

  it("maps a recommend/deny verdict to recommend-deny", () => {
    expect(
      mapOrgDecisionToLeaveOutcome({ outcomeType: "recommend", recommendedOptionId: "deny", allowed: true }),
    ).toBe("recommend-deny");
  });

  it("passes an arbitrate verdict through (it also yields a real recommendation)", () => {
    expect(
      mapOrgDecisionToLeaveOutcome({ outcomeType: "arbitrate", recommendedOptionId: "approve", allowed: true }),
    ).toBe("recommend-approve");
  });

  it("escalates an escalate verdict", () => {
    expect(
      mapOrgDecisionToLeaveOutcome({ outcomeType: "escalate", recommendedOptionId: null, allowed: false }),
    ).toBe("escalate");
  });

  it("escalates a defer verdict", () => {
    expect(
      mapOrgDecisionToLeaveOutcome({ outcomeType: "defer", recommendedOptionId: null, allowed: false }),
    ).toBe("escalate");
  });

  it("escalates when the gate did not allow acting, even if it named an option", () => {
    expect(
      mapOrgDecisionToLeaveOutcome({ outcomeType: "recommend", recommendedOptionId: "approve", allowed: false }),
    ).toBe("escalate");
  });

  it("escalates a recommendation with a missing or unknown option — never invents one", () => {
    expect(
      mapOrgDecisionToLeaveOutcome({ outcomeType: "recommend", recommendedOptionId: null, allowed: true }),
    ).toBe("escalate");
    expect(
      mapOrgDecisionToLeaveOutcome({ outcomeType: "recommend", recommendedOptionId: "maybe", allowed: true }),
    ).toBe("escalate");
  });

  it("escalates an unknown/absent outcomeType defensively", () => {
    expect(
      mapOrgDecisionToLeaveOutcome({ outcomeType: "something-new", recommendedOptionId: "approve", allowed: true }),
    ).toBe("escalate");
  });
});
