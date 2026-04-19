import { describe, it, expect } from "vitest";
import { buildDesignReviewPrompt, buildPlanReviewPrompt, buildCodeReviewPrompt, parseReviewResponse } from "./build-reviewers";

describe("buildDesignReviewPrompt", () => {
  it("includes all design doc sections", () => {
    const prompt = buildDesignReviewPrompt({
      problemStatement: "Users need filtering",
      existingCodeAudit: "No existing filter",
      reusePlan: "Reuse OpsClient pattern",
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

  it("includes comprehensive review instruction to prevent whack-a-mole feedback", () => {
    const prompt = buildPlanReviewPrompt({
      fileStructure: [],
      tasks: [{ title: "Task 1", testFirst: "t", implement: "i", verify: "v" }],
    });
    expect(prompt).toContain("MUST report ALL issues in a SINGLE response");
    expect(prompt).toContain("ZERO surprise issues on a re-review");
  });

  it("includes task count for reviewer context", () => {
    const prompt = buildPlanReviewPrompt({
      fileStructure: [],
      tasks: [
        { title: "T1", testFirst: "t", implement: "i", verify: "v" },
        { title: "T2", testFirst: "t", implement: "i", verify: "v" },
        { title: "T3", testFirst: "t", implement: "i", verify: "v" },
      ],
    });
    expect(prompt).toContain("TASKS (3 total)");
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

  it("overrides reviewer's 'fail' decision when only important/minor issues exist", () => {
    // Matches the real-world loop: reviewer lists 2 important issues and
    // decides fail, which contradicts its own severity calibration
    // ("important doesn't block implementation"). Severity-driven logic
    // returns pass because no critical issues exist — issues are still
    // surfaced for the author to address.
    const result = parseReviewResponse(JSON.stringify({
      decision: "fail",
      issues: [
        { severity: "important", description: "Race condition edge case" },
        { severity: "important", description: "Missing alternatives note" },
      ],
      summary: "Reviewer 2: state-consistency safeguards needed",
    }));
    expect(result.decision).toBe("pass");
    expect(result.issues).toHaveLength(2);
  });

  it("still fails when any issue is critical, regardless of reviewer's decision field", () => {
    const result = parseReviewResponse(JSON.stringify({
      decision: "pass",
      issues: [
        { severity: "critical", description: "Auth bypass" },
        { severity: "minor", description: "Naming nit" },
      ],
      summary: "technically fine but",
    }));
    expect(result.decision).toBe("fail");
    expect(result.issues).toHaveLength(2);
  });
});
