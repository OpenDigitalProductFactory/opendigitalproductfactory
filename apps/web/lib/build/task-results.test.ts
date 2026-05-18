import { describe, expect, it } from "vitest";
import { normalizeTaskResults } from "./task-results";

describe("normalizeTaskResults", () => {
  it("normalizes canonical orchestrator task results", () => {
    const normalized = normalizeTaskResults({
      completedTasks: 1,
      totalTasks: 2,
      timestamp: "2026-05-18T12:00:00.000Z",
      tasks: [
        {
          taskIndex: 0,
          title: "Add schema",
          specialist: "data-architect",
          outcome: "DONE",
          durationMs: 1000,
          files: [{ path: "packages/db/prisma/schema.prisma" }],
          artifactSummary: "Schema added",
        },
        {
          taskIndex: 1,
          title: "Add UI",
          specialist: "frontend-engineer",
          outcome: "BLOCKED",
          durationMs: 2000,
          files: ["apps/web/components/build/BuildSandboxCard.tsx"],
          artifactSummary: "Usage limit",
        },
      ],
    });

    expect(normalized.completedTasks).toBe(1);
    expect(normalized.totalTasks).toBe(2);
    expect(normalized.source).toEqual({
      source: "db-task-results",
      completed: 1,
      total: 2,
      observedAt: "2026-05-18T12:00:00.000Z",
    });
    expect(normalized.tasks).toEqual([
      {
        taskIndex: 0,
        title: "Add schema",
        specialist: "data-architect",
        outcome: "DONE",
        durationMs: 1000,
        summary: "Schema added",
        files: ["packages/db/prisma/schema.prisma"],
      },
      {
        taskIndex: 1,
        title: "Add UI",
        specialist: "frontend-engineer",
        outcome: "BLOCKED",
        durationMs: 2000,
        summary: "Usage limit",
        files: ["apps/web/components/build/BuildSandboxCard.tsx"],
      },
    ]);
  });

  it("handles summary-only task result writes without inventing rows", () => {
    const normalized = normalizeTaskResults({
      completedTasks: 0,
      totalTasks: 16,
      timestamp: "2026-05-18T12:00:00.000Z",
    });

    expect(normalized.completedTasks).toBe(0);
    expect(normalized.totalTasks).toBe(16);
    expect(normalized.tasks).toEqual([]);
    expect(normalized.source.observedAt).toBe("2026-05-18T12:00:00.000Z");
  });

  it("falls back to task rows when summary counts are missing", () => {
    const normalized = normalizeTaskResults({
      tasks: [
        { title: "One", specialist: "software-engineer", outcome: "DONE" },
        { title: "Two", specialist: "qa-engineer", outcome: "DONE_WITH_CONCERNS" },
        { title: "Three", specialist: "frontend-engineer", outcome: "FAILED" },
      ],
    });

    expect(normalized.completedTasks).toBe(2);
    expect(normalized.totalTasks).toBe(3);
  });

  it("returns an empty DB snapshot for null task results", () => {
    const normalized = normalizeTaskResults(null);

    expect(normalized).toEqual({
      completedTasks: 0,
      totalTasks: 0,
      tasks: [],
      source: {
        source: "db-task-results",
        completed: 0,
        total: 0,
        observedAt: null,
      },
    });
  });

  it("normalizes legacy task result arrays", () => {
    const normalized = normalizeTaskResults([
      { taskIndex: 0, title: "Legacy task", testResult: { passed: true }, codeReview: { decision: "pass" } },
    ]);

    expect(normalized.completedTasks).toBe(1);
    expect(normalized.totalTasks).toBe(1);
    expect(normalized.tasks).toEqual([
      {
        taskIndex: 0,
        title: "Legacy task",
        specialist: "software-engineer",
        outcome: "DONE",
        durationMs: null,
        summary: null,
        files: [],
      },
    ]);
  });
});
