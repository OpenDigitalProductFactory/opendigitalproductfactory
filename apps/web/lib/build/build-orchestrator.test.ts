import { describe, it, expect } from "vitest";
import { formatPhaseMessage, formatBuildCompleteMessage, classifyOutcome, getCompletedTaskTitles, buildStoredResultsSummary, buildScopedTaskContext, buildTaskArtifactEntry, buildTaskArtifactSummary, parseQAVerification, resolveBuildProviderRunner } from "./build-orchestrator";
import { isMissingSandboxToolSurfaceOutput } from "./sandbox-tool-surface-detector";
import type { StoredTaskResult } from "./build-orchestrator";
import type { AgenticResult } from "@/lib/agentic-loop";
import type { ClaudeResult } from "./claude-dispatch";
import type { CodexResult } from "./codex-dispatch";
import type { BuildPlanDoc } from "@/lib/feature-build-types";
import type { AssignedTask } from "./task-dependency-graph";

describe("resolveBuildProviderRunner", () => {
  it("defaults to local-docker x codex", () => {
    const { provider, runner } = resolveBuildProviderRunner({});
    expect(provider.id).toBe("local-docker");
    expect(runner.id).toBe("codex");
  });

  it("resolves local-docker x claude", () => {
    const { provider, runner } = resolveBuildProviderRunner({ agentId: "claude", providerId: "local-docker" });
    expect(provider.id).toBe("local-docker");
    expect(runner.id).toBe("claude");
  });

  it("rejects unimplemented providers before dispatch", () => {
    expect(() => resolveBuildProviderRunner({ providerId: "cloud-run-job" })).toThrow(/not implemented/i);
  });
});

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

  it("returns DONE_WITH_CONCERNS when CLI content contains numeric test failure count ('2 failed')", () => {
    const result = mockResult({
      content: "Typecheck passed. 8 tests pass, 2 failed.",
      executedTools: [
        { name: "run_sandbox_tests", result: { success: false, error: "2 tests failed", message: "8 pass, 2 fail" } },
      ],
    });
    expect(classifyOutcome(result, "qa-engineer")).toBe("DONE_WITH_CONCERNS");
  });

  // Regression: tasks whose subject matter is failure handling (e.g. "Queue failure path",
  // "UI history and failure details") should not be classified as DONE_WITH_CONCERNS
  // just because the QA summary naturally uses the word "failure" or "failed" in a
  // narrative description of correct behavior.  The plain /\bfailed\b/ pattern caused
  // false positives; we now require a numeric count ("2 failed") instead.
  it("returns DONE when CLI dispatch result describes failure-handling code correctly (no numeric failure count)", () => {
    // ClaudeResult (has durationMs, no providerId) → CLI dispatch path
    const result = {
      content: "The failure path correctly catches errors and marks the run as failed. All failure-handling tests verify the expected behavior.",
      success: true,
      executedTools: [],
      durationMs: 1000,
    };
    expect(classifyOutcome(result, "qa-engineer")).toBe("DONE");
  });

  it("returns DONE_WITH_CONCERNS when CLI dispatch result has 'error:' prefix diagnostic", () => {
    const result = {
      content: "error: Cannot find module '@/lib/foo'",
      success: true,
      executedTools: [],
      durationMs: 500,
    };
    expect(classifyOutcome(result, "software-engineer")).toBe("DONE_WITH_CONCERNS");
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

  it("returns DONE when Claude CLI succeeds with incidental mention of warning", () => {
    // "got a warning about" is narrative, not a compiler/tool warning indicator
    const result = mockClaudeResult({ content: "Applied migration but got a warning about missing index.", success: true });
    expect(classifyOutcome(result, "data-architect")).toBe("DONE");
  });

  it("returns DONE_WITH_CONCERNS when Claude CLI succeeds but output has structured warnings", () => {
    const result = mockClaudeResult({ content: "Applied migration. warning: missing index on userId column.", success: true });
    expect(classifyOutcome(result, "data-architect")).toBe("DONE_WITH_CONCERNS");
  });

  it("returns BLOCKED when Claude CLI fails with timeout", () => {
    const result = mockClaudeResult({ content: "Task timed out after 600s.", success: false });
    expect(classifyOutcome(result, "frontend-engineer")).toBe("BLOCKED");
  });

  it("returns BLOCKED when Claude CLI fails even if output includes error details", () => {
    const result = mockClaudeResult({ content: "Typecheck failed with 3 errors.", success: false });
    expect(classifyOutcome(result, "qa-engineer")).toBe("BLOCKED");
  });

  it("returns BLOCKED when Claude CLI fails with no useful content", () => {
    const result = mockClaudeResult({ content: "Auth token expired.", success: false });
    expect(classifyOutcome(result, "software-engineer")).toBe("BLOCKED");
  });

  it("returns BLOCKED when the CLI reports the Build Studio sandbox tool set is not exposed", () => {
    const result = mockClaudeResult({
      content:
        "the sandbox tool set this build workflow requires (start_build, read_sandbox_file, edit_sandbox_file, write_sandbox_file, search_sandbox, run_sandbox_command, run_sandbox_tests, describe_model, validate_schema, save_phase_handoff, saveBuildEvidence) is not exposed on this session, so I cannot create the build branch or touch sandbox files.",
      success: true,
    });
    expect(isMissingSandboxToolSurfaceOutput(result.content)).toBe(true);
    expect(classifyOutcome(result, "software-engineer")).toBe("BLOCKED");
  });

  it("does not confuse ordinary sandbox test failures with missing tool-surface reports", () => {
    const result = mockClaudeResult({
      content: "run_sandbox_tests reported 2 tests failed after the implementation changed the API response shape.",
      success: true,
    });
    expect(isMissingSandboxToolSurfaceOutput(result.content)).toBe(false);
    expect(classifyOutcome(result, "qa-engineer")).toBe("DONE_WITH_CONCERNS");
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
    expect(msg).toContain("Status: ready for review");
    expect(msg).toContain("Evidence: 4/4 tasks completed");
    expect(msg).toContain("Next action: run the review phase");
    expect(msg).toContain("Owner: Build Studio review agent");
    expect(msg).toContain("Add Complaint model");
    expect(msg).not.toContain("Ready for review?");
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
    expect(msg).toContain("Status: not ready for review");
    expect(msg).toContain("Owner: Build Studio build agent");
    expect(msg).not.toContain("Ready for review?");
  });
});

// ─── Task Resume Logic ─────────────────────────────────────────────────────

describe("getCompletedTaskTitles", () => {
  it("returns empty set for null/undefined input", () => {
    expect(getCompletedTaskTitles(null)).toEqual(new Set());
    expect(getCompletedTaskTitles(undefined)).toEqual(new Set());
    expect(getCompletedTaskTitles([])).toEqual(new Set());
  });

  it("includes DONE and DONE_WITH_CONCERNS tasks", () => {
    const tasks: StoredTaskResult[] = [
      { title: "Add Complaint model", specialist: "data-architect", outcome: "DONE" },
      { title: "Create API routes", specialist: "software-engineer", outcome: "DONE_WITH_CONCERNS" },
      { title: "Build UI page", specialist: "frontend-engineer", outcome: "BLOCKED" },
      { title: "Run verification", specialist: "qa-engineer", outcome: "NEEDS_CONTEXT" },
    ];
    const completed = getCompletedTaskTitles(tasks);
    expect(completed.size).toBe(2);
    expect(completed.has("Add Complaint model")).toBe(true);
    expect(completed.has("Create API routes")).toBe(true);
    expect(completed.has("Build UI page")).toBe(false);
    expect(completed.has("Run verification")).toBe(false);
  });

  it("handles all tasks completed", () => {
    const tasks: StoredTaskResult[] = [
      { title: "Task A", specialist: "data-architect", outcome: "DONE" },
      { title: "Task B", specialist: "software-engineer", outcome: "DONE" },
    ];
    const completed = getCompletedTaskTitles(tasks);
    expect(completed.size).toBe(2);
  });

  it("handles all tasks failed/blocked", () => {
    const tasks: StoredTaskResult[] = [
      { title: "Task A", specialist: "data-architect", outcome: "BLOCKED" },
      { title: "Task B", specialist: "software-engineer", outcome: "NEEDS_CONTEXT" },
    ];
    const completed = getCompletedTaskTitles(tasks);
    expect(completed.size).toBe(0);
  });
});

describe("buildStoredResultsSummary", () => {
  it("returns empty string for null/undefined input", () => {
    expect(buildStoredResultsSummary(null)).toBe("");
    expect(buildStoredResultsSummary(undefined)).toBe("");
    expect(buildStoredResultsSummary([])).toBe("");
  });

  it("includes only completed tasks in summary", () => {
    const tasks: StoredTaskResult[] = [
      { title: "Add model", specialist: "data-architect", outcome: "DONE" },
      { title: "Build UI", specialist: "frontend-engineer", outcome: "BLOCKED" },
      { title: "Create API", specialist: "software-engineer", outcome: "DONE_WITH_CONCERNS" },
    ];
    const summary = buildStoredResultsSummary(tasks);
    expect(summary).toContain("data-architect [DONE] (Add model)");
    expect(summary).toContain("software-engineer [DONE_WITH_CONCERNS] (Create API)");
    expect(summary).not.toContain("Build UI");
    expect(summary).not.toContain("BLOCKED");
  });

  it("includes 'completed in prior run' marker", () => {
    const tasks: StoredTaskResult[] = [
      { title: "Task A", specialist: "data-architect", outcome: "DONE" },
    ];
    const summary = buildStoredResultsSummary(tasks);
    expect(summary).toContain("completed in prior run");
  });
});

describe("task-scoped Build Studio context", () => {
  function makeTask(index: number, implement = "Implement the scoped context guard."): AssignedTask {
    return {
      taskIndex: index,
      title: `Task ${index}`,
      specialist: "software-engineer",
      files: [
        {
          path: `apps/web/lib/example-${index}.ts`,
          action: "modify",
          purpose: `Task ${index} target`,
        },
      ],
      task: {
        title: `Task ${index}`,
        testFirst: "Write a focused regression test first.",
        implement,
        verify: "pnpm --filter web exec vitest run lib/integrate/build-orchestrator.test.ts",
      },
    };
  }

  it("compresses prior task output to bounded artifact entries", () => {
    const rawOutput = `Changed files and ran tests.\nRAW_HISTORY_SENTINEL ${"x".repeat(20_000)}`;
    const entry = buildTaskArtifactEntry({
      task: makeTask(1),
      outcome: "DONE",
      content: rawOutput,
      durationMs: 1234,
    });

    expect(entry.title).toBe("Task 1");
    expect(entry.files).toEqual(["apps/web/lib/example-1.ts"]);
    expect(entry.summary.length).toBeLessThanOrEqual(320);
    expect(entry.summary).not.toContain("RAW_HISTORY_SENTINEL");
  });

  it("keeps task 16 scoped context under 8K after fifteen large prior results", () => {
    const artifactEntries = Array.from({ length: 15 }, (_, idx) =>
      buildTaskArtifactEntry({
        task: makeTask(idx + 1),
        outcome: "DONE",
        content: `Task ${idx + 1} completed.\n${"raw turn detail ".repeat(800)}`,
        durationMs: 1000 + idx,
      }),
    );
    const plan: BuildPlanDoc = {
      fileStructure: Array.from({ length: 16 }, (_, idx) => ({
        path: `apps/web/lib/example-${idx + 1}.ts`,
        action: "modify",
        purpose: `Task ${idx + 1} target`,
      })),
      tasks: Array.from({ length: 16 }, (_, idx) => makeTask(idx + 1).task),
    };
    const rawLifecycleThread = `FULL_LIFECYCLE_THREAD ${"conversation ".repeat(12_000)}`;
    const artifactSummary = buildTaskArtifactSummary(artifactEntries);

    const scoped = buildScopedTaskContext({
      buildId: "FB-SCOPED",
      task: makeTask(16, "Implement the sixteenth task without reading raw lifecycle history."),
      plan,
      artifactSummary,
      rawBuildContext: rawLifecycleThread,
    });

    expect(scoped.length).toBeLessThanOrEqual(8000);
    expect(scoped).toContain("Task 16");
    expect(scoped).toContain("Artifact Summary");
    expect(scoped).toContain("apps/web/lib/example-16.ts");
    expect(scoped).not.toContain("FULL_LIFECYCLE_THREAD");
    expect(scoped).not.toContain("conversation conversation conversation");
  });

  // Pinned acceptance gaps from the rev 4 thread-management design (§13).
  // Each it.todo names the criterion it will become a regression test for once
  // the corresponding fast-follow lands. Replacing the todo with a real
  // assertion is the explicit Definition of Done for that follow-up.
  it.todo("C3 — decisions slot survives LRU eviction with 20 completed tasks (lands FF-PR-1: decisions ledger wired to DecisionInteraction)");
  it.todo("C4 — file shapes (exported symbols) for files written by prior tasks appear in scoped context without re-Read (lands BI-FOLLOWUP-SIGNATURE-EXTRACT)");
  it.todo("C5 — BLOCKED-task retry receives prior attempt's failure context in scoped dispatch (lands FF-PR-3)");
  it.todo("C7 — taskResults.decisions[] contains only interactionId references, never duplicated rationale/confidence fields (lands FF-PR-1; prohibition test)");
  it.todo("C8 — scoped context slot order is stable-prefix-first to maximize prompt cache hit rate (lands FF-PR-1; snapshot or position assertion)");
});

// ─── QA Verification Parsing ─────────────────────────────────────────────

describe("parseQAVerification", () => {
  it("parses standard format: 'Typecheck: pass' + '12 tests pass, 0 fail'", () => {
    const result = parseQAVerification("Typecheck: pass\n12 tests pass, 0 fail");
    expect(result).toEqual({
      typecheckPassed: true,
      testsPassed: 12,
      testsFailed: 0,
      parseConfidence: "high",
    });
  });

  it("parses alternate format: '12 passing, 3 failing'", () => {
    const result = parseQAVerification("12 passing, 3 failing");
    expect(result).toEqual({
      typecheckPassed: true,
      testsPassed: 12,
      testsFailed: 3,
      parseConfidence: "high",
    });
  });

  it("parses 'N tests passed, M failures' format", () => {
    const result = parseQAVerification("5 tests passed, 1 failure");
    expect(result).toEqual({
      typecheckPassed: true,
      testsPassed: 5,
      testsFailed: 1,
      parseConfidence: "high",
    });
  });

  it("returns low confidence for empty string", () => {
    const result = parseQAVerification("");
    expect(result).toEqual({
      typecheckPassed: false,
      testsPassed: 0,
      testsFailed: 0,
      parseConfidence: "low",
    });
  });

  it("returns low confidence for whitespace-only input", () => {
    const result = parseQAVerification("   \n\t  ");
    expect(result.parseConfidence).toBe("low");
    expect(result.typecheckPassed).toBe(false);
  });

  it("returns low confidence for garbage/unrecognized output", () => {
    const result = parseQAVerification("Something happened but I'm not sure what.");
    expect(result.parseConfidence).toBe("low");
    expect(result.typecheckPassed).toBe(false);
  });

  it("handles 'error' in success context without breaking parse", () => {
    const result = parseQAVerification("Fixed the error handling. Typecheck: pass. 8 pass, 0 fail");
    expect(result.typecheckPassed).toBe(true);
    expect(result.testsPassed).toBe(8);
    expect(result.testsFailed).toBe(0);
    expect(result.parseConfidence).toBe("high");
  });

  it("detects typecheck failure", () => {
    const result = parseQAVerification("Typecheck: fail\n0 pass, 0 fail");
    expect(result.typecheckPassed).toBe(false);
    expect(result.parseConfidence).toBe("high");
  });

  it("detects type error in output", () => {
    const result = parseQAVerification("Found a type error in User.ts\n3 pass, 1 fail");
    expect(result.typecheckPassed).toBe(false);
    expect(result.parseConfidence).toBe("high");
  });

  it("detects tsc error in output", () => {
    const result = parseQAVerification("tsc --noEmit error TS2345\n0 pass, 0 fail");
    expect(result.typecheckPassed).toBe(false);
  });

  it("typecheck passes when only test results present (no typecheck keywords)", () => {
    const result = parseQAVerification("8 pass, 0 fail");
    expect(result.typecheckPassed).toBe(true);
    expect(result.parseConfidence).toBe("high");
  });

  it("aggregates counts across multiple package summaries (monorepo pnpm -r run)", () => {
    // A real `pnpm -r test` prints one vitest summary per package. The old
    // single-.match() parse captured only the first package's numbers.
    const multiPkg = [
      " Tests  26 passed (26)",
      " Tests  137 passed (137)",
      " Tests  17 passed (17)",
    ].join("\n");
    const result = parseQAVerification(multiPkg);
    expect(result.testsPassed).toBe(180);
    expect(result.testsFailed).toBe(0);
  });

  it("flags a failure in a LATER package that a first-match parse would miss", () => {
    // Regression for the truncateMiddle build: apps/web sorts last in pnpm -r,
    // so its failures appear after several all-green package summaries. The old
    // parser stopped at the first "N passed" and reported testsFailed:0, letting
    // the build slip past the build→review gate.
    const output = [
      " Tests  26 passed (26)",
      " Tests  137 passed (137)",
      " Tests  3 failed | 2 passed (5)", // apps/web — the feature's broken tests
    ].join("\n");
    const result = parseQAVerification(output);
    expect(result.testsFailed).toBe(3);
    expect(result.testsPassed).toBe(165);
  });

  it("strips ANSI color codes before counting", () => {
    // vitest colorizes its output; the escape sequences must not corrupt counts.
    const colorized = " \x1b[32mTests\x1b[39m  \x1b[31m4 failed\x1b[39m | \x1b[32m10 passed\x1b[39m (14)";
    const result = parseQAVerification(colorized);
    expect(result.testsFailed).toBe(4);
    expect(result.testsPassed).toBe(10);
  });
});

// ─── Outcome Classification: False Positive Fixes ─────────────────────────

describe("classifyOutcome — false positive fixes", () => {
  function mockCodexResult(overrides: Partial<CodexResult> = {}): CodexResult {
    return {
      content: overrides.content ?? "",
      success: overrides.success ?? true,
      executedTools: overrides.executedTools ?? [],
      durationMs: overrides.durationMs ?? 1000,
    };
  }

  it("CodexResult success: 'Fixed the error handling' returns DONE, not DONE_WITH_CONCERNS", () => {
    const result = mockCodexResult({ content: "Fixed the error handling and updated tests.", success: true });
    expect(classifyOutcome(result, "software-engineer")).toBe("DONE");
  });

  it("CodexResult success: 'error: missing module' returns DONE_WITH_CONCERNS", () => {
    const result = mockCodexResult({ content: "Completed work. error: missing module 'prisma-client'.", success: true });
    expect(classifyOutcome(result, "software-engineer")).toBe("DONE_WITH_CONCERNS");
  });

  it("CodexResult success: '3 warnings' returns DONE_WITH_CONCERNS (numeric count)", () => {
    // "3 warnings" matches the N+warnings pattern — this is a real concern
    const result = mockCodexResult({ content: "Done. Had 3 warnings about unused imports.", success: true });
    expect(classifyOutcome(result, "frontend-engineer")).toBe("DONE_WITH_CONCERNS");
  });

  it("CodexResult success: narrative 'warnings' without count returns DONE", () => {
    // "some warnings" without a count is narrative, not structured
    const result = mockCodexResult({ content: "Done. There were some warnings mentioned in the docs.", success: true });
    expect(classifyOutcome(result, "frontend-engineer")).toBe("DONE");
  });

  it("CodexResult success: '3 warnings:' returns DONE_WITH_CONCERNS (structured)", () => {
    const result = mockCodexResult({ content: "Build complete. warnings: unused variable x.", success: true });
    expect(classifyOutcome(result, "frontend-engineer")).toBe("DONE_WITH_CONCERNS");
  });

  it("CodexResult success: 'typecheck failed' returns DONE_WITH_CONCERNS", () => {
    const result = mockCodexResult({ content: "Applied changes but typecheck failed.", success: true });
    expect(classifyOutcome(result, "qa-engineer")).toBe("DONE_WITH_CONCERNS");
  });

  it("AgenticResult with long text, no tools, no blocking language returns DONE", () => {
    const result = mockResult({
      content: "I analyzed the schema and here is my recommendation for the data model structure that would best support the complaint tracking feature with proper indexes and relations.",
      executedTools: [],
    });
    expect(classifyOutcome(result, "data-architect")).toBe("DONE");
  });

  it("AgenticResult with short content, no tools returns BLOCKED", () => {
    const result = mockResult({ content: "OK", executedTools: [] });
    expect(classifyOutcome(result, "software-engineer")).toBe("BLOCKED");
  });

  it("AgenticResult with empty content, no tools returns BLOCKED", () => {
    const result = mockResult({ content: "", executedTools: [] });
    expect(classifyOutcome(result, "software-engineer")).toBe("BLOCKED");
  });
});
