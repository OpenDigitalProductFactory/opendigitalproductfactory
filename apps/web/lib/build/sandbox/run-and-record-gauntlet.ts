// apps/web/lib/build/sandbox/run-and-record-gauntlet.ts
//
// BI-A0521CB0: the guard-gauntlet step, reusable. Review verification ran it
// once inline; the finalize stage needs to run it again after recording gate
// decisions, and to record the scoped tests alongside it as bound evidence.

import type { SandboxTestResult } from "../coding-agent";

export type GauntletBuild = {
  id: string;
  buildId: string;
  createdById: string;
  sandboxId: string;
  buildBranch: string | null;
};

export type EvidenceBinding = { sha: string; headTreeHash: string; diffDigest: string };

export type GauntletRun =
  | { ran: false; reason: string }
  | {
    ran: true;
    passed: boolean;
    failedGuards: string[];
    output: string;
    recordId: string | null;
    binding: EvidenceBinding | null;
  };

/**
 * The identity a gauntlet verdict is recorded under: repository, the tree the
 * guards inspected, the guard plan, and the toolchain. One place, so a lookup
 * of a prior verdict keys exactly as the recording did (BI-FBA2FDBE).
 */
export async function gauntletIdentityFor(build: Pick<GauntletBuild, "sandboxId">, treeSha: string) {
  const { guardPlanDigest } = await import("./guard-gauntlet");
  const { toolchainFingerprintFrom, resolveGauntletRepository } = await import("./guard-gauntlet-evidence");
  const { execInSandbox } = await import("@/lib/sandbox");
  const toolchain = await execInSandbox(build.sandboxId, "node -v 2>/dev/null; pnpm -v 2>/dev/null").catch(() => "");
  const [node, pnpm] = toolchain.split(/\r?\n/);
  return {
    repository: resolveGauntletRepository(),
    treeSha,
    guardPlanDigest: guardPlanDigest("scripts/pregate-preflight.mjs"),
    toolchainFingerprint: toolchainFingerprintFrom({ node, pnpm }),
  };
}

/** The gate key a gauntlet run on the build's worktree would be recorded under now, or null. */
export async function currentGauntletGateKey(build: Pick<GauntletBuild, "buildId" | "sandboxId">): Promise<string | null> {
  const { readWorktreeTreeSha } = await import("./guard-gauntlet");
  const { deriveGauntletGateKey } = await import("./guard-gauntlet-evidence");
  const { resolveBuildWorkdir } = await import("./build-branch");
  const { execInSandbox } = await import("@/lib/sandbox");
  const treeSha = await readWorktreeTreeSha(execInSandbox, build.sandboxId, resolveBuildWorkdir(build.buildId));
  return treeSha ? deriveGauntletGateKey(await gauntletIdentityFor(build, treeSha)) : null;
}

/** Run the gauntlet in the build's worktree, stamp the Workroom head, record bound evidence. */
export async function runAndRecordGauntlet(build: GauntletBuild, diffPatch: string | null): Promise<GauntletRun> {
  const { runGuardGauntlet } = await import("./guard-gauntlet");
  const {
    buildGauntletEvidence, summarizeGauntlet, resolveInPlatformEvidenceBinding,
  } = await import("./guard-gauntlet-evidence");
  const { resolveBuildWorkdir } = await import("./build-branch");
  const { execInSandbox } = await import("@/lib/sandbox");
  const { recordLocalIntegrationResult } = await import("@/lib/nonprod/local-integration");
  const { getSandboxStateForBuild } = await import("@/lib/build/sandbox-state");
  const { prisma } = await import("@dpf/db");

  const workdir = resolveBuildWorkdir(build.buildId);
  // The sandbox repo is shallow; without a merge base every guard runs unscoped
  // and the diff guards judge changes this build never made.
  // Fetches run through the serialized sandbox git path, which also clears
  // stale .git locks, and a failure is recorded rather than swallowed
  // (BI-E4AD091E).
  const { ensureMergeBaseWithMain } = await import("./ensure-merge-base");
  const { wrapSandboxGitCommand } = await import("./build-branch");
  const mergeBase = await ensureMergeBaseWithMain({
    exec: (containerId, command) => execInSandbox(containerId, wrapSandboxGitCommand(command)),
    containerId: build.sandboxId,
    workdir,
  });
  if (!mergeBase.found) {
    await prisma.buildActivity.create({
      data: {
        buildId: build.buildId,
        tool: "merge_base",
        summary: `No merge base with origin/main after ${mergeBase.deepened} deepen round(s)${mergeBase.fetchError ? `: ${mergeBase.fetchError}` : ""}. Diff-scoped guards cannot run.`,
      },
    }).catch(() => {});
  }
  const outcome = await runGuardGauntlet({ exec: execInSandbox, containerId: build.sandboxId, workdir });
  // Could-not-run is not a failing verdict, and must not be recorded as one.
  if (!outcome.ran) return { ran: false, reason: outcome.reason };
  if (!outcome.treeSha) {
    return { ran: true, passed: outcome.passed, failedGuards: outcome.failedGuards, output: outcome.output, recordId: null, binding: null };
  }

  const identity = await gauntletIdentityFor(build, outcome.treeSha);

  // BI-AF531123: bind to this build's Workroom and exact head so a failure
  // analysis can cite the record.
  const state = await getSandboxStateForBuild(build.buildId).catch(() => null);
  const branch = build.buildBranch ?? `build/${build.buildId}`;
  const binding = resolveInPlatformEvidenceBinding({
    headSha: state?.headSha,
    headTreeHash: state?.sourceCurrency?.headTreeSha,
    diffPatch,
  }) ?? null;
  if (binding) {
    await prisma.workroom.updateMany({
      where: { featureBuildId: build.id, archivedAt: null },
      data: { headBranch: branch, headSha: binding.sha },
    });
  }

  const record = await recordLocalIntegrationResult({
    actorUserId: build.createdById,
    provider: "build-studio",
    externalSessionId: build.buildId,
    routeContext: "/build",
    buildId: build.buildId,
    candidateBranch: branch,
    mode: "single-branch",
    status: outcome.passed ? "passed" : "failed",
    summary: summarizeGauntlet({ passed: outcome.passed, failedGuards: outcome.failedGuards, treeSha: outcome.treeSha }),
    evidence: buildGauntletEvidence({
      identity,
      workdir: outcome.workdir,
      passed: outcome.passed,
      failedGuards: outcome.failedGuards,
      output: outcome.output,
      durationMs: outcome.durationMs,
      ...(binding ? { binding } : {}),
    }),
  });
  return {
    ran: true,
    passed: outcome.passed,
    failedGuards: outcome.failedGuards,
    output: outcome.output,
    recordId: (record as { id?: string } | null)?.id ?? null,
    binding,
  };
}

/**
 * Record a deterministic scoped test run as bound in-platform evidence, so a
 * failure analysis can cite executed unit tests, not only guards.
 */
export async function recordScopedTestsEvidence(input: {
  build: GauntletBuild;
  binding: EvidenceBinding;
  changedFiles: string[];
  result: SandboxTestResult;
}): Promise<string | null> {
  const { recordLocalIntegrationResult } = await import("@/lib/nonprod/local-integration");
  const { IN_PLATFORM_EVIDENCE_VALIDITY_MS } = await import("./guard-gauntlet-evidence");
  const passed = input.result.passed && input.result.typeCheckPassed;
  const completedAt = new Date();
  const ran = scopedTestsRunDescription(input.changedFiles, input.result);
  const record = await recordLocalIntegrationResult({
    actorUserId: input.build.createdById,
    provider: "build-studio",
    externalSessionId: input.build.buildId,
    routeContext: "/build",
    buildId: input.build.buildId,
    candidateBranch: input.build.buildBranch ?? `build/${input.build.buildId}`,
    mode: "single-branch",
    status: passed ? "passed" : "failed",
    summary: `Scoped tests ${passed ? "passed" : "failed"} (${input.result.scope ?? "full"}) for tree ${input.binding.headTreeHash.slice(0, 12)}`,
    evidence: {
      tier: "in-platform-scoped-tests",
      coverage: ran.coverage,
      ...input.binding,
      commands: ran.commands,
      output: `${input.result.testOutput.slice(-3000)}\n${input.result.typeCheckOutput.slice(-1000)}`.trim() || "no output",
      completedAt: completedAt.toISOString(),
      evidenceValidity: { expiresAt: new Date(completedAt.getTime() + IN_PLATFORM_EVIDENCE_VALIDITY_MS).toISOString() },
      passed,
      gatePassed: passed,
    },
  });
  return (record as { id?: string } | null)?.id ?? null;
}

/**
 * BI-CEE688D6: what the scoped-test run actually covered, never more. The
 * record used to claim unit tests and a vitest command whether or not any test
 * ran, and a typecheck of apps/web for a change outside it.
 */
export function scopedTestsRunDescription(
  changedFiles: readonly string[],
  result: Pick<SandboxTestResult, "scope" | "scopedTestsRun">,
): {
  coverage: { guards: false; typecheck: boolean; unitTests: boolean; productionBuild: false; image: false };
  commands: string[];
} {
  const typecheck = changedFiles.some((f) => f.startsWith("apps/web/"));
  const unitTests = result.scope === "scoped" && (result.scopedTestsRun ?? 0) > 0;
  return {
    coverage: { guards: false, typecheck, unitTests, productionBuild: false, image: false },
    commands: [
      typecheck
        ? "tsc --noEmit (apps/web, gated on errors in the changed files)"
        : "tsc --noEmit (apps/web) — none of the changed files are in apps/web, so it does not cover this change",
      unitTests
        ? `vitest run (${result.scopedTestsRun} test file(s) covering the changed files)`
        : result.scope === "none"
          ? "no tests ran: no test file covers the changed files"
          : "full test suite (informational; not gated)",
    ],
  };
}
