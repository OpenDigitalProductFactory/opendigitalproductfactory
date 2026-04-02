import { describe, it, expect } from "vitest";
import { buildDesignReviewPrompt, buildPlanReviewPrompt, buildCodeReviewPrompt, parseReviewResponse } from "./build-reviewers";

describe("buildDesignReviewPrompt", () => {
  it("includes all design doc sections", () => {
    const prompt = buildDesignReviewPrompt({
      problemStatement: "Users need filtering",
      existingFunctionalityAudit: "No existing filter",
      alternativesConsidered: "Checked open-source",
      reusePlan: "Reuse OpsClient pattern",
      newCodeJustification: "No existing filter component",
      proposedApproach: "Add checkbox filter",
      acceptanceCriteria: ["Filter hides done items", "Count shown"],
    }, "Test project");
    expect(prompt).toContain("Users need filtering");
    expect(prompt).toContain("Reuse OpsClient pattern");
    expect(prompt).toContain("Filter hides done items");
    expect(prompt).toContain("JSON FORMAT");
  });
});

describe("buildPlanReviewPrompt", () => {
  it("includes tasks and file structure", () => {
    const prompt = buildPlanReviewPrompt({
      fileStructure: [{ path: "lib/filter.ts", action: "create", purpose: "Filter logic" }],
      tasks: [{ title: "Add filter", testFirst: "test filter", implement: "write filter", verify: "run tests" }],
    });
    expect(prompt).toContain("lib/filter.ts");
    expect(prompt).toContain("Add filter");
  });
});

describe("buildCodeReviewPrompt", () => {
  it("includes task, code, and test output", () => {
    const prompt = buildCodeReviewPrompt("Add filter", "const x = 1;", "PASS 1 test");
    expect(prompt).toContain("Add filter");
    expect(prompt).toContain("const x = 1;");
    expect(prompt).toContain("PASS 1 test");
  });
});

describe("parseReviewResponse", () => {
  it("parses valid pass response", () => {
    const result = parseReviewResponse('{"decision":"pass","issues":[],"summary":"Looks good"}');
    expect(result.decision).toBe("pass");
    expect(result.issues).toHaveLength(0);
    expect(result.summary).toBe("Looks good");
  });

  it("parses valid fail response with issues", () => {
    const result = parseReviewResponse('{"decision":"fail","issues":[{"severity":"critical","description":"Missing test"}],"summary":"Needs work"}');
    expect(result.decision).toBe("fail");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe("critical");
  });

  it("handles markdown code fences", () => {
    const result = parseReviewResponse('```json\n{"decision":"pass","issues":[],"summary":"ok"}\n```');
    expect(result.decision).toBe("pass");
  });

  it("returns fail for unparseable response", () => {
    const result = parseReviewResponse("This is not JSON");
    expect(result.decision).toBe("fail");
    expect(result.issues[0].severity).toBe("critical");
  });

  it("defaults invalid severity to minor", () => {
    const result = parseReviewResponse('{"decision":"fail","issues":[{"severity":"unknown","description":"test"}],"summary":"ok"}');
    expect(result.issues[0].severity).toBe("minor");
  });
});
