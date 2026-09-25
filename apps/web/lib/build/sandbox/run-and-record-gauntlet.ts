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

/** Run the gauntlet in the build's worktree, stamp the Workroom head, record bound evidence. */
export async function runAndRecordGauntlet(build: GauntletBuild, diffPatch: string | null): Promise<GauntletRun> {
  const { runGuardGauntlet, guardPlanDigest } = await import("./guard-gauntlet");
  const {
    buildGauntletEvidence, summarizeGauntlet, toolchainFingerprintFrom, resolveGauntletRepository, resolveInPlatformEvidenceBinding,
  } = await import("./guard-gauntlet-evidence");
  const { resolveBuildWorkdir } = await import("./build-branch");
  const { execInSandbox } = await import("@/lib/sandbox");
  const { recordLocalIntegrationResult } = await import("@/lib/nonprod/local-integration");
  const { getSandboxStateForBuild } = await import("@/lib/build/sandbox-state");
  const { prisma } = await import("@dpf/db");

  const workdir = resolveBuildWorkdir(build.buildId);
  const outcome = await runGuardGauntlet({ exec: execInSandbox, containerId: build.sandboxId, workdir });
  // Could-not-run is not a failing verdict, and must not be recorded as one.
  if (!outcome.ran) return { ran: false, reason: outcome.reason };
  if (!outcome.treeSha) {
    return { ran: true, passed: outcome.passed, failedGuards: outcome.failedGuards, output: outcome.output, recordId: null, binding: null };
  }

  const toolchain = await execInSandbox(build.sandboxId, "node -v 2>/dev/null; pnpm -v 2>/dev/null").catch(() => "");
  const [node, pnpm] = toolchain.split(/\r?\n/);
  const identity = {
    repository: resolveGauntletRepository(),
    treeSha: outcome.treeSha,
    guardPlanDigest: guardPlanDigest("scripts/pregate-preflight.mjs"),
    toolchainFingerprint: toolchainFingerprintFrom({ node, pnpm }),
  };

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
      coverage: { guards: false, typecheck: true, unitTests: true, productionBuild: false, image: false },
      ...input.binding,
      commands: [
        "npx tsc --noEmit (apps/web, scoped to changed files)",
        `vitest run ${input.changedFiles.filter((f) => /\.test\.(ts|tsx|mjs)$/.test(f)).join(" ") || "(scoped feature tests)"}`,
      ],
      output: `${input.result.testOutput.slice(-3000)}\n${input.result.typeCheckOutput.slice(-1000)}`.trim() || "no output",
      completedAt: completedAt.toISOString(),
      evidenceValidity: { expiresAt: new Date(completedAt.getTime() + IN_PLATFORM_EVIDENCE_VALIDITY_MS).toISOString() },
      passed,
      gatePassed: passed,
    },
  });
  return (record as { id?: string } | null)?.id ?? null;
}
