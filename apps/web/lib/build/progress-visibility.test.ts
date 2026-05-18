import { describe, expect, it } from "vitest";
import { normalizeTaskResults } from "./task-results";
import { normalizeVerificationOutput } from "./verification-output";
import { buildProgressProjectionFromParts, extractChatProgressSnapshots } from "./progress-visibility";
import { buildScopedVerificationFromParts } from "./scoped-verification";

describe("buildProgressProjectionFromParts", () => {
  it("keeps newer DB task progress primary and folds stale chat disagreement into conflicts", () => {
    const projection = buildProgressProjectionFromParts({
      buildId: "FB-123",
      now: new Date("2026-05-18T12:00:00.000Z"),
      dbTasks: normalizeTaskResults({
        completedTasks: 0,
        totalTasks: 16,
        timestamp: "2026-05-18T11:59:00.000Z",
      }),
      chatSnapshots: [
        {
          completed: 14,
          total: 16,
          observedAt: "2026-05-17T21:00:00.000Z",
          excerpt: "14 of 16 tasks completed, 2 need review.",
        },
      ],
      sandbox: null,
      dispatchHistory: [],
      verification: buildScopedVerificationFromParts({
        verification: normalizeVerificationOutput(null),
        changedFiles: [],
        dispatchHistory: [],
      }),
      lastActivityAt: null,
    });

    expect(projection.progress.primary).toMatchObject({
      source: "db-task-results",
      completed: 0,
      total: 16,
    });
    expect(projection.progress.conflicts).toEqual([
      {
        source: "chat-self-report",
        completed: 14,
        total: 16,
        observedAt: "2026-05-17T21:00:00.000Z",
      },
    ]);
    expect(projection.staleChatSnapshots[0]?.excerpt).toContain("14 of 16");
  });

  it("classifies usage-limit dispatch failure as the status heading axis", () => {
    const projection = buildProgressProjectionFromParts({
      buildId: "FB-123",
      now: new Date("2026-05-18T12:00:00.000Z"),
      dbTasks: normalizeTaskResults({
        completedTasks: 0,
        totalTasks: 1,
        timestamp: "2026-05-18T11:59:00.000Z",
        tasks: [{ title: "Add UI", specialist: "frontend-engineer", outcome: "BLOCKED" }],
      }),
      chatSnapshots: [],
      sandbox: null,
      dispatchHistory: [
        {
          id: "attempt-1",
          buildId: "FB-123",
          taskTitle: "Add UI",
          specialist: "frontend-engineer",
          providerId: "chatgpt",
          model: "gpt-5.3-codex",
          attemptNumber: 1,
          startedAt: "2026-05-18T11:58:00.000Z",
          completedAt: "2026-05-18T11:59:00.000Z",
          durationMs: 60_000,
          exitCode: 1,
          success: false,
          failureAxis: "usage-limit",
          stdoutExcerpt: "ERROR: You've hit your usage limit.",
          stderrExcerpt: null,
          rootCauseSummary: "ERROR: You've hit your usage limit.",
          rootCauseHash: "abc123abc123abcd",
        },
      ],
      verification: buildScopedVerificationFromParts({
        verification: normalizeVerificationOutput(null),
        changedFiles: [],
        dispatchHistory: [],
      }),
      lastActivityAt: "2026-05-18T11:59:00.000Z",
    });

    expect(projection.statusHeading).toEqual({
      operatorAction: "Click Resume to re-execute 1 blocked task",
      failureAxis: "usage-limit",
    });
  });

  it("marks quiet agent state after five minutes without observable downstream signal", () => {
    const projection = buildProgressProjectionFromParts({
      buildId: "FB-123",
      now: new Date("2026-05-18T12:10:00.000Z"),
      dbTasks: normalizeTaskResults({
        completedTasks: 0,
        totalTasks: 16,
        timestamp: "2026-05-18T12:00:00.000Z",
      }),
      chatSnapshots: [],
      sandbox: null,
      dispatchHistory: [],
      verification: buildScopedVerificationFromParts({
        verification: normalizeVerificationOutput(null),
        changedFiles: [],
        dispatchHistory: [],
      }),
      lastActivityAt: "2026-05-18T12:00:00.000Z",
    });

    expect(projection.quietAgent).toEqual({
      quiet: true,
      minutesQuiet: 10,
      lastObservableSignalAt: "2026-05-18T12:00:00.000Z",
    });
  });

  it("does not mark quiet when the most recent dispatch is still in flight", () => {
    const projection = buildProgressProjectionFromParts({
      buildId: "FB-123",
      now: new Date("2026-05-18T12:10:00.000Z"),
      dbTasks: normalizeTaskResults({
        completedTasks: 0,
        totalTasks: 1,
        timestamp: "2026-05-18T12:00:00.000Z",
      }),
      chatSnapshots: [],
      sandbox: null,
      dispatchHistory: [
        {
          id: "attempt-1",
          buildId: "FB-123",
          taskTitle: "Still running",
          specialist: "software-engineer",
          providerId: "chatgpt",
          model: "gpt-5.3-codex",
          attemptNumber: 1,
          startedAt: "2026-05-18T12:01:00.000Z",
          completedAt: null,
          durationMs: null,
          exitCode: null,
          success: false,
          failureAxis: "unknown",
          stdoutExcerpt: null,
          stderrExcerpt: null,
          rootCauseSummary: null,
          rootCauseHash: null,
        },
      ],
      verification: buildScopedVerificationFromParts({
        verification: normalizeVerificationOutput(null),
        changedFiles: [],
        dispatchHistory: [],
      }),
      lastActivityAt: "2026-05-18T12:00:00.000Z",
    });

    expect(projection.quietAgent.quiet).toBe(false);
    expect(projection.quietAgent.lastObservableSignalAt).toBe("2026-05-18T12:01:00.000Z");
  });
});

describe("extractChatProgressSnapshots", () => {
  it("extracts only valid assistant self-report task counts", () => {
    const snapshots = extractChatProgressSnapshots([
      {
        role: "user",
        content: "14 of 16 tasks completed?",
        createdAt: "2026-05-18T11:55:00.000Z",
      },
      {
        role: "assistant",
        content: "14 of 12 tasks completed.",
        createdAt: "2026-05-18T11:56:00.000Z",
      },
      {
        role: "assistant",
        content: "14 of 16 tasks completed, 2 need review.",
        createdAt: "2026-05-18T11:57:00.000Z",
      },
    ]);

    expect(snapshots).toEqual([
      {
        completed: 14,
        total: 16,
        observedAt: "2026-05-18T11:57:00.000Z",
        excerpt: "14 of 16 tasks completed, 2 need review.",
      },
    ]);
  });
});
