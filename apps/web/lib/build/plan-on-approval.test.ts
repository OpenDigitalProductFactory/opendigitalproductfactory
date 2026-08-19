import { describe, expect, it } from "vitest";

import { parsePlanJson, formatPlanReviewFeedback } from "./plan-on-approval";

const validPlan = {
  fileStructure: [{ path: "apps/web/lib/x.ts", action: "modify" }],
  tasks: [{ title: "Do the thing", files: ["apps/web/lib/x.ts"] }],
};

describe("parsePlanJson", () => {
  it("parses a bare JSON object", () => {
    const r = parsePlanJson(JSON.stringify(validPlan));
    expect(r).toEqual(validPlan);
  });

  it("parses JSON wrapped in a ```json markdown fence", () => {
    const r = parsePlanJson("```json\n" + JSON.stringify(validPlan) + "\n```");
    expect(r).toEqual(validPlan);
  });

  it("parses JSON wrapped in surrounding prose (first-brace…last-brace slice)", () => {
    const r = parsePlanJson(
      "Here is the plan you requested:\n" + JSON.stringify(validPlan) + "\nLet me know if you need changes.",
    );
    expect(r).toEqual(validPlan);
  });

  it("returns null for JSON truncated mid-array (so the caller retries)", () => {
    // Exactly the failure that silently stalled the build: unclosed tasks array.
    const truncated = '{"fileStructure":[{"path":"a.ts"}],"tasks":[{"title":"one"},{"title":"two"';
    expect(parsePlanJson(truncated)).toBeNull();
  });

  it("returns null for empty or non-JSON output", () => {
    expect(parsePlanJson("")).toBeNull();
    expect(parsePlanJson("I could not produce a plan.")).toBeNull();
  });

  it("does not treat a bare JSON array or scalar as a plan object", () => {
    // first-brace…last-brace slice must not misfire on these.
    expect(parsePlanJson("[1,2,3]")).toBeNull();
    expect(parsePlanJson("42")).toBeNull();
  });
});

describe("formatPlanReviewFeedback (BI-99B06AD1 fix-loop)", () => {
  it("returns empty string for no prior issues (round 1 = unchanged prompt)", () => {
    expect(formatPlanReviewFeedback([])).toBe("");
  });

  it("renders a REVISION instruction listing each blocking issue", () => {
    const out = formatPlanReviewFeedback([
      { severity: "critical", description: "Task 3 combines two file edits" },
      { severity: "important", description: "No test-first step for the migration" },
    ]);
    expect(out).toMatch(/REVISION/);
    expect(out).toMatch(/MUST resolve every one/i);
    expect(out).toContain("[critical] Task 3 combines two file edits");
    expect(out).toContain("[important] No test-first step for the migration");
  });

  it("caps the fed-back issues at 20 to bound prompt growth", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ severity: "minor", description: `issue ${i}` }));
    const out = formatPlanReviewFeedback(many);
    expect(out).toContain("issue 0");
    expect(out).toContain("issue 19");
    expect(out).not.toContain("issue 20");
  });
});
