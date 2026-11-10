import { describe, expect, it } from "vitest";

import { itemBodyBaselineState, parseItemBodyAcceptance } from "./item-body-baseline";

describe("the item body as the small/medium objective baseline", () => {
  it("reads bullets under an Acceptance heading", () => {
    const body = "## Problem\nSlow.\n\n## Acceptance criteria\n- p95 under 300ms on the live install\n- no new table\n\n## Notes\n- not a criterion";
    const parsed = parseItemBodyAcceptance(body);
    expect(parsed.criteria).toEqual(["p95 under 300ms on the live install", "no new table"]);
    expect(parsed.anchors).toEqual([5, 6]);
    expect(itemBodyBaselineState(body)).toBe("pass");
  });

  it("reads marked bullets anywhere in the body", () => {
    const body = "Context.\n1. AC-1: the claim refuses without a shape\n- **AC-PICK-LIST** the refusal carries five shapes\n- Acceptance: derived shape is recorded";
    expect(parseItemBodyAcceptance(body).criteria).toEqual([
      "the claim refuses without a shape", "the refusal carries five shapes", "derived shape is recorded",
    ]);
  });

  it("does not mistake prose about acceptance for a criterion", () => {
    expect(itemBodyBaselineState("We should define acceptance later.")).toBe("missing");
    expect(itemBodyBaselineState(null)).toBe("missing");
    expect(itemBodyBaselineState("## Acceptance\nnothing listed yet")).toBe("missing");
  });
});
