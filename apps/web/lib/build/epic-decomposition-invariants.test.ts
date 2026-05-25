// apps/web/lib/build/epic-decomposition-invariants.test.ts
//
// Coverage for Phase 1 substrate invariants.
// Spec: docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md
// BI: BI-2E6CC391.

import { describe, expect, it } from "vitest";

import {
  DecompositionInvariantError,
  assertChildDesignReviewTransitive,
  assertChildOrderWellFormed,
  assertDependencyEdgeWellFormed,
  assertEpicHasContractIfDecomposed,
  assertNoCycle,
  assertNoRecursiveDecomposition,
} from "./epic-decomposition-invariants";

function expectInvariantError(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error(`expected DecompositionInvariantError(${code}) but no error was thrown`);
  } catch (err) {
    if (!(err instanceof DecompositionInvariantError)) {
      throw err;
    }
    expect(err.code).toBe(code);
  }
}

describe("assertEpicHasContractIfDecomposed", () => {
  it("passes when Epic has no FeatureBuild children (portfolio-organizational use)", () => {
    expect(() =>
      assertEpicHasContractIfDecomposed({ designDoc: null, featureBuilds: [] }),
    ).not.toThrow();
  });

  it("passes when Epic has children AND a designDoc (execution-organizational use)", () => {
    expect(() =>
      assertEpicHasContractIfDecomposed({
        designDoc: { sections: [] },
        featureBuilds: [{}, {}, {}],
      }),
    ).not.toThrow();
  });

  it("throws when Epic has children but no designDoc", () => {
    expectInvariantError(
      () =>
        assertEpicHasContractIfDecomposed({
          designDoc: null,
          featureBuilds: [{}],
        }),
      "epic-without-contract",
    );
  });

  it("treats undefined featureBuilds as no children", () => {
    expect(() =>
      assertEpicHasContractIfDecomposed({ designDoc: null }),
    ).not.toThrow();
  });
});

describe("assertChildDesignReviewTransitive", () => {
  const parent = { id: "epic-1", designReview: { passed: true, summary: "ok" } };

  it("passes for top-level builds (no parentEpicId)", () => {
    expect(() =>
      assertChildDesignReviewTransitive(
        { parentEpicId: null, designReview: null },
        parent,
      ),
    ).not.toThrow();
  });

  it("passes when child's designReview matches parent's exactly", () => {
    expect(() =>
      assertChildDesignReviewTransitive(
        { parentEpicId: "epic-1", designReview: { passed: true, summary: "ok" } },
        parent,
      ),
    ).not.toThrow();
  });

  it("passes when child's designReview is a structurally equal object", () => {
    expect(() =>
      assertChildDesignReviewTransitive(
        {
          parentEpicId: "epic-1",
          designReview: { summary: "ok", passed: true }, // key order differs
        },
        { id: "epic-1", designReview: { passed: true, summary: "ok" } },
      ),
    ).not.toThrow();
  });

  it("throws when child's parentEpicId does not match parent argument id", () => {
    expectInvariantError(
      () =>
        assertChildDesignReviewTransitive(
          { parentEpicId: "epic-OTHER", designReview: parent.designReview },
          parent,
        ),
      "child-parent-mismatch",
    );
  });

  it("throws when child's designReview diverges from parent's", () => {
    expectInvariantError(
      () =>
        assertChildDesignReviewTransitive(
          { parentEpicId: "epic-1", designReview: { passed: false } },
          parent,
        ),
      "child-review-divergence",
    );
  });

  it("throws when parent has a review but child has null", () => {
    expectInvariantError(
      () =>
        assertChildDesignReviewTransitive(
          { parentEpicId: "epic-1", designReview: null },
          parent,
        ),
      "child-review-divergence",
    );
  });
});

describe("assertDependencyEdgeWellFormed", () => {
  const dependent = { id: "FB-2", parentEpicId: "epic-1" };
  const dependsOn = { id: "FB-1", parentEpicId: "epic-1" };

  it("passes for a well-formed in-Epic edge", () => {
    expect(() =>
      assertDependencyEdgeWellFormed({ dependent, dependsOn, parentEpicId: "epic-1" }),
    ).not.toThrow();
  });

  it("throws on self-dependency", () => {
    expectInvariantError(
      () =>
        assertDependencyEdgeWellFormed({
          dependent: { id: "FB-1", parentEpicId: "epic-1" },
          dependsOn: { id: "FB-1", parentEpicId: "epic-1" },
          parentEpicId: "epic-1",
        }),
      "self-dependency",
    );
  });

  it("throws when dependent's parentEpicId differs from edge parentEpicId", () => {
    expectInvariantError(
      () =>
        assertDependencyEdgeWellFormed({
          dependent: { id: "FB-2", parentEpicId: "epic-OTHER" },
          dependsOn,
          parentEpicId: "epic-1",
        }),
      "cross-epic-dependent",
    );
  });

  it("throws when dependsOn's parentEpicId differs from edge parentEpicId", () => {
    expectInvariantError(
      () =>
        assertDependencyEdgeWellFormed({
          dependent,
          dependsOn: { id: "FB-1", parentEpicId: "epic-OTHER" },
          parentEpicId: "epic-1",
        }),
      "cross-epic-dependson",
    );
  });

  it("throws when dependent has null parentEpicId (top-level build)", () => {
    expectInvariantError(
      () =>
        assertDependencyEdgeWellFormed({
          dependent: { id: "FB-2", parentEpicId: null },
          dependsOn,
          parentEpicId: "epic-1",
        }),
      "cross-epic-dependent",
    );
  });
});

describe("assertNoCycle", () => {
  it("passes on an empty graph with a single new edge", () => {
    expect(() =>
      assertNoCycle({
        existingEdges: [],
        newEdge: { dependentBuildId: "FB-2", dependsOnBuildId: "FB-1" },
      }),
    ).not.toThrow();
  });

  it("passes on a linear chain (Dale scenario: 3 builds, 2 edges)", () => {
    // FB-3 -> FB-2 -> FB-1 (Low-stock depends on Record-usage depends on Read)
    expect(() =>
      assertNoCycle({
        existingEdges: [{ dependentBuildId: "FB-2", dependsOnBuildId: "FB-1" }],
        newEdge: { dependentBuildId: "FB-3", dependsOnBuildId: "FB-2" },
      }),
    ).not.toThrow();
  });

  it("passes when adding an edge with a build that already exists in the graph", () => {
    expect(() =>
      assertNoCycle({
        existingEdges: [{ dependentBuildId: "FB-2", dependsOnBuildId: "FB-1" }],
        newEdge: { dependentBuildId: "FB-3", dependsOnBuildId: "FB-1" }, // 3 also depends on 1, no cycle
      }),
    ).not.toThrow();
  });

  it("throws on a direct two-node cycle", () => {
    expectInvariantError(
      () =>
        assertNoCycle({
          existingEdges: [{ dependentBuildId: "FB-1", dependsOnBuildId: "FB-2" }],
          newEdge: { dependentBuildId: "FB-2", dependsOnBuildId: "FB-1" },
        }),
      "dependency-cycle",
    );
  });

  it("throws on a three-node cycle (FB-3 -> FB-1 -> FB-2 -> FB-3)", () => {
    expectInvariantError(
      () =>
        assertNoCycle({
          existingEdges: [
            { dependentBuildId: "FB-3", dependsOnBuildId: "FB-1" },
            { dependentBuildId: "FB-1", dependsOnBuildId: "FB-2" },
          ],
          newEdge: { dependentBuildId: "FB-2", dependsOnBuildId: "FB-3" },
        }),
      "dependency-cycle",
    );
  });
});

describe("assertNoRecursiveDecomposition", () => {
  it("passes for a top-level FeatureBuild (no parentEpicId)", () => {
    expect(() =>
      assertNoRecursiveDecomposition({ id: "FB-TOP", parentEpicId: null }),
    ).not.toThrow();
  });

  it("throws when originating build is itself a child", () => {
    expectInvariantError(
      () =>
        assertNoRecursiveDecomposition({ id: "FB-CHILD", parentEpicId: "epic-1" }),
      "recursive-decomposition",
    );
  });
});

describe("assertChildOrderWellFormed", () => {
  it("passes when parentEpicId is null and childOrder is null (top-level build)", () => {
    expect(() =>
      assertChildOrderWellFormed({ parentEpicId: null, childOrder: null }),
    ).not.toThrow();
  });

  it("passes when parentEpicId is set and childOrder is a positive integer", () => {
    for (const order of [1, 2, 3, 42]) {
      expect(() =>
        assertChildOrderWellFormed({ parentEpicId: "epic-1", childOrder: order }),
      ).not.toThrow();
    }
  });

  it("throws when parentEpicId is null but childOrder is set", () => {
    expectInvariantError(
      () =>
        assertChildOrderWellFormed({ parentEpicId: null, childOrder: 1 }),
      "invalid-child-order",
    );
  });

  it("throws when parentEpicId is set but childOrder is null", () => {
    expectInvariantError(
      () =>
        assertChildOrderWellFormed({ parentEpicId: "epic-1", childOrder: null }),
      "invalid-child-order",
    );
  });

  it("throws on childOrder = 0 (must be 1-indexed)", () => {
    expectInvariantError(
      () =>
        assertChildOrderWellFormed({ parentEpicId: "epic-1", childOrder: 0 }),
      "invalid-child-order",
    );
  });

  it("throws on negative childOrder", () => {
    expectInvariantError(
      () =>
        assertChildOrderWellFormed({ parentEpicId: "epic-1", childOrder: -3 }),
      "invalid-child-order",
    );
  });

  it("throws on non-integer childOrder", () => {
    expectInvariantError(
      () =>
        assertChildOrderWellFormed({ parentEpicId: "epic-1", childOrder: 1.5 }),
      "invalid-child-order",
    );
  });
});

describe("Dale composite scenario (end-to-end fixture)", () => {
  // Mirror of §3.2 of the spec: 1 Epic + 3 children + 2 dependency edges.
  // The full set of invariant assertions should pass; this is the bar
  // declared in spec §13 ("data model can represent one active Epic with
  // three child FeatureBuilds and normalized dependency edges").

  const parentEpic = {
    id: "epic-truck-inventory",
    designDoc: { title: "Truck inventory", sections: ["read", "usage", "low-stock"] },
    designReview: { passed: true, summary: "Truck inventory design approved" },
  };

  const childRead = {
    id: "FB-READ",
    parentEpicId: "epic-truck-inventory",
    childOrder: 1,
    designReview: parentEpic.designReview,
  };
  const childUsage = {
    id: "FB-USAGE",
    parentEpicId: "epic-truck-inventory",
    childOrder: 2,
    designReview: parentEpic.designReview,
  };
  const childLowStock = {
    id: "FB-LOWSTOCK",
    parentEpicId: "epic-truck-inventory",
    childOrder: 3,
    designReview: parentEpic.designReview,
  };

  it("all six invariants pass for the well-formed Dale scenario", () => {
    expect(() =>
      assertEpicHasContractIfDecomposed({
        designDoc: parentEpic.designDoc,
        featureBuilds: [childRead, childUsage, childLowStock],
      }),
    ).not.toThrow();

    for (const child of [childRead, childUsage, childLowStock]) {
      expect(() =>
        assertChildDesignReviewTransitive(child, parentEpic),
      ).not.toThrow();
      expect(() => assertChildOrderWellFormed(child)).not.toThrow();
    }
    // assertNoRecursiveDecomposition deliberately NOT called for children
    // here — it fires only when a child build is the proposed originator
    // for a NEW Epic, not for plain existence checks. See its dedicated
    // describe block above for that path.
  });

  it("dependency edges FB-USAGE -> FB-READ and FB-LOWSTOCK -> FB-USAGE are well-formed and acyclic", () => {
    expect(() =>
      assertDependencyEdgeWellFormed({
        dependent: childUsage,
        dependsOn: childRead,
        parentEpicId: parentEpic.id,
      }),
    ).not.toThrow();

    expect(() =>
      assertDependencyEdgeWellFormed({
        dependent: childLowStock,
        dependsOn: childUsage,
        parentEpicId: parentEpic.id,
      }),
    ).not.toThrow();

    expect(() =>
      assertNoCycle({
        existingEdges: [
          { dependentBuildId: "FB-USAGE", dependsOnBuildId: "FB-READ" },
        ],
        newEdge: { dependentBuildId: "FB-LOWSTOCK", dependsOnBuildId: "FB-USAGE" },
      }),
    ).not.toThrow();
  });
});
