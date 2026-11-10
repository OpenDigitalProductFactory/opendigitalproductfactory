import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  WORKFORCE_STAFFING_POSTURE,
  expiredPostures,
  staffingPostureFor,
  supersessionMap,
} from "./workforce-staffing-posture";

// THE POINT OF THIS FILE. A staffing posture removes an identity from the open-gap
// count. That is exactly the move a measure gets gamed by, so the rules that make
// it honest are enforced here rather than trusted:
//
//   1. every posture carries a reason a person can argue with
//   2. every posture EXPIRES — a parked role must be re-decided, never forgotten
//   3. a "superseded" claim must name a real, ACTIVE identity that does the work
//   4. a posture may only be claimed for a role that is not already active
//
// Without (2) especially, this file would be a way to make 194 gaps disappear
// permanently, which is the opposite of what it is for.

const REGISTRY = JSON.parse(
  readFileSync(join(__dirname, "../data/agent_registry.json"), "utf8"),
) as { agents?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;

const AGENTS = (Array.isArray(REGISTRY) ? REGISTRY : REGISTRY.agents ?? []) as Array<
  Record<string, unknown>
>;
const BY_ID = new Map(AGENTS.map((a) => [a.agent_id as string, a]));

describe("every posture is arguable and expires", () => {
  it("carries a reason with actual content", () => {
    for (const [id, p] of Object.entries(WORKFORCE_STAFFING_POSTURE)) {
      expect(p.reason.trim().length, `${id} has no reason`).toBeGreaterThan(40);
    }
  });

  it("carries a parseable reviewBy date", () => {
    for (const [id, p] of Object.entries(WORKFORCE_STAFFING_POSTURE)) {
      expect(Number.isNaN(new Date(p.reviewBy).getTime()), `${id} reviewBy unparseable`).toBe(false);
    }
  });

  it("has no posture whose review date has already passed", () => {
    // THIS IS THE LOAD-BEARING TEST. When it fails, the answer is to re-decide
    // the parked roles with the operator — not to push the date out because the
    // build is red. A parking that renews itself is a permanent fiction.
    const expired = expiredPostures();
    expect(
      expired,
      `these parked roles are past their review date and must be re-decided: ${expired.join(", ")}`,
    ).toEqual([]);
  });
});

describe("supersession names a real identity that actually does the work", () => {
  it("every supersededBy target exists in the registry", () => {
    for (const [id, target] of Object.entries(supersessionMap())) {
      expect(BY_ID.has(target), `${id} is superseded by ${target}, which is not in the registry`).toBe(true);
    }
  });

  it("every supersededBy target is ACTIVE", () => {
    // Superseding one unstaffed role with another unstaffed role would move the
    // gap, not close it.
    for (const [id, target] of Object.entries(supersessionMap())) {
      expect(BY_ID.get(target)?.status, `${id} is superseded by ${target}, which is not active`).toBe("active");
    }
  });

  it("a superseded role never points at itself", () => {
    for (const [id, target] of Object.entries(supersessionMap())) {
      expect(target).not.toBe(id);
    }
  });

  it("names the two duplicates that were confirmed by reading both capability texts", () => {
    expect(supersessionMap()).toEqual({
      "AGT-904": "AGT-WS-DOC",
      "AGT-BUILD-DA": "AGT-WS-DATA-ARCHITECT",
    });
  });
});

describe("a posture is only claimable where it means something", () => {
  it("every posture id exists in the registry", () => {
    for (const id of Object.keys(WORKFORCE_STAFFING_POSTURE)) {
      expect(BY_ID.has(id), `${id} carries a posture but is not in the registry`).toBe(true);
    }
  });

  it("no ACTIVE role carries a posture", () => {
    // A posture explains why a role is NOT staffed. On a staffed role it would
    // be a contradiction, and would silently drop a working coworker from the
    // measure.
    for (const id of Object.keys(WORKFORCE_STAFFING_POSTURE)) {
      expect(BY_ID.get(id)?.status, `${id} is active and must not carry a staffing posture`).not.toBe("active");
    }
  });

  it("parks the six customer-facing roles ONLY on orchestrator coverage", () => {
    // THIS TEST WAS INVERTED, DELIBERATELY, AND THE REASON MATTERS.
    //
    // It previously asserted AGT-150/151/152 and AGT-160/161/162 were NOT
    // parked, because parking them is a business call and not an engineering
    // one: their subject sits on the operator's investment test (support
    // existing customers, win new ones). They stayed open across several
    // sessions waiting for that call.
    //
    // The operator made it (2026-09-23, "deliver all the work required"), and
    // the evidence that makes it defensible is specific, not general: each of
    // the six is covered by an ACTIVE orchestrator whose own capability_domain
    // enumerates its work across the same IT4IT stage range —
    // release-orchestrator (AGT-ORCH-500) for §5.5, consume-orchestrator
    // (AGT-ORCH-600) for §5.6.
    //
    // So the guard now holds the QUALITY of that decision rather than blocking
    // it: each of the six must cite the orchestrator that covers it. A posture
    // parking one of these for any other reason fails here, which is what stops
    // "covered by an orchestrator" becoming a phrase anyone can paste.
    for (const id of ["AGT-150", "AGT-151", "AGT-152", "AGT-160", "AGT-161", "AGT-162"]) {
      const posture = staffingPostureFor(id);
      expect(posture, `${id} must carry a posture`).not.toBeNull();
      expect(posture!.state).toBe("deliberately-unstaffed");
      expect(
        posture!.reason,
        `${id} is parked without naming the orchestrator that covers it`,
      ).toMatch(/orchestrator \(AGT-ORCH-[0-9]+\)/);
      expect(posture!.reason).toContain("STAFFED orchestrator");
    }
  });
});
