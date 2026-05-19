import { createHash } from "crypto";
import type { BuildFailureAxis } from "./progress-visibility-types";

export type BuildDispatchAttemptData = {
  buildId: string;
  taskTitle: string;
  specialist: string | null;
  providerId: string | null;
  model: string | null;
  attemptNumber: number;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  exitCode: number | null;
  success: boolean;
  failureAxis: BuildFailureAxis;
  stdoutExcerpt: string | null;
  stderrExcerpt: string | null;
  rootCauseSummary: string | null;
  rootCauseHash: string | null;
};

export type BuildDispatchAttemptView = {
  id: string;
  buildId: string;
  taskTitle: string;
  specialist: string | null;
  providerId: string | null;
  model: string | null;
  attemptNumber: number;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  exitCode: number | null;
  success: boolean;
  failureAxis: BuildFailureAxis;
  stdoutExcerpt: string | null;
  stderrExcerpt: string | null;
  rootCauseSummary: string | null;
  rootCauseHash: string | null;
};

type RecordInput = {
  buildId: string;
  taskTitle: string;
  specialist?: string | null;
  providerId?: string | null;
  model?: string | null;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  exitCode: number | null;
  success: boolean;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  attemptNumber?: number;
};

type DispatchAttemptPrisma = {
  buildDispatchAttempt: {
    count: (args: { where: { buildId: string; taskTitle: string } }) => Promise<number>;
    create: (args: { data: BuildDispatchAttemptData }) => Promise<unknown>;
    findMany: (args: {
      where: { buildId: string };
      orderBy: { startedAt: "asc" | "desc" };
    }) => Promise<Array<{
      id: string;
      buildId: string;
      taskTitle: string;
      specialist: string | null;
      providerId: string | null;
      model: string | null;
      attemptNumber: number;
      startedAt: Date;
      completedAt: Date | null;
      durationMs: number | null;
      exitCode: number | null;
      success: boolean;
      failureAxis: string;
      stdoutExcerpt: string | null;
      stderrExcerpt: string | null;
      rootCauseSummary: string | null;
      rootCauseHash: string | null;
    }>>;
  };
};

export function classifyDispatchFailureAxis(args: {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}): BuildFailureAxis {
  if (args.timedOut) {
    return "timeout";
  }

  const output = `${args.stdout}\n${args.stderr}`.toLowerCase();
  if (output.includes("usage limit") || output.includes("you've hit your usage limit")) {
    return "usage-limit";
  }
  if (output.includes("rate limit") || output.includes("429")) {
    return "rate-limit";
  }
  if (
    output.includes("no oauth token")
    || output.includes("auth error")
    || output.includes("unauthorized")
    || output.includes("authentication")
  ) {
    return "auth";
  }
  if (output.includes("provider is temporarily unavailable") || output.includes("provider unavailable")) {
    return "provider-unavailable";
  }
  if (output.includes("timed out") || output.includes("timeout")) {
    return "timeout";
  }
  return args.exitCode === 0 ? "unknown" : "unknown";
}

export function buildDispatchAttemptData(args: RecordInput): BuildDispatchAttemptData {
  const sanitizedStdout = sanitizeDispatchOutput(args.stdout);
  const sanitizedStderr = sanitizeDispatchOutput(args.stderr);
  const failureAxis = args.success
    ? "unknown"
    : classifyDispatchFailureAxis({
      exitCode: args.exitCode,
      stdout: sanitizedStdout,
      stderr: sanitizedStderr,
      timedOut: args.timedOut === true,
    });
  const rootCauseSummary = args.success ? null : extractRootCauseSummary(sanitizedStdout, sanitizedStderr, failureAxis);
  const rootCauseHash = rootCauseSummary
    ? hashRootCause(`${failureAxis}:${normalizeRootCauseForHash(rootCauseSummary)}`)
    : null;

  return {
    buildId: args.buildId,
    taskTitle: args.taskTitle,
    specialist: args.specialist ?? null,
    providerId: args.providerId ?? null,
    model: args.model ?? null,
    attemptNumber: args.attemptNumber ?? 1,
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    durationMs: args.durationMs,
    exitCode: args.exitCode,
    success: args.success,
    failureAxis,
    stdoutExcerpt: excerpt(sanitizedStdout),
    stderrExcerpt: excerpt(sanitizedStderr),
    rootCauseSummary,
    rootCauseHash,
  };
}

export async function recordBuildDispatchAttempt(args: RecordInput): Promise<void> {
  try {
    const { prisma } = await import("@dpf/db");
    const db = prisma as unknown as DispatchAttemptPrisma;
    const existingAttempts = await db.buildDispatchAttempt.count({
      where: {
        buildId: args.buildId,
        taskTitle: args.taskTitle,
      },
    });
    await db.buildDispatchAttempt.create({
      data: buildDispatchAttemptData({
        ...args,
        attemptNumber: existingAttempts + 1,
      }),
    });
  } catch (err) {
    console.warn("[codex-dispatch] Failed to record dispatch attempt:", err);
  }
}

export async function getDispatchHistoryForBuild(buildId: string): Promise<BuildDispatchAttemptView[]> {
  const { prisma } = await import("@dpf/db");
  const db = prisma as unknown as DispatchAttemptPrisma;
  const rows = await db.buildDispatchAttempt.findMany({
    where: { buildId },
    orderBy: { startedAt: "asc" },
  });

  return rows.map((row) => ({
    ...row,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    failureAxis: normalizeFailureAxis(row.failureAxis),
  }));
}

function extractRootCauseSummary(stdout: string, stderr: string, fallback: BuildFailureAxis): string {
  const combined = `${stdout}\n${stderr}`;
  const lines = combined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const axisLine = lines.find((line) => lineMatchesFailureAxis(line, fallback));
  if (axisLine) {
    return axisLine.slice(0, 200);
  }
  const firstLine = lines.find((line) => !isCliPrologueLine(line));
  return firstLine?.slice(0, 200) ?? fallback;
}

function lineMatchesFailureAxis(line: string, axis: BuildFailureAxis): boolean {
  const normalized = line.toLowerCase();
  switch (axis) {
    case "usage-limit":
      return normalized.includes("usage limit");
    case "rate-limit":
      return normalized.includes("rate limit") || normalized.includes("429");
    case "auth":
      return normalized.includes("oauth")
        || normalized.includes("api key")
        || normalized.includes("authentication")
        || normalized.includes("unauthorized")
        || normalized.includes("forbidden");
    case "timeout":
      return normalized.includes("timed out") || normalized.includes("timeout");
    case "provider-unavailable":
      return normalized.includes("provider") && normalized.includes("unavailable");
    case "test-failure":
      return normalized.includes("test") || normalized.includes("fail");
    case "typecheck-failure":
      return normalized.includes("typecheck") || normalized.includes("typescript");
    case "out-of-scope-noise":
      return normalized.includes("out-of-scope") || normalized.includes("workspace");
    case "unknown":
      return false;
    default:
      return false;
  }
}

function isCliPrologueLine(line: string): boolean {
  const normalized = line.toLowerCase();
  return normalized === "reading prompt from stdin..."
    || normalized.startsWith("reading prompt from stdin")
    || normalized.startsWith("openai codex")
    || normalized.startsWith("codex ");
}

function excerpt(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 500) : null;
}

export function sanitizeDispatchOutput(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, "[REDACTED]")
    .replace(/dpfmcp_[A-Za-z0-9_=-]+/g, "[REDACTED]")
    .replace(/sk-[A-Za-z0-9]+/g, "[REDACTED]")
    .replace(/password[=:]\S+/gi, "[REDACTED]");
}

export function normalizeRootCauseForHash(value: string): string {
  return value
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.Z+-]+/g, "[time]")
    .replace(/\b(?:apps|packages)\/[A-Za-z0-9_./-]+(?::L?\d+)?/g, "[path]")
    .replace(/:L?\d+\b/g, ":[line]")
    .replace(/\b[a-f0-9]{8,}\b/gi, "[id]")
    .replace(/\s+/g, " ")
    .trim();
}

function hashRootCause(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function normalizeFailureAxis(value: string): BuildFailureAxis {
  switch (value) {
    case "rate-limit":
    case "usage-limit":
    case "auth":
    case "timeout":
    case "test-failure":
    case "typecheck-failure":
    case "out-of-scope-noise":
    case "provider-unavailable":
    case "unknown":
      return value;
    default:
      return "unknown";
  }
}
