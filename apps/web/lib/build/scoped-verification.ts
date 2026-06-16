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
  // The character class includes `()` so Next.js route-group segments like
  // `app/(shell)/…/page.tsx` are captured — without this, the file that stalled
  // FB-69231490 (`apps/web/app/(shell)/platform/identity/applications/page.tsx`)
  // was never extracted, so out-of-scope classification silently failed.
  return unique([...value.matchAll(/\b(?:apps|packages)\/[A-Za-z0-9_./()-]+\.[A-Za-z0-9]+/g)]
    .map((match) => match[0].replace(/[),.;:]$/, "")));
}

/**
 * Gate-facing verification record scoped to the build's changed files.
 *
 * The build→review gate (`checkPhaseGate` → `verification-typecheck-passed`)
 * reads `verificationOut.typecheckPassed` verbatim. When a build runs a wider
 * test/typecheck pass than its own changed surface — the full monorepo suite,
 * or a whole-`apps/web` `tsc` run — a pre-existing failure ELSEWHERE in the
 * repo lands in the output and flips `typecheckPassed=false`, blocking a build
 * whose own files are clean. That is the FB-69231490 stall: an unrelated broken
 * `.tsx` test gated a ~30-line helper.
 *
 * This realizes #1988's intent at the gate: when EVERY observed failure is
 * outside the changed surface, report the build's own surface as clean
 * (`typecheckPassed=true`, `testsFailed=0`) so the advance proceeds, while
 * preserving the full-repo signal in `globalTestsFailed` for visibility. An
 * in-scope failure (the feature's own tests/typecheck) still blocks — only
 * out-of-scope NOISE is neutralized. With no changed-file set we cannot scope,
 * so the raw verdict passes through unchanged (conservative: keeps blocking).
 */
export type GateScopedVerification = {
  typecheckPassed: boolean | null;
  testsPassed: number | null;
  testsFailed: number | null;
  failureAxis: BuildFailureAxis | null;
  /** True when all observed failures are outside the changed surface. */
  outOfScopeNoise: boolean;
  /** Full-repo failure count, preserved for visibility even when neutralized. */
  globalTestsFailed: number | null;
  affectedFiles: string[];
};

export function scopeVerificationOutputForGate(args: {
  verification: NormalizedVerificationOutput;
  changedFiles: string[];
  dispatchHistory?: BuildDispatchAttemptView[];
}): GateScopedVerification {
  const scoped = buildScopedVerificationFromParts({
    verification: args.verification,
    changedFiles: args.changedFiles,
    dispatchHistory: args.dispatchHistory ?? [],
  });
  const outOfScopeNoise = scoped.buildScoped.failureAxis === "out-of-scope-noise";

  return {
    // Out-of-scope noise ⇒ the build's own surface is clean. Map the nulled
    // scoped verdict to an explicit pass so the gate advances.
    typecheckPassed: outOfScopeNoise ? true : scoped.buildScoped.typecheckPassed,
    testsPassed: outOfScopeNoise ? args.verification.testsPassed : scoped.buildScoped.testsPassed,
    testsFailed: outOfScopeNoise ? 0 : scoped.buildScoped.testsFailed,
    failureAxis: scoped.buildScoped.failureAxis,
    outOfScopeNoise,
    globalTestsFailed: scoped.globalHealth.testsFailed,
    affectedFiles: scoped.buildScoped.affectedFiles,
  };
}

/**
 * Scope a raw `tsc --noEmit` output to the build's changed files.
 *
 * `runSandboxTests` runs `tsc` over the whole `apps/web` workspace — there is no
 * cheap way to typecheck one file in isolation because the project graph is
 * shared. So we post-filter: parse every `error TS` line for its file, and if
 * EVERY error sits outside the changed surface, the build's own files typecheck
 * clean. `tsc` prints paths relative to its cwd (`apps/web`), while changed
 * files are repo-relative (`apps/web/lib/foo.ts`); `isPathInScope` already
 * matches on containment in both directions, so a suffix match succeeds.
 *
 * Returns `passed:true` when there are no `error TS` markers. When errors exist
 * but NONE could be attributed to a file (unparseable output), we conservatively
 * report `passed:false` — better to block than to wave through an opaque failure.
 */
export function typecheckPassedForChangedScope(
  typeCheckOutput: string,
  changedFiles: string[],
): { passed: boolean; inScopeErrorFiles: string[]; outOfScopeErrorFiles: string[] } {
  if (!typeCheckOutput.includes("error TS")) {
    return { passed: true, inScopeErrorFiles: [], outOfScopeErrorFiles: [] };
  }
  // No scope to apply ⇒ preserve legacy behavior (any error fails).
  if (changedFiles.length === 0) {
    return { passed: false, inScopeErrorFiles: [], outOfScopeErrorFiles: [] };
  }

  const errorFiles = extractTypecheckErrorFiles(typeCheckOutput);
  if (errorFiles.length === 0) {
    // Errors present but no file attributable — do not wave it through.
    return { passed: false, inScopeErrorFiles: [], outOfScopeErrorFiles: [] };
  }

  const inScope = errorFiles.filter((file) => isPathInScope(file, changedFiles));
  const outOfScope = errorFiles.filter((file) => !isPathInScope(file, changedFiles));
  return {
    passed: inScope.length === 0,
    inScopeErrorFiles: inScope,
    outOfScopeErrorFiles: outOfScope,
  };
}

/**
 * Extract the source files named by `tsc --noEmit` diagnostics. Handles both
 * pretty (`path/file.tsx:12:5 - error TS…`) and non-pretty
 * (`path/file.tsx(12,5): error TS…`) formats.
 */
export function extractTypecheckErrorFiles(typeCheckOutput: string): string[] {
  const files = new Set<string>();
  const pattern = /^(.+?\.[cm]?tsx?)[(:]\d+/gm;
  for (const match of typeCheckOutput.matchAll(pattern)) {
    const raw = match[1]?.trim();
    if (raw) files.add(raw.replace(/^\.\//, ""));
  }
  return [...files];
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
  // Treat a `.test.`/`.spec.` sibling as in-scope for its source file: a build
  // that changes `foo.ts` owns failures in `foo.test.ts` even when only the
  // source appears in the diffstat. Normalize both sides by stripping the
  // test/spec infix before the containment check.
  const norm = (p: string) => p.replace(/\.(test|spec)\.([cm]?[jt]sx?)$/, ".$2");
  const np = norm(path);
  return changedFiles.some((changed) => {
    const nc = norm(changed);
    return (
      path === changed
      || path.includes(changed)
      || changed.includes(path)
      || np === nc
      || np.includes(nc)
      || nc.includes(np)
    );
  });
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
