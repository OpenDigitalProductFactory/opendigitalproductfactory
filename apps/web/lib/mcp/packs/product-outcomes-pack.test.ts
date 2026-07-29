import { describe, expect, it } from "vitest";
import {
  PRODUCT_OBJECTIVE_STATUSES,
  PRODUCT_OBJECTIVE_REVIEW_CADENCES,
  PRODUCT_OBJECTIVE_WORK_CONTRIBUTION_KINDS,
  PRODUCT_OUTCOME_MEASURE_KINDS,
  PRODUCT_OUTCOME_SOURCE_KINDS,
} from "@/lib/product-management/outcomes";
import { productOutcomesPack } from "./product-outcomes-pack";

function enumFor(toolName: string, property: string): string[] {
  const definition = productOutcomesPack.definitions.find(
    (candidate) => candidate.name === toolName,
  );
  const properties = definition?.inputSchema.properties as
    | Record<string, { enum?: string[] }>
    | undefined;
  return properties?.[property]?.enum ?? [];
}

describe("product outcomes MCP pack", () => {
  it("mirrors every canonical enum exactly", () => {
    expect(enumFor("create_product_objective", "measureKind")).toEqual([
      ...PRODUCT_OUTCOME_MEASURE_KINDS,
    ]);
    expect(enumFor("create_product_objective", "reviewCadence")).toEqual([
      ...PRODUCT_OBJECTIVE_REVIEW_CADENCES,
    ]);
    expect(enumFor("transition_product_objective", "to")).toEqual([
      ...PRODUCT_OBJECTIVE_STATUSES,
    ]);
    expect(enumFor("link_product_objective_work", "contributionKind")).toEqual([
      ...PRODUCT_OBJECTIVE_WORK_CONTRIBUTION_KINDS,
    ]);
    expect(enumFor("record_product_outcome_observation", "sourceKind")).toEqual([
      ...PRODUCT_OUTCOME_SOURCE_KINDS,
    ]);
  });

  it("exposes only governed lifecycle and append-only observation doors", () => {
    expect(productOutcomesPack.definitions.map((definition) => definition.name)).toEqual([
      "create_product_objective",
      "update_product_objective",
      "review_product_objective",
      "transition_product_objective",
      "link_product_objective_work",
      "record_product_outcome_observation",
      "correct_product_outcome_observation",
    ]);
    expect(
      productOutcomesPack.definitions.some((definition) =>
        /delete.*observation|update.*observation/.test(definition.name),
      ),
    ).toBe(false);
  });
});
