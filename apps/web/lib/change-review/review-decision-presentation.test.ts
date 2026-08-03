import { describe, expect, it } from "vitest";

import { semanticReviewDecisionPresentation } from "./review-decision-presentation";

describe("semantic review decision presentation", () => {
  it.each([
    ["pass", { title: "Review approved", variant: "success" }],
    ["fail", { title: "Changes requested", variant: "error" }],
    ["inconclusive", { title: "Review incomplete", variant: "warn" }],
  ] as const)("maps %s without confusing review execution with semantic judgment", (decision, expected) => {
    expect(semanticReviewDecisionPresentation(decision)).toEqual(expected);
  });
});
