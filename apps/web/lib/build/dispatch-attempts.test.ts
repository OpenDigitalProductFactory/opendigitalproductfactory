import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDispatchAttemptData,
  classifyDispatchFailureAxis,
  lineMatchesFailureAxis,
  recomputeRootCauseSummary,
  recordBuildDispatchAttempt,
} from "./dispatch-attempts";
import type { BuildFailureAxis } from "./progress-visibility-types";

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

  it("skips Codex CLI prologue lines when extracting root cause", () => {
    const data = buildDispatchAttemptData({
      buildId: "FB-123",
      taskTitle: "Run verification",
      startedAt: new Date("2026-05-19T06:04:52.138Z"),
      completedAt: new Date("2026-05-19T06:04:53.864Z"),
      durationMs: 1726,
      exitCode: 1,
      success: false,
      stdout: [
        "Reading prompt from stdin...",
        "ERROR: You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage or try again at 6:06 AM",
      ].join("\n"),
      stderr: "",
    });

    expect(data.failureAxis).toBe("usage-limit");
    expect(data.rootCauseSummary).toBe(
      "ERROR: You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage or try again at 6:06 AM",
    );
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

describe("lineMatchesFailureAxis", () => {
  const axes: BuildFailureAxis[] = [
    "usage-limit",
    "rate-limit",
    "auth",
    "timeout",
    "test-failure",
    "typecheck-failure",
    "out-of-scope-noise",
    "provider-unavailable",
  ];

  it("does not match CLI prologue lines for any failure axis", () => {
    const prologueLines = [
      "Reading prompt from stdin...",
      "Reading prompt from stdin for Build Studio task",
      "OpenAI Codex v0.42.0",
      "codex exec --sandbox workspace-write",
      "Reading TypeScript prompt from stdin",
      "Reading prompt from workspace verification context",
    ];

    for (const line of prologueLines) {
      for (const axis of axes) {
        expect(lineMatchesFailureAxis(line, axis), `${axis} matched ${line}`).toBe(false);
      }
    }
  });

  it("keeps test, typecheck, and out-of-scope root-cause matching specific", () => {
    expect(lineMatchesFailureAxis("Failure preparing artifact bundle", "test-failure")).toBe(false);
    expect(lineMatchesFailureAxis("vitest run failed: 3 test errors", "test-failure")).toBe(true);
    expect(lineMatchesFailureAxis("Reading TypeScript prompt from stdin", "typecheck-failure")).toBe(false);
    expect(lineMatchesFailureAxis("error TS2345: Argument type mismatch", "typecheck-failure")).toBe(true);
    expect(lineMatchesFailureAxis("workspace prompt prepared", "out-of-scope-noise")).toBe(false);
    expect(lineMatchesFailureAxis("out-of-scope workspace noise detected", "out-of-scope-noise")).toBe(true);
  });
});

describe("recomputeRootCauseSummary (BI-594B76AB)", () => {
  it("returns the axis-matched line when the stdout excerpt contains one", () => {
    const result = recomputeRootCauseSummary({
      stdoutExcerpt: "Reading prompt from stdin...\nYou've hit your usage limit for today.",
      stderrExcerpt: null,
      failureAxis: "usage-limit",
    });
    expect(result.toLowerCase()).toMatch(/usage limit/);
    expect(result.toLowerCase()).not.toMatch(/reading prompt from stdin/);
  });

  it("falls back to the first non-prologue line when no axis line is found", () => {
    const result = recomputeRootCauseSummary({
      stdoutExcerpt: "Reading prompt from stdin...\nSomething else happened.",
      stderrExcerpt: null,
      failureAxis: "unknown",
    });
    expect(result).toBe("Something else happened.");
  });

  it("falls back to the axis name when both excerpts are null", () => {
    const result = recomputeRootCauseSummary({
      stdoutExcerpt: null,
      stderrExcerpt: null,
      failureAxis: "timeout",
    });
    expect(result).toBe("timeout");
  });

  it("falls back to the axis name when both excerpts are empty strings", () => {
    const result = recomputeRootCauseSummary({
      stdoutExcerpt: "",
      stderrExcerpt: "",
      failureAxis: "rate-limit",
    });
    expect(result).toBe("rate-limit");
  });

  it("reads the stderr excerpt when stdout has only prologue", () => {
    const result = recomputeRootCauseSummary({
      stdoutExcerpt: "Reading prompt from stdin...",
      stderrExcerpt: "auth error: unauthorized request",
      failureAxis: "auth",
    });
    expect(result.toLowerCase()).toContain("unauthorized");
  });
});
