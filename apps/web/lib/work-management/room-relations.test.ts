import { describe, expect, it } from "vitest";

import {
  WORKROOM_RELATION_KINDS,
  assertWorkroomRelation,
  containsWouldCycle,
  parseWorkroomRelation,
  WorkroomRelationError,
  type WorkroomRelation,
} from "./room-relations";

describe("work-coordination relations (BI-662254C6)", () => {
  it("round-trips each of the five vocabulary relations", () => {
    for (const relation of WORKROOM_RELATION_KINDS) {
      const parsed = parseWorkroomRelation({
        fromWorkroomId: "WC-A",
        toWorkroomId: "WC-B",
        relation,
      });
      expect(parsed).toEqual({
        fromWorkroomId: "WC-A",
        toWorkroomId: "WC-B",
        relation,
      });
    }
    expect(WORKROOM_RELATION_KINDS).toEqual([
      "contains",
      "spawned-from",
      "depends-on",
      "blocks",
      "contributes-to",
    ]);
  });

  it("rejects a contains cycle", () => {
    const existing: WorkroomRelation[] = [
      { fromWorkroomId: "WC-PARENT", toWorkroomId: "WC-CHILD", relation: "contains" },
      { fromWorkroomId: "WC-CHILD", toWorkroomId: "WC-LEAF", relation: "contains" },
    ];
    expect(containsWouldCycle(existing, "WC-LEAF", "WC-PARENT")).toBe(true);
    expect(() =>
      assertWorkroomRelation(existing, {
        fromWorkroomId: "WC-LEAF",
        toWorkroomId: "WC-PARENT",
        relation: "contains",
      }),
    ).toThrow(WorkroomRelationError);
    try {
      assertWorkroomRelation(existing, {
        fromWorkroomId: "WC-LEAF",
        toWorkroomId: "WC-PARENT",
        relation: "contains",
      });
    } catch (error) {
      expect((error as WorkroomRelationError).reason).toBe("contains_cycle");
    }
  });

  it("allows a non-cyclic contains edge and non-contains cycles", () => {
    const existing: WorkroomRelation[] = [
      { fromWorkroomId: "WC-PARENT", toWorkroomId: "WC-CHILD", relation: "contains" },
    ];
    expect(
      assertWorkroomRelation(existing, {
        fromWorkroomId: "WC-PARENT",
        toWorkroomId: "WC-OTHER",
        relation: "contains",
      }).relation,
    ).toBe("contains");
    expect(
      assertWorkroomRelation(existing, {
        fromWorkroomId: "WC-CHILD",
        toWorkroomId: "WC-PARENT",
        relation: "blocks",
      }).relation,
    ).toBe("blocks");
  });

  it("never converts a portfolio dependency into a work-coordination relation", () => {
    for (const relation of [
      "portfolio-depends-on",
      "dependsOnPortfolioRoles",
      "servesPortfolioRoles",
      "fpaw-dependency",
    ]) {
      expect(() =>
        parseWorkroomRelation({
          fromWorkroomId: "WC-A",
          toWorkroomId: "WC-B",
          relation,
        }),
      ).toThrow(WorkroomRelationError);
      try {
        parseWorkroomRelation({
          fromWorkroomId: "WC-A",
          toWorkroomId: "WC-B",
          relation,
        });
      } catch (error) {
        expect((error as WorkroomRelationError).reason).toBe("portfolio_dependency");
      }
    }
  });
});
