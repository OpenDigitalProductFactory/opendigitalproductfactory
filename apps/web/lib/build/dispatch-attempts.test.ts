import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDispatchAttemptData,
  classifyDispatchFailureAxis,
  recordBuildDispatchAttempt,
} from "./dispatch-attempts";

const prismaMock = vi.hoisted(() => ({
  buildDispatchAttempt: {
    count: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock("@dpf/db", () => ({
  prisma: prismaMock,
}));

beforeEach(() => {
  prismaMock.buildDispatchAttempt.count.mockReset();
  prismaMock.buildDispatchAttempt.create.mockReset();
  prismaMock.buildDispatchAttempt.findMany.mockReset();
});

describe("classifyDispatchFailureAxis", () => {
  it("classifies Codex usage limit output", () => {
    expect(classifyDispatchFailureAxis({
      exitCode: 1,
      stdout: "ERROR: You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage or try again at 6:06 AM",
      stderr: "",
      timedOut: false,
    })).toBe("usage-limit");
  });

  it("classifies auth, timeout, and provider failures", () => {
    expect(classifyDispatchFailureAxis({
      exitCode: 1,
      stdout: "No OAuth token for provider chatgpt",
      stderr: "",
      timedOut: false,
    })).toBe("auth");

    expect(classifyDispatchFailureAxis({
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: true,
    })).toBe("timeout");

    expect(classifyDispatchFailureAxis({
      exitCode: 1,
      stdout: "The AI provider is temporarily unavailable",
      stderr: "",
      timedOut: false,
    })).toBe("provider-unavailable");
  });
});

describe("buildDispatchAttemptData", () => {
  it("bounds stdout and stderr excerpts and derives a stable root-cause hash", () => {
    const data = buildDispatchAttemptData({
      buildId: "FB-123",
      taskTitle: "Add sandbox card",
      specialist: "frontend-engineer",
      providerId: "chatgpt",
      model: "gpt-5.3-codex",
      startedAt: new Date("2026-05-18T12:00:00.000Z"),
      completedAt: new Date("2026-05-18T12:00:02.000Z"),
      durationMs: 2000,
      exitCode: 1,
      success: false,
      stdout: `ERROR: You've hit your usage limit.\n${"x".repeat(900)}`,
      stderr: `stderr line\n${"y".repeat(900)}`,
      timedOut: false,
      attemptNumber: 2,
    });

    expect(data).toMatchObject({
      buildId: "FB-123",
      taskTitle: "Add sandbox card",
      specialist: "frontend-engineer",
      providerId: "chatgpt",
      model: "gpt-5.3-codex",
      durationMs: 2000,
      exitCode: 1,
      success: false,
      failureAxis: "usage-limit",
      rootCauseSummary: "ERROR: You've hit your usage limit.",
      attemptNumber: 2,
    });
    expect(data.stdoutExcerpt?.length).toBeLessThanOrEqual(500);
    expect(data.stderrExcerpt?.length).toBeLessThanOrEqual(500);
    expect(data.rootCauseHash).toMatch(/^[a-f0-9]{16}$/);
  });

  it("redacts secrets before creating excerpts", () => {
    const data = buildDispatchAttemptData({
      buildId: "FB-123",
      taskTitle: "Auth failure",
      startedAt: new Date("2026-05-18T12:00:00.000Z"),
      completedAt: new Date("2026-05-18T12:00:02.000Z"),
      durationMs: 2000,
      exitCode: 1,
      success: false,
      stdout: "Bearer abc.def.ghi dpfmcp_ABC123 sk-1234567890 password=secret",
      stderr: "password:another-secret",
    });

    expect(data.stdoutExcerpt).toBe("[REDACTED] [REDACTED] [REDACTED] [REDACTED]");
    expect(data.stderrExcerpt).toBe("[REDACTED]");
  });

  it("normalizes variable details before hashing root cause", () => {
    const first = buildDispatchAttemptData({
      buildId: "FB-123",
      taskTitle: "Failure",
      startedAt: new Date("2026-05-18T12:00:00.000Z"),
      completedAt: new Date("2026-05-18T12:00:02.000Z"),
      durationMs: 2000,
      exitCode: 1,
      success: false,
      stdout: "2026-05-18T12:00:00.000Z apps/web/lib/foo.ts:123 failed session abcdef1234567890",
      stderr: "",
    });
    const second = buildDispatchAttemptData({
      buildId: "FB-123",
      taskTitle: "Failure",
      startedAt: new Date("2026-05-18T12:05:00.000Z"),
      completedAt: new Date("2026-05-18T12:05:02.000Z"),
      durationMs: 2000,
      exitCode: 1,
      success: false,
      stdout: "2026-05-18T12:05:00.000Z apps/web/lib/bar.ts:456 failed session 99999999aaaaaaaa",
      stderr: "",
    });

    expect(first.rootCauseHash).toBe(second.rootCauseHash);
  });

  it("sets attempt number from existing attempts for the build task", async () => {
    prismaMock.buildDispatchAttempt.count.mockResolvedValue(2);
    prismaMock.buildDispatchAttempt.create.mockResolvedValue({});

    await recordBuildDispatchAttempt({
      buildId: "FB-123",
      taskTitle: "Add card",
      startedAt: new Date("2026-05-18T12:00:00.000Z"),
      completedAt: new Date("2026-05-18T12:00:02.000Z"),
      durationMs: 2000,
      exitCode: 1,
      success: false,
      stdout: "ERROR: You've hit your usage limit.",
      stderr: "",
    });

    expect(prismaMock.buildDispatchAttempt.count).toHaveBeenCalledWith({
      where: { buildId: "FB-123", taskTitle: "Add card" },
    });
    expect(prismaMock.buildDispatchAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        attemptNumber: 3,
      }),
    });
  });
});
