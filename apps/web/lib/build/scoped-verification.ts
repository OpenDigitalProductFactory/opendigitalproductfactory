import type { BuildFailureAxis } from "./progress-visibility-types";
import type { BuildDispatchAttemptView } from "./dispatch-attempts";
import { getDispatchHistoryForBuild } from "./dispatch-attempts";
import { getSandboxStateForBuild } from "./sandbox-state";
import { normalizeVerificationOutput, type NormalizedVerificationOutput } from "./verification-output";

export type ScopedVerificationView = {
  source: "verification";
  observedAt: string | null;
  buildScoped: {
    typecheckPassed: boolean | null;
    testsPassed: number | null;
    testsFailed: number | null;
    failureAxis: BuildFailureAxis | null;
    affectedFiles: string[];
    affectedTests: string[];
  };
  globalHealth: {
    testsFailed: number | null;
    outputExcerpt: string | null;
  };
};

export async function getScopedVerificationForBuild(buildId: string): Promise<ScopedVerificationView | null> {
  const { prisma } = await import("@dpf/db");
  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      verificationOut: true,
      diffPatch: true,
    },
  });
  if (!build) {
    return null;
  }

  const sandbox = await getSandboxStateForBuild(buildId);
  const dispatchHistory = await getDispatchHistoryForBuild(buildId);
  const changedFiles = sandbox?.sourceDiffstat.map((entry) => entry.path) ?? [];

  return buildScopedVerificationFromParts({
    verification: normalizeVerificationOutput(build.verificationOut),
    changedFiles,
    dispatchHistory,
  });
}

export function buildScopedVerificationFromParts(args: {
  verification: NormalizedVerificationOutput;
  changedFiles: string[];
  dispatchHistory: BuildDispatchAttemptView[];
}): ScopedVerificationView {
  const outputFiles = extractFilePathsFromText(args.verification.outputExcerpt ?? "");
  const dispatchFiles = args.dispatchHistory.flatMap((attempt) =>
    extractFilePathsFromText(`${attempt.stdoutExcerpt ?? ""}\n${attempt.stderrExcerpt ?? ""}`)
  );
  const changedFiles = unique(args.changedFiles.length > 0 ? args.changedFiles : dispatchFiles);
  const affectedTests = outputFiles.filter((path) => /\.test\.[tj]sx?$/.test(path));
  const outputFailuresOutsideScope =
    changedFiles.length > 0
    && outputFiles.length > 0
    && outputFiles.every((file) => !isPathInScope(file, changedFiles));
  const scopedFailureAxis = deriveScopedFailureAxis({
    baseAxis: args.verification.failureAxis,
    changedFiles,
    outputFiles,
    outputFailuresOutsideScope,
  });

  return {
    source: "verification",
    observedAt: args.verification.observedAt,
    buildScoped: {
      typecheckPassed: outputFailuresOutsideScope ? null : args.verification.typecheckPassed,
      testsPassed: outputFailuresOutsideScope ? null : args.verification.testsPassed,
      testsFailed: outputFailuresOutsideScope ? null : args.verification.testsFailed,
      failureAxis: scopedFailureAxis,
      affectedFiles: changedFiles,
      affectedTests,
    },
    globalHealth: {
      testsFailed: args.verification.testsFailed,
      outputExcerpt: args.verification.outputExcerpt,
    },
  };
}

export function extractFilePathsFromText(value: string): string[] {
  return unique([...value.matchAll(/\b(?:apps|packages)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g)]
    .map((match) => match[0].replace(/[),.;:]$/, "")));
}

function deriveScopedFailureAxis(args: {
  baseAxis: BuildFailureAxis | null;
  changedFiles: string[];
  outputFiles: string[];
  outputFailuresOutsideScope: boolean;
}): BuildFailureAxis | null {
  if (args.changedFiles.length === 0 && args.baseAxis != null) {
    return "unknown";
  }
  if (args.outputFailuresOutsideScope) {
    return "out-of-scope-noise";
  }
  return args.baseAxis;
}

function isPathInScope(path: string, changedFiles: string[]): boolean {
  return changedFiles.some((changed) => path === changed || path.includes(changed) || changed.includes(path));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
