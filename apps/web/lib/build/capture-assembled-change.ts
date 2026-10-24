// Capture a build's assembled change — the releasable diff, the commits ahead
// of the client branch, the post-commit source identity and the plain-language
// narrative — onto the FeatureBuild row. This is the single capture every
// downstream reader depends on: the build→review gate, the semantic change
// review (which refuses without a committed head/base tree and an exact diff),
// the release panel and the contribution flow.
//
// It was born inside the legacy pipeline's completion step and only ran there.
// The orchestrated build path advanced build→review without it, so every
// orchestrated build reached review with diffPatch=NULL and the semantic
// review answered "unavailable" forever. Now both paths call this one primitive.

import type { SandboxSourceCurrencySnapshot } from "./sandbox/sandbox-source-currency";

export type AssembledChangeCapture = {
  diffPatch: string;
  commitHashes: string[];
  sourceCurrency: SandboxSourceCurrencySnapshot | null;
};

/**
 * Commit any in-flight task output on the build branch, then record the diff,
 * commit hashes, source identity and narrative on the FeatureBuild row.
 * Idempotent: re-running against an unchanged tree records the same values.
 *
 * `persistSourceCurrency` folds the post-commit source identity into
 * `buildExecState.sourceCurrency`, the seam sandbox-state reads for callers
 * that do not carry a pipeline state of their own (the review phase).
 */
export async function captureAssembledChange(args: {
  buildId: string;
  containerId: string;
  persistSourceCurrency?: boolean;
}): Promise<AssembledChangeCapture> {
  const { buildId, containerId } = args;
  const { prisma } = await import("@dpf/db");
  const { extractDiff, execInSandbox, listSandboxCommitsAheadOfBase } = await import(
    "./sandbox/sandbox"
  );
  const { getClientIdentity, resolveBuildWorkdir, buildSandboxCommitInFlightWorkCommand } =
    await import("./sandbox/build-branch");

  const identity = await getClientIdentity();
  const baseRef = identity.clientBranch;
  // Extract the diff from the build's working dir: its own worktree when
  // isolation is on, else /workspace (default — byte-identical). BI-98B723C0 2c.
  const buildWorkdir = resolveBuildWorkdir(buildId);

  // BI-53C14D19: the per-task coding agents WRITE files into the working tree
  // but do not COMMIT them, so listSandboxCommitsAheadOfBase() below would
  // capture 0 commits and the build would strand at deploy/ship with "no
  // releasable source changes" (working tree dirty) — the generated code sat
  // uncommitted and was lost on the next branch scrub. Commit any in-flight
  // task output onto the build branch here, before capture. Best-effort and
  // build/-branch-scoped (the helper no-ops off a build/ branch and excludes
  // generated artifacts), so a no-op or failure never blocks completion.
  await execInSandbox(
    containerId,
    buildSandboxCommitInFlightWorkCommand(buildWorkdir),
  ).catch((err: unknown) => {
    console.warn(
      "[assembled-change] pre-capture in-flight commit failed (best-effort):",
      (err as Error)?.message,
    );
  });

  const [fullDiff, commitHashes] = await Promise.all([
    extractDiff(containerId, { baseRef, workspace: buildWorkdir }),
    listSandboxCommitsAheadOfBase(containerId, baseRef, buildWorkdir),
  ]);

  // Branch-start currency is stale once task output is committed.
  const { refreshCommittedSourceCurrency } = await import("./sandbox/refresh-source-currency");
  const sourceCurrency = await refreshCommittedSourceCurrency({
    workspace: buildWorkdir,
    targetRef: baseRef,
    exec: (command) => execInSandbox(containerId, command),
  });
  // BI-D93CF6C0 — generate the plain-language change narrative (Band 2 of the
  // overseer layer) from the goal + plan + diff. Best-effort: a null result just
  // falls back to the raw diffSummary dive-in, so this never blocks completion.
  let changeNarrative:
    | import("@/lib/feature-build-types").BuildChangeNarrative
    | null = null;
  try {
    const buildRow = await prisma.featureBuild.findUnique({
      where: { buildId },
      select: { title: true, designDoc: true, buildPlan: true },
    });
    if (buildRow) {
      const designDoc = buildRow.designDoc as
        | { problemStatement?: string; proposedApproach?: string }
        | null;
      const { generateChangeNarrative } = await import("./change-narrative");
      changeNarrative = await generateChangeNarrative({
        title: buildRow.title,
        goal: designDoc?.problemStatement ?? designDoc?.proposedApproach ?? null,
        planText: buildRow.buildPlan ? JSON.stringify(buildRow.buildPlan) : null,
        diff: fullDiff,
      });
    }
  } catch (err) {
    console.warn(
      "[assembled-change] change-narrative generation skipped:",
      (err as Error)?.message,
    );
  }

  await prisma.featureBuild.update({
    where: { buildId },
    data: {
      diffPatch: fullDiff,
      diffSummary: fullDiff.slice(0, 500),
      gitCommitHashes: commitHashes,
      ...(changeNarrative
        ? {
            changeNarrative:
              changeNarrative as unknown as import("@dpf/db").Prisma.InputJsonValue,
          }
        : {}),
    },
  });

  console.log(
    `[assembled-change] captured ${fullDiff.length} bytes diff + ${commitHashes.length} commits for ${JSON.stringify(buildId)}`,
  );


  if (args.persistSourceCurrency && sourceCurrency) {
    const row = await prisma.featureBuild.findUnique({
      where: { buildId },
      select: { buildExecState: true },
    });
    const existing =
      row?.buildExecState && typeof row.buildExecState === "object" && !Array.isArray(row.buildExecState)
        ? (row.buildExecState as Record<string, unknown>)
        : {};
    await prisma.featureBuild.update({
      where: { buildId },
      data: {
        buildExecState: { ...existing, sourceCurrency } as unknown as import("@dpf/db").Prisma.InputJsonValue,
      },
    });
  }

  return { diffPatch: fullDiff, commitHashes, sourceCurrency };
}
