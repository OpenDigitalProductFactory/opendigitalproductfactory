import { describe, expect, it } from "vitest";
import { readReviewHistory, finishReviewIteration, assembleReviewPanel } from "./review-history";

const finding = { severity: "critical" as const, description: "The callback omits authorization." };
const pass = { decision: "pass" as const, issues: [], summary: "Reviewed." };

describe("review history across unavailable reviewers", () => {
  it("does not feed legacy infrastructure errors back as document findings", () => {
    expect(readReviewHistory({ reviewIncomplete: true, iteration: { round: 117 }, issues: [
      { severity: "critical", description: "Both review agents failed to respond" },
    ] }).issues).toEqual([]);
  });
  it("preserves genuine findings and the completed round across repeated outages", () => {
    const prior = { decision: "fail" as const, issues: [finding], summary: "Fix callback", iteration: { round: 2 } };
    const outage = assembleReviewPanel(null, null);
    const first = finishReviewIteration(outage, readReviewHistory(prior));
    const second = finishReviewIteration(outage, readReviewHistory(first));
    expect(second.iteration?.round).toBe(2);
    expect(second.issues).toEqual([]);
    expect(readReviewHistory(second).issues).toEqual([finding]);
    const recovered = finishReviewIteration(pass, readReviewHistory(second));
    expect(recovered.iteration).toMatchObject({ round: 3, prior: { addressed: 1 } });
  });
  it("cannot pass a partial panel or turn transport failure into a critical finding", () => {
    expect(assembleReviewPanel(pass, null)).toMatchObject({ decision: "fail", reviewIncomplete: true, usableReviewerCount: 1, issues: [] });
    expect(assembleReviewPanel(null, null).issues).toEqual([]);
    expect(assembleReviewPanel(pass, { decision: "inconclusive", issues: [], summary: "Capacity unavailable" }).reviewIncomplete).toBe(true);
  });
  it("keeps real findings from an available reviewer and accepts a full panel", () => {
    expect(assembleReviewPanel({ decision: "fail", issues: [finding], summary: "Fix callback" }, null).issues).toEqual([finding]);
    expect(assembleReviewPanel(pass, pass)).toMatchObject({ decision: "pass", usableReviewerCount: 2 });
  });
});
