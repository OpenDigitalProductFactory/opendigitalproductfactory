// BI-15E1D4CA (live, 2026-09-24): FB-1FAAA146's plan review came back from codex as prose on
// both reviewers ("missing-json", "invalid-json"). Each parsed to an
// "inconclusive" parse failure, mergeReviews fell through to its last branch —
// "neither said fail, so pass" — and the build advanced into build on a plan no
// reviewer had read. Two unreadable reviews are not a review.
import { describe, expect, it } from "vitest";

import { mergeReviews, parseReviewResponse } from "./build-reviewers";

const readable = (decision: "pass" | "fail") =>
  parseReviewResponse(JSON.stringify({
    decision,
    issues: decision === "fail" ? [{ severity: "critical", description: "Task 3 has no file." }] : [],
    summary: decision === "fail" ? "Plan misses a file." : "Plan is sound.",
  }));

describe("mergeReviews when a reviewer's response cannot be read", () => {
  it("does not pass a plan when neither reviewer produced a readable verdict", () => {
    const merged = mergeReviews(
      parseReviewResponse("I reviewed the plan and it looks mostly fine overall."),
      parseReviewResponse("{ decision: pass, this is not json"),
    );
    expect(merged.decision).toBe("fail");
    expect(merged.reviewIncomplete).toBe(true);
    expect(merged.issues[0]?.description).toMatch(/no reviewer produced a readable verdict/i);
  });

  it("still takes the readable reviewer's verdict when only one could not be read", () => {
    const unreadable = parseReviewResponse("prose only");
    expect(mergeReviews(unreadable, readable("pass")).decision).toBe("pass");
    expect(mergeReviews(readable("fail"), unreadable).decision).toBe("fail");
    expect(mergeReviews(unreadable, readable("pass")).reviewIncomplete).toBeUndefined();
  });

  it("keeps the two-reader rule unchanged", () => {
    expect(mergeReviews(readable("pass"), readable("pass")).decision).toBe("pass");
    expect(mergeReviews(readable("pass"), readable("fail")).decision).toBe("fail");
  });
});
