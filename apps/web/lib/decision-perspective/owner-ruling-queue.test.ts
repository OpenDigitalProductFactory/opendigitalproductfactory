// BI-EB5E9BE3 — the owner's ruling queue selected on ROUTE, not ownership.
//
// Live proof on origin/main @ 2cc2845398: 14 unresolved, unanswered
// DecisionInteraction rows with routeContext "/ops/demand" and the organization
// profile were excluded from "Waiting on your call", because the predicate
// required routeContext to equal "/coworker-business" exactly. Six approved
// standing-Workroom prerequisites sat unfunded as a result.
//
// The first test is the regression: it fails under the old route-equality rule
// and passes under the ownership rule.
import { describe, it, expect } from "vitest";
import {
  isOwnerRulingQueueRow,
  ownerRulingQueueWhere,
  type OwnerRulingCandidate,
} from "./owner-ruling-queue";

const ORG_PROFILES = ["wwwd-operator-org"];
/** Stands in for Prisma.DbNull, which has no runtime in unit tests. */
const DB_NULL = Symbol("DbNull");

function row(over: Partial<OwnerRulingCandidate> = {}): OwnerRulingCandidate {
  return {
    outcomeType: "defer",
    buildId: null,
    taskRunId: null,
    question: "Fund now or defer?",
    humanOutcome: null,
    profileId: "wwwd-operator-org",
    routeContext: "/coworker-business",
    domainClass: "business",
    gateKey: null,
    ...over,
  };
}

/** The predicate as it behaved before this fix — route equality. */
function legacyRouteOnly(r: OwnerRulingCandidate): boolean {
  return r.routeContext === "/coworker-business";
}

describe("owner ruling queue selects on ownership, not route (BI-EB5E9BE3)", () => {
  it("includes an /ops/demand decision scored against the organization profile", () => {
    const demand = row({ routeContext: "/ops/demand" });
    // The defect, stated as an assertion: the old rule dropped this row.
    expect(legacyRouteOnly(demand)).toBe(false);
    // The fix: ownership decides, so it is the owner's to rule on.
    expect(isOwnerRulingQueueRow(demand, ORG_PROFILES)).toBe(true);
  });

  it("keeps the existing /coworker-business path visible", () => {
    expect(isOwnerRulingQueueRow(row(), ORG_PROFILES)).toBe(true);
  });

  it("excludes everything that is not the owner's call", () => {
    const cases: Array<[string, OwnerRulingCandidate]> = [
      ["profession gate", row({ gateKey: "profession" })],
      ["kernel consult", row({ domainClass: "kernel-consult" })],
      ["platform WWMD", row({ routeContext: "mcp:principle_decide" })],
      ["build-bound", row({ buildId: "FB-1" })],
      ["task-bound", row({ taskRunId: "TR-1" })],
      ["empty question", row({ question: "" })],
      ["already answered", row({ humanOutcome: "fund" })],
      ["another org's profile", row({ profileId: "wwwd-other-org" })],
      ["no profile at all", row({ profileId: null })],
      ["already resolved", row({ outcomeType: "decide" })],
    ];
    for (const [label, candidate] of cases) {
      expect(isOwnerRulingQueueRow(candidate, ORG_PROFILES), label).toBe(false);
    }
  });

  it("selects nothing when no organization profile is configured", () => {
    // Fail closed: an install without a profile must not inherit platform rows.
    expect(isOwnerRulingQueueRow(row(), [])).toBe(false);
    expect(ownerRulingQueueWhere([], DB_NULL).profileId).toEqual({ in: [] });
  });

  it("builds a where clause that does not constrain routeContext", () => {
    const where = ownerRulingQueueWhere(ORG_PROFILES, DB_NULL);
    // The whole point: route must not narrow the inbox.
    expect(where).not.toHaveProperty("routeContext");
    expect(where.profileId).toEqual({ in: ORG_PROFILES });
    expect(where.buildId).toBeNull();
  });
});
