// apps/web/lib/build/finalize-stage-wiring.ts
//
// BI-A0521CB0: the real dependencies for runBuildStudioFinalize. Kept apart from
// the runner so the sequence stays testable without a sandbox or a model.

import { createHash } from "node:crypto";

import { runBuildStudioFinalize, type FinalizeOutcome } from "./finalize-stage-runner";
import type { GauntletBuild } from "./sandbox/run-and-record-gauntlet";

export type FinalizeBuild = GauntletBuild & { designDoc?: unknown };

export async function finalizeBuildForReview(build: FinalizeBuild): Promise<FinalizeOutcome> {
  const { prisma } = await import("@dpf/db");
  const { resolveBuildWorkdir } = await import("./sandbox/build-branch");
  const workdir = resolveBuildWorkdir(build.buildId);

  return runBuildStudioFinalize(build.buildId, {
    capture: async () => {
      const { captureAssembledChange } = await import("./capture-assembled-change");
      const { getSandboxStateForBuild } = await import("./sandbox-state");
      const capture = await captureAssembledChange({ buildId: build.buildId, containerId: build.sandboxId, persistSourceCurrency: true });
      const state = await getSandboxStateForBuild(build.buildId).catch(() => null);
      let changedFiles = state?.sourceDiffstat.map((entry) => entry.path) ?? [];
      if (changedFiles.length === 0) {
        const { listBuildChangedFiles } = await import("./deterministic-build-verification");
        const { execInSandbox } = await import("@/lib/sandbox");
        const { getClientIdentity } = await import("./sandbox/build-branch");
        const { clientBranch } = await getClientIdentity();
        changedFiles = await listBuildChangedFiles({ containerId: build.sandboxId, workdir, baseRef: clientBranch, exec: execInSandbox });
      }
      return { diffPatch: capture.diffPatch, changedFiles };
    },
    runGauntlet: async (diffPatch) => {
      const { runAndRecordGauntlet } = await import("./sandbox/run-and-record-gauntlet");
      return runAndRecordGauntlet(build, diffPatch);
    },
    llm: async (prompt) => {
      const { routeAndCall } = await import("@/lib/inference/routed-inference");
      const { buildPhaseRouteOptions } = await import("./build-phase-route-options");
      const response = await routeAndCall(
        [{ role: "user", content: prompt }],
        "You are a precise release engineer finishing a code change. Answer exactly in the requested format.",
        "development",
        buildPhaseRouteOptions({ taskType: "analysis", buildId: build.buildId }),
      );
      return response.content ?? "";
    },
    commitDecisions: async (lines) => {
      const { execInSandboxWithStdin } = await import("@/lib/sandbox");
      const message = `chore(${build.buildId}): record gate decisions\n\n${lines.join("\n")}\n`;
      await execInSandboxWithStdin(build.sandboxId, `cd '${workdir}' && git commit --allow-empty -s -F -`, message);
    },
    runScopedTests: async (changedFiles) => {
      const { runSandboxTests } = await import("./coding-agent");
      return runSandboxTests(build.sandboxId, { changedFiles, workdir });
    },
    recordTests: async ({ binding, changedFiles, result }) => {
      const { recordScopedTestsEvidence } = await import("./sandbox/run-and-record-gauntlet");
      return recordScopedTestsEvidence({ build, binding, changedFiles, result });
    },
    workroom: () => prisma.workroom.findFirst({
      where: { featureBuildId: build.id, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { id: true, capsuleId: true },
    }),
    resolveEvidence: async (ids, workroomId) => {
      const { resolveEvidenceByIds } = await import("@/lib/change-review/failure-analysis-evidence");
      return resolveEvidenceByIds(ids, workroomId);
    },
    // The design lives on the build record, not in a repo file; reference it by
    // content hash so the reviewer can tell which recorded design it was.
    designReference: async () =>
      `featureBuild/${build.buildId}/designDoc@${createHash("sha1").update(JSON.stringify(build.designDoc ?? {})).digest("hex")}`,
    saveFailureAnalysis: async (failureAnalysis) => {
      const row = await prisma.featureBuild.findUnique({ where: { id: build.id }, select: { verificationOut: true } });
      const current = row?.verificationOut && typeof row.verificationOut === "object" && !Array.isArray(row.verificationOut)
        ? row.verificationOut as Record<string, unknown>
        : {};
      await prisma.featureBuild.update({
        where: { id: build.id },
        data: { verificationOut: { ...current, failureAnalysis } as never },
      });
    },
    log: (summary) => {
      prisma.buildActivity.create({ data: { buildId: build.buildId, tool: "finalize", summary: summary.slice(0, 1000) } }).catch(() => {});
    },
  });
}
