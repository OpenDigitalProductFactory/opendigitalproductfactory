// Tests for the graph-mirror reconciliation invariants (BI-A73954F7).
//
// Every case below is drawn from a failure that ACTUALLY REACHED A USER, not from
// imagined inputs. The classifier is pure so these run without a database; the
// counting queries are exercised against the live mirror by the runtime check.
//
// Each assertion here was verified to FAIL against a naive classifier
// (`mirrorCount === sourceCount ? "ok" : "drifted"`) before being trusted — four
// vacuous tests were caught that way earlier in this work, including one that
// asserted SQL merely "mentioned" a column and passed against broken code.

import { describe, expect, it } from "vitest";

import {
  classifyProjection,
  hasProjectionFault,
  type ProjectionReconciliation,
} from "./graph-projection-reconcile";

function row(over: Partial<ProjectionReconciliation> = {}): ProjectionReconciliation {
  return {
    projectionKey: "knowledge",
    describes: "test",
    mirrorCount: 10,
    sourceCount: 10,
    drift: 0,
    status: "ok",
    ...over,
  };
}

describe("classifyProjection", () => {
  it("reports a never-invoked projection as empty, not merely drifted", () => {
    // The exact shape of all three production failures: the source has plenty of
    // rows and the mirror has none. This MUST be distinguishable from a partial
    // projection, because it is the case that renders as an authoritative wrong
    // answer ("nothing documents this route") rather than as a stale number.
    expect(classifyProjection(0, 354)).toBe("empty");
  });

  it("does NOT report a fault when the source itself is empty", () => {
    // A fresh install with no wiki pages SHOULD have no wiki nodes. Calling that a
    // fault would make the check noisy on exactly the installs that most need a
    // signal they can trust — and a check that cries wolf is a check people disable.
    expect(classifyProjection(0, 0)).toBe("source-empty");
  });

  it("reports a partial projection as drifted", () => {
    expect(classifyProjection(180, 354)).toBe("drifted");
  });

  it("reports orphan debris left by another projection as drifted, not ok", () => {
    // The doc-impact destruction left 183 DocPage nodes in the mirror after the
    // manifest no longer accounted for them. A mirror holding MORE than its source
    // is still wrong; a naive "mirror < source" check would call this healthy.
    expect(classifyProjection(183, 0)).toBe("drifted");
  });

  it("reports a matching mirror as ok", () => {
    expect(classifyProjection(765, 765)).toBe("ok");
  });
});

describe("hasProjectionFault", () => {
  it("treats source-empty and ok as healthy", () => {
    expect(
      hasProjectionFault([row({ status: "ok" }), row({ status: "source-empty" })]),
    ).toBe(false);
  });

  it("flags a single empty domain among healthy ones", () => {
    // The live failure: code and EA were fully populated while knowledge and
    // portfolio were empty. A predicate that only looked at the aggregate, or at
    // the first row, would have reported this install as healthy.
    expect(
      hasProjectionFault([
        row({ projectionKey: "code", status: "ok" }),
        row({ projectionKey: "ea", status: "ok" }),
        row({ projectionKey: "portfolio", status: "empty", mirrorCount: 0, sourceCount: 765 }),
      ]),
    ).toBe(true);
  });

  it("flags drift", () => {
    expect(hasProjectionFault([row({ status: "drifted" })])).toBe(true);
  });
});

describe("multi-label nodes", () => {
  it("classifies each label independently rather than against a summed source", () => {
    // Measured on the live mirror 2026-08-26: Portfolio 4/4, TaxonomyNode 488/488,
    // DigitalProduct 279/279 — every label exactly right. But four nodes carry TWO
    // of those labels (labels are UNION-merged, BI-EC5FF1A0), so the distinct-node
    // count is 767 while the summed source count is 771.
    //
    // The aggregate form would therefore have reported drift = -4 forever on a
    // HEALTHY install. This pins the per-label comparison that fixes it: a check
    // that is permanently red is worse than no check, because it trains people to
    // ignore the alarm and then it cannot do its job on the day it matters.
    expect(classifyProjection(4, 4)).toBe("ok");
    expect(classifyProjection(488, 488)).toBe("ok");
    expect(classifyProjection(279, 279)).toBe("ok");

    // The summed form, for contrast — healthy data, but reported as a fault.
    expect(classifyProjection(767, 771)).toBe("drifted");
  });
});
