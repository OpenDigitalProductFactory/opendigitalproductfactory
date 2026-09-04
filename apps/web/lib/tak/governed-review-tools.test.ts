// BI-3907AF35 — a governed review must earn the review-phase budget.

import { describe, expect, it } from "vitest";

import { usesGovernedReviewTools } from "./governed-review-tools";

describe("usesGovernedReviewTools", () => {
  it("recognises the governed writers", () => {
    for (const name of [
      "record_initiative_design_review",
      "record_initiative_architecture_review",
      "record_initiative_evidence",
    ]) {
      expect(usesGovernedReviewTools([{ name }])).toBe(true);
    }
  });

  // The live failure: the reviewer spent its whole budget on the immutable
  // reader and never reached a writer, so keying only on writers would raise
  // the ceiling only after it had already timed out.
  it("recognises the immutable reader the reviewer spends its budget on", () => {
    expect(usesGovernedReviewTools([{ name: "read_source_at_version" }])).toBe(true);
  });

  it("leaves an ordinary conversational turn on the conversation baseline", () => {
    expect(usesGovernedReviewTools([{ name: "wiki_query" }, { name: "get_backlog_item" }])).toBe(false);
    expect(usesGovernedReviewTools([])).toBe(false);
  });
});
