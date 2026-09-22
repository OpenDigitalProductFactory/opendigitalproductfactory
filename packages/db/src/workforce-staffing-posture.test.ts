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

  it("leaves the customer-facing roles unparked, deliberately", () => {
    // AGT-150/151/152 and AGT-160/161/162 sit on the two objectives the operator
    // funds against. Parking them is an operator decision, not an engineering
    // one, so they keep reporting as open gaps until someone decides.
    for (const id of ["AGT-150", "AGT-151", "AGT-152", "AGT-160", "AGT-161", "AGT-162"]) {
      expect(staffingPostureFor(id), `${id} is customer-facing and must not be parked here`).toBeNull();
    }
  });
});
