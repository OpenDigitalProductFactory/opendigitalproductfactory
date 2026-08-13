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
      lastMeaningfulSignalAt: "2026-05-18T12:00:00.000Z",
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

describe("buildProgressProjectionFromParts — inferenceFailure (BI-F0005EB0)", () => {
  function partsWithLastAssistant(
    lastAssistant: { content: string | null; createdAt: Date | string | null } | null,
    lastActivityAt: string | null,
  ) {
    return {
      buildId: "FB-INF",
      now: new Date("2026-07-05T12:00:00.000Z"),
      dbTasks: normalizeTaskResults(null),
      chatSnapshots: [],
      sandbox: null,
      dispatchHistory: [],
      verification: buildScopedVerificationFromParts({
        verification: normalizeVerificationOutput(null),
        changedFiles: [],
        dispatchHistory: [],
      }),
      lastActivityAt,
      lastAssistant,
    };
  }

  it("flags a failed ideate inference turn as inferenceFailure.failed", () => {
    const projection = buildProgressProjectionFromParts(
      partsWithLastAssistant(
        {
          content: "API Error: Unable to connect to API (ConnectionRefused)",
          createdAt: "2026-07-05T11:59:00.000Z",
        },
        // No fresher observable signal than the failed turn.
        "2026-07-05T11:59:00.000Z",
      ),
    );

    expect(projection.inferenceFailure).toEqual({
      failed: true,
      kind: "connection",
      observedAt: "2026-07-05T11:59:00.000Z",
    });
  });

  it("does not let generic activity erase a persisted inference failure", () => {
    const projection = buildProgressProjectionFromParts(
      partsWithLastAssistant(
        {
          content: "API Error: Unable to connect to API (ConnectionRefused)",
          createdAt: "2026-07-05T11:59:00.000Z",
        },
        // A generic BuildActivity row landed AFTER the failed turn. That is
        // liveness evidence, not proof that the failed inference recovered.
        "2026-07-05T11:59:30.000Z",
      ),
    );

    expect(projection.inferenceFailure?.failed).toBe(true);
    expect(projection.inferenceFailure?.kind).toBe("connection");
  });

  it("clears a persisted inference failure after newer task progress proves recovery", () => {
    const projection = buildProgressProjectionFromParts({
      ...partsWithLastAssistant(
        {
          content: "API Error: Unable to connect to API (ConnectionRefused)",
          createdAt: "2026-07-05T11:59:00.000Z",
        },
        "2026-07-05T11:59:30.000Z",
      ),
      dbTasks: normalizeTaskResults({
        completedTasks: 1,
        totalTasks: 2,
        timestamp: "2026-07-05T11:59:45.000Z",
      }),
    });

    expect(projection.inferenceFailure).toEqual({
      failed: false,
      kind: "connection",
      observedAt: "2026-07-05T11:59:00.000Z",
    });
  });

  it("does not treat a newer zero-task snapshot as recovered work", () => {
    const projection = buildProgressProjectionFromParts({
      ...partsWithLastAssistant(
        {
          content: "API Error: Unable to connect to API (ConnectionRefused)",
          createdAt: "2026-07-05T11:59:00.000Z",
        },
        "2026-07-05T11:59:30.000Z",
      ),
      dbTasks: normalizeTaskResults({
        completedTasks: 0,
        totalTasks: 0,
        timestamp: "2026-07-05T11:59:45.000Z",
      }),
    });

    expect(projection.inferenceFailure?.failed).toBe(true);
  });

  it("does not flag a normal assistant turn", () => {
    const projection = buildProgressProjectionFromParts(
      partsWithLastAssistant(
        {
          content: "Let's define it together — what job types do you handle most?",
          createdAt: "2026-07-05T11:59:00.000Z",
        },
        "2026-07-05T11:59:00.000Z",
      ),
    );

    expect(projection.inferenceFailure).toEqual({ failed: false, kind: null, observedAt: null });
  });

  it("does not flag when there is no assistant turn", () => {
    const projection = buildProgressProjectionFromParts(partsWithLastAssistant(null, null));
    expect(projection.inferenceFailure).toEqual({ failed: false, kind: null, observedAt: null });
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
