"use server";

import { prisma } from "@dpf/db";

import { resolve } from "../deliberation/activation";
import { orchestrateDeliberation } from "../deliberation/orchestrator";
import { inngest } from "../queue/inngest-client";

type StartDeliberationInput = {
  userId: string;
  patternSlug: string;
  taskRunId?: string;
  artifactType:
    | "spec"
    | "plan"
    | "code-change"
    | "architecture-decision"
    | "policy"
    | "research-question";
  strategyProfile?:
    | "economy"
    | "balanced"
    | "high-assurance"
    | "document-authority";
  maxBranches?: number;
  budgetUsd?: number;
  stage?: "ideate" | "plan" | "build" | "review" | "ship";
  riskLevel?: "low" | "medium" | "high" | "critical";
  routeContext?: string;
  threadId?: string;
  buildId?: string;
  requestedAuthorityScope?: string[];
};

type DeliberationStatusInput = {
  deliberationRunId: string;
  userId: string;
};

type DeliberationOutcomeInput = {
  deliberationRunId: string;
  userId: string;
};

type OwnedRun = {
  id: string;
  taskRun: { userId: string };
};

async function requireUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isSuperuser: true },
  });

  if (!user) {
    throw new Error("Unauthorized: user not found.");
  }

  return user;
}

function ensureAuthorityWithinParent(
  parentAuthorityScope: string[] | null | undefined,
  requestedAuthorityScope: string[] | undefined,
) {
  if (!requestedAuthorityScope || requestedAuthorityScope.length === 0) {
    return;
  }

  const parent = new Set(parentAuthorityScope ?? []);
  for (const capability of requestedAuthorityScope) {
    if (capability === "read") continue;
    if (!parent.has(capability)) {
      throw new Error(
        `Requested authority exceeds parent authority scope: ${capability}.`,
      );
    }
  }
}

function countBranches(
  branchNodes: Array<{ status: string }> | null | undefined,
): { total: number; completed: number; failed: number; pending: number } {
  const nodes = branchNodes ?? [];
  const completed = nodes.filter((node) => node.status === "completed").length;
  const failed = nodes.filter((node) => node.status === "failed").length;
  const pending = nodes.length - completed - failed;

  return {
    total: nodes.length,
    completed,
    failed,
    pending,
  };
}

function summarizeEvidenceCoverage(
  claims: Array<{ evidenceGrade: string }> | null | undefined,
) {
  const totals = { A: 0, B: 0, C: 0, D: 0 };
  for (const claim of claims ?? []) {
    if (claim.evidenceGrade in totals) {
      totals[claim.evidenceGrade as keyof typeof totals] += 1;
    }
  }

  return {
    sourceBacked: totals.A + totals.B,
    mixed: totals.C,
    needsMoreEvidence: totals.D,
  };
}

function isDegradedDiversity(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata) return false;
  const actual = metadata["actualDiversity"];
  const requested = metadata["requestedDiversity"];
  return actual === "constrained" || (requested != null && actual != null && actual !== requested);
}

async function requireOwnedTaskRun(taskRunId: string, userId: string, isSuperuser: boolean) {
  const taskRun = await prisma.taskRun.findUnique({
    where: { taskRunId },
    select: {
      id: true,
      taskRunId: true,
      userId: true,
      authorityScope: true,
    },
  });

  if (!taskRun) {
    throw new Error(`TaskRun not found: ${taskRunId}.`);
  }

  if (!isSuperuser && taskRun.userId !== userId) {
    throw new Error("Not authorized to use that TaskRun.");
  }

  return taskRun;
}

async function requireOwnedDeliberationRun(
  deliberationRunId: string,
  userId: string,
  isSuperuser: boolean,
): Promise<OwnedRun> {
  // DeliberationRun.id is the PK (cuid). There is no separate
  // `deliberationRunId` column — input is the row id.
  const run = (await prisma.deliberationRun.findUnique({
    where: { id: deliberationRunId },
    select: {
      id: true,
      taskRun: { select: { userId: true } },
    },
  })) as OwnedRun | null;

  if (!run) {
    throw new Error(`Deliberation run not found: ${deliberationRunId}.`);
  }

  if (!isSuperuser && run.taskRun.userId !== userId) {
    throw new Error("Not authorized to access that deliberation run.");
  }

  return run;
}

export async function startDeliberation(input: StartDeliberationInput) {
  const user = await requireUser(input.userId);
  const taskRun = input.taskRunId
    ? await requireOwnedTaskRun(input.taskRunId, input.userId, user.isSuperuser)
    : null;

  ensureAuthorityWithinParent(taskRun?.authorityScope as string[] | null | undefined, input.requestedAuthorityScope);

  const resolved = await resolve({
    stage: input.stage,
    riskLevel: input.riskLevel ?? "low",
    explicitPatternSlug: input.patternSlug,
    artifactType: input.artifactType,
    routeContext: input.routeContext,
  });

  if (!resolved) {
    throw new Error("Activation declined: no deliberation pattern selected.");
  }

  const orchestration = await orchestrateDeliberation({
    userId: input.userId,
    taskRunId: input.taskRunId,
    threadId: input.threadId ?? null,
    buildId: input.buildId ?? null,
    patternSlug: resolved.patternSlug,
    artifactType: input.artifactType,
    triggerSource: resolved.triggerSource,
    strategyProfile: input.strategyProfile ?? resolved.strategyProfile,
    diversityMode: resolved.diversityMode,
    activatedRiskLevel: resolved.activatedRiskLevel,
    routeContext: input.routeContext,
    maxBranches: input.maxBranches,
    budgetUsd: input.budgetUsd ?? null,
    parentAuthorityScope:
      (taskRun?.authorityScope as string[] | null | undefined) ??
      input.requestedAuthorityScope ??
      ["read"],
  });

  // Fire the async runner — orchestrator persisted the graph, runner picks
  // it up and dispatches through the routing pipeline. Fail loud per project
  // memory "contribute_to_hive silent-success precedent".
  try {
    await inngest.send({
      name: "deliberation/run.start",
      data: {
        deliberationRunId: orchestration.deliberationRunId,
        taskRunId: orchestration.taskRunId,
        threadId: input.threadId ?? null,
        userId: input.userId,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `DeliberationRun ${orchestration.deliberationRunId} created but queue dispatch failed: ${message}`,
    );
  }

  return {
    deliberationRunId: orchestration.deliberationRunId,
    taskRunId: orchestration.taskRunId,
    triggerSource: resolved.triggerSource,
    reason: resolved.reason,
  };
}

export async function getDeliberationStatus(input: DeliberationStatusInput) {
  const user = await requireUser(input.userId);

  // DeliberationRun.id is the PK (cuid). There is no separate
  // `deliberationRunId` column — input is the row id.
  const hydratedRun = await prisma.deliberationRun.findUnique({
    where: { id: input.deliberationRunId },
    select: {
      id: true,
      consensusState: true,
      metadata: true,
      taskRun: { select: { userId: true } },
      branchNodes: {
        select: { id: true, status: true },
      },
    },
  });

  if (!hydratedRun) {
    throw new Error(`Deliberation run not found: ${input.deliberationRunId}.`);
  }

  if (!user.isSuperuser && hydratedRun.taskRun.userId !== input.userId) {
    throw new Error("Not authorized to access that deliberation run.");
  }

  const claims = await prisma.claimRecord.findMany({
    where: { deliberationRunId: hydratedRun.id },
    select: { evidenceGrade: true },
  });

  const metadata = (hydratedRun.metadata ?? null) as Record<string, unknown> | null;

  return {
    deliberationRunId: hydratedRun.id,
    consensusState: hydratedRun.consensusState,
    branchCounts: countBranches(hydratedRun.branchNodes),
    evidenceCoverage: summarizeEvidenceCoverage(claims),
    budgetHalted: metadata?.["budgetHalted"] === true,
    degradedDiversity: isDegradedDiversity(metadata),
  };
}

export async function getDeliberationOutcome(input: DeliberationOutcomeInput) {
  const user = await requireUser(input.userId);
  const run = await requireOwnedDeliberationRun(
    input.deliberationRunId,
    input.userId,
    user.isSuperuser,
  );

  const [outcomeRow, issueSetRow, claimRows, bundleRows] = await Promise.all([
    prisma.deliberationOutcome.findUnique({
      where: { deliberationRunId: run.id },
    }),
    prisma.deliberationIssueSet.findFirst({
      where: { deliberationRunId: run.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.claimRecord.findMany({
      where: { deliberationRunId: run.id },
      select: {
        id: true,
        claimType: true,
        claimText: true,
        status: true,
        evidenceGrade: true,
        confidence: true,
        branchNodeId: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.evidenceBundle.findMany({
      where: { deliberationRunId: run.id },
      select: {
        id: true,
        summary: true,
        sources: { select: { id: true } },
      },
    }),
  ]);

  return {
    outcome: outcomeRow,
    issueSet: issueSetRow,
    claims: claimRows.map((claim) => ({
      claimId: claim.id,
      claimType: claim.claimType,
      claimText: claim.claimText,
      status: claim.status,
      evidenceGrade: claim.evidenceGrade,
      confidence: claim.confidence,
      branchNodeId: claim.branchNodeId,
    })),
    evidenceBundles: bundleRows.map((bundle) => ({
      bundleId: bundle.id,
      summary: bundle.summary,
      sourceCount: bundle.sources.length,
    })),
  };
}

/**
 * autoApproveWhen predicate for the start_deliberation MCP tool.
 *
 * Pre-authorizes stage-default and risk-escalated invocations so the call
 * skips the proposal card. Explicit invocations still go through proposal
 * review. The predicate inspects the caller-supplied triggerSource param —
 * no DB lookup, no activation re-run, so it runs safely before the run row
 * exists.
 *
 * Per project memory "Proposal-mode tools stall autonomous runs" — callers
 * that the activation resolver already pre-authorized must not sit in
 * proposal limbo.
 */
export async function startDeliberationAutoApprove(input: {
  userId: string;
  params?: Record<string, unknown>;
}) {
  void input.userId;

  const raw = input.params?.["triggerSource"];
  return raw === "stage" || raw === "risk";
}
