import { describe, it, expect } from "vitest";
import { formatPhaseMessage, formatBuildCompleteMessage, classifyOutcome } from "./build-orchestrator";
import type { AgenticResult } from "@/lib/agentic-loop";
import type { ClaudeResult } from "./claude-dispatch";

function mockResult(overrides: Partial<AgenticResult> = {}): AgenticResult {
  return {
    content: overrides.content ?? "",
    providerId: "test",
    modelId: "test",
    downgraded: false,
    downgradeMessage: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    executedTools: overrides.executedTools ?? [],
    proposal: null,
  };
}

describe("classifyOutcome", () => {
  it("returns BLOCKED when tool errors indicate sandbox is not running", () => {
    const result = mockResult({
      content: "I tried to read the schema but encountered an error.",
      executedTools: [
        { name: "read_sandbox_file", args: { path: "schema.prisma" }, result: { success: false, error: "Sandbox not running.", message: "No sandbox." } },
      ],
    });
    expect(classifyOutcome(result, "software-engineer")).toBe("BLOCKED");
  });

  it("returns BLOCKED when sandbox slots are exhausted", () => {
    const result = mockResult({
      content: "Could not proceed.",
      executedTools: [
        { name: "describe_model", args: { model_name: "User" }, result: { success: false, error: "All sandbox slots are in use.", message: "No sandbox slots available." } },
      ],
    });
    expect(classifyOutcome(result, "data-architect")).toBe("BLOCKED");
  });

  it("returns BLOCKED when model not found and no build tools called", () => {
    const result = mockResult({
      content: "The Complaint model does not exist in the schema.",
      executedTools: [
        { name: "describe_model", args: { model_name: "Complaint" }, result: { success: false, error: "Model \"Complaint\" not found in schema.", message: "No model." } },
        { name: "read_sandbox_file", args: { path: "schema.prisma" }, result: { success: true, message: "ok" } },
      ],
    });
    expect(classifyOutcome(result, "software-engineer")).toBe("BLOCKED");
  });

  it("returns DONE_WITH_CONCERNS when prerequisite missing but build tools were called", () => {
    const result = mockResult({
      content: "Created the API routes. Note: Complaint model not found, used placeholder.",
      executedTools: [
        { name: "describe_model", args: { model_name: "Complaint" }, result: { success: false, error: "Model \"Complaint\" not found in schema.", message: "No model." } },
        { name: "generate_code", args: { instruction: "create route" }, result: { success: true, message: "ok" } },
      ],
    });
    expect(classifyOutcome(result, "software-engineer")).toBe("DONE_WITH_CONCERNS");
  });

  it("returns DONE when build tools succeed with no errors", () => {
    const result = mockResult({
      content: "Created API routes and wired imports.",
      executedTools: [
        { name: "read_sandbox_file", args: { path: "schema.prisma" }, result: { success: true, message: "ok" } },
        { name: "generate_code", args: { instruction: "create route" }, result: { success: true, message: "ok" } },
      ],
    });
    expect(classifyOutcome(result, "software-engineer")).toBe("DONE");
  });

  it("returns BLOCKED when content says cannot proceed", () => {
    const result = mockResult({
      content: "I cannot proceed because the database schema is not ready.",
      executedTools: [
        { name: "read_sandbox_file", args: { path: "schema.prisma" }, result: { success: true, message: "ok" } },
      ],
    });
    expect(classifyOutcome(result, "software-engineer")).toBe("BLOCKED");
  });

  it("returns BLOCKED when no tools called at all (stalled)", () => {
    const result = mockResult({ content: "I need to think about this." });
    expect(classifyOutcome(result, "frontend-engineer")).toBe("BLOCKED");
  });

  it("returns DONE for QA even with errors (test results are informational)", () => {
    const result = mockResult({
      content: "Typecheck passed. 8 tests pass, 2 failed.",
      executedTools: [
        { name: "run_sandbox_tests", result: { success: false, error: "2 tests failed", message: "8 pass, 2 fail" } },
      ],
    });
    expect(classifyOutcome(result, "qa-engineer")).toBe("DONE_WITH_CONCERNS");
  });
});

describe("classifyOutcome — ClaudeResult (CLI dispatch)", () => {
  function mockClaudeResult(overrides: Partial<ClaudeResult> = {}): ClaudeResult {
    return {
      content: overrides.content ?? "",
      success: overrides.success ?? true,
      executedTools: overrides.executedTools ?? [],
      durationMs: overrides.durationMs ?? 1000,
    };
  }

  it("returns DONE when Claude CLI succeeds with clean output", () => {
    const result = mockClaudeResult({ content: "Created API routes and wired imports.", success: true });
    expect(classifyOutcome(result, "software-engineer")).toBe("DONE");
  });

  it("returns DONE_WITH_CONCERNS when Claude CLI succeeds but output mentions errors", () => {
    const result = mockClaudeResult({ content: "Applied migration but got a warning about missing index.", success: true });
    expect(classifyOutcome(result, "data-architect")).toBe("DONE_WITH_CONCERNS");
  });

  it("returns BLOCKED when Claude CLI fails with timeout", () => {
    const result = mockClaudeResult({ content: "Task timed out after 600s.", success: false });
    expect(classifyOutcome(result, "frontend-engineer")).toBe("BLOCKED");
  });

  it("returns DONE_WITH_CONCERNS when Claude CLI fails but output has error details", () => {
    const result = mockClaudeResult({ content: "Typecheck failed with 3 errors.", success: false });
    expect(classifyOutcome(result, "qa-engineer")).toBe("DONE_WITH_CONCERNS");
  });

  it("returns BLOCKED when Claude CLI fails with no useful content", () => {
    const result = mockClaudeResult({ content: "Auth token expired.", success: false });
    expect(classifyOutcome(result, "software-engineer")).toBe("BLOCKED");
  });
});

describe("orchestrator communication templates", () => {
  it("formats specialist completion message", () => {
    const msg = formatPhaseMessage("data-architect", "Created Complaint model with 8 fields, 2 indexes, migration applied.");
    expect(msg).toBe("Data Architect complete: Created Complaint model with 8 fields, 2 indexes, migration applied.");
  });

  it("formats build complete message", () => {
    const msg = formatBuildCompleteMessage({
      totalTasks: 4,
      completedTasks: 4,
      failedTasks: 0,
      specialistSummaries: [
        { role: "data-architect", taskTitle: "Add Complaint model", status: "DONE", outcome: "Complaint model with 8 fields" },
        { role: "software-engineer", taskTitle: "Create API routes", status: "DONE", outcome: "4 API routes" },
        { role: "frontend-engineer", taskTitle: "Build ComplaintList page", status: "DONE", outcome: "ComplaintList page" },
        { role: "qa-engineer", taskTitle: "Run verification", status: "DONE", outcome: "12 tests pass, typecheck clean" },
      ],
    });
    expect(msg).toContain("all 4 tasks done");
    expect(msg).toContain("Ready for review");
    expect(msg).toContain("Add Complaint model");
  });

  it("formats partial failure message", () => {
    const msg = formatBuildCompleteMessage({
      totalTasks: 4,
      completedTasks: 3,
      failedTasks: 1,
      specialistSummaries: [
        { role: "data-architect", taskTitle: "Add Complaint model", status: "DONE", outcome: "Complaint model with 8 fields" },
        { role: "software-engineer", taskTitle: "Create API routes", status: "BLOCKED", outcome: "Migration not found" },
        { role: "frontend-engineer", taskTitle: "Build ComplaintList page", status: "DONE", outcome: "ComplaintList page" },
        { role: "qa-engineer", taskTitle: "Run verification", status: "DONE_WITH_CONCERNS", outcome: "8 tests pass, 4 failed" },
      ],
    });
    expect(msg).toContain("3 of 4 tasks completed");
    expect(msg).toContain("1 need review");
    expect(msg).toContain("Create API routes");
    expect(msg).not.toContain("Ready for review");
  });
});
