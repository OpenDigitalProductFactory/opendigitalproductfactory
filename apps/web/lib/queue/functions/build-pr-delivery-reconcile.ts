import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

export const BUILD_PR_DELIVERY_RECONCILE_CRON = "2,7,12,17,22,27,32,37,42,47,52,57 * * * *";

export async function runBuildPrDeliveryReconcile(): Promise<{
  observed: number;
  actuated: number;
  escalated: number;
  compareAndSwapLost: number;
}> {
  const { prisma } = await import("@dpf/db");
  const {
    resolveGithubToken,
  } = await import("@/lib/contributor-change-lanes/github-rest-reader");
  const {
    observeGithubPullRequest,
    projectGithubPrReadiness,
  } = await import("@/lib/build/github-pr-readiness");
  const {
    executeBuildPrDeliveryAction,
    resolveBuildPrReconcilerMode,
  } = await import("@/lib/build/build-pr-delivery-reconciler");
  const {
    createBuildPrDeliveryState,
    readBuildPrDeliveryState,
    writeBuildPrDeliveryState,
  } = await import("@/lib/build/build-pr-delivery-state");

  const mode = resolveBuildPrReconcilerMode();
  if (mode === "off") return { observed: 0, actuated: 0, escalated: 0, compareAndSwapLost: 0 };

  const token = await resolveGithubToken(
    prisma as unknown as Parameters<typeof resolveGithubToken>[0],
  );
  if (!token) throw new Error("Build PR delivery reconcile: GitHub credential unavailable");

  const capsules = await prisma.workroom.findMany({
    where: {
      featureBuildId: { not: null },
      pullRequestNumber: { not: null },
      pullRequestUrl: { not: null },
      status: { notIn: ["complete", "abandoned", "archived"] },
    },
    select: {
      id: true,
      capsuleId: true,
      featureBuildId: true,
      repositoryFullName: true,
      pullRequestNumber: true,
      pullRequestUrl: true,
      workspaceState: true,
      updatedAt: true,
    },
    take: 25,
    orderBy: { updatedAt: "asc" },
  });

  let observed = 0;
  let actuated = 0;
  let escalated = 0;
  let compareAndSwapLost = 0;

  for (const capsule of capsules) {
    const prNumber = capsule.pullRequestNumber;
    const prUrl = capsule.pullRequestUrl;
    if (!prNumber || !prUrl || !capsule.featureBuildId) continue;
    const existing = readBuildPrDeliveryState(capsule.workspaceState);
    if (
      existing?.status === "escalated" ||
      existing?.status === "closed" ||
      existing?.status === "deployed"
    ) {
      continue;
    }
    const repository = existing?.repository || capsule.repositoryFullName || (() => {
      try {
        return new URL(prUrl).pathname.split("/").filter(Boolean).slice(0, 2).join("/");
      } catch {
        return "";
      }
    })();
    const [owner, repo] = repository.split("/");
    if (!owner || !repo) continue;
    const state = existing ?? createBuildPrDeliveryState({ repository, prNumber, prUrl });

    try {
      const { getAutonomousPlaybookMode } = await import(
        "@/lib/build/build-studio-config"
      );
      const autonomousMode = getAutonomousPlaybookMode();
      let semanticBuildId: string | null = null;
      if (autonomousMode !== "off") {
        semanticBuildId = (
          await prisma.featureBuild.findUnique({
            where: { id: capsule.featureBuildId },
            select: { buildId: true },
          })
        )?.buildId ?? null;
        if (!semanticBuildId && autonomousMode === "enforce") {
          throw new Error("autonomous_pr_build_identity_missing");
        }
        if (semanticBuildId) {
          const { resolveAutonomousBuildPhaseEligibility } = await import(
            "@/lib/build/autonomous-build-phase-runtime"
          );
          const autonomy = await resolveAutonomousBuildPhaseEligibility({
            buildId: semanticBuildId,
            checkpoint: "pr",
            gateOutcome: "recommend",
            deliveryStatusOverride: state.status,
          });
          if (autonomousMode === "enforce" && !autonomy.mayAct) {
            const blockedState = {
              ...state,
              status: "escalated" as const,
              escalationKey:
                state.escalationKey
                ?? `build-pr-delivery:${prNumber}:autonomous-eligibility-withheld`,
              lastError:
                autonomy.eligibility.blockers.join(",")
                || "autonomous-eligibility-withheld",
            };
            const saved = await prisma.workroom.updateMany({
              where: { id: capsule.id, updatedAt: capsule.updatedAt },
              data: {
                workspaceState: writeBuildPrDeliveryState(
                  capsule.workspaceState,
                  blockedState,
                ) as unknown as import("@dpf/db").Prisma.InputJsonValue,
              },
            });
            if (saved.count === 0) compareAndSwapLost += 1;
            else escalated += 1;
            continue;
          }
        }
      }
      const observation = await observeGithubPullRequest({ owner, repo, prNumber, token });
      observed += 1;
      const readiness = projectGithubPrReadiness(observation);
      const outcome = await executeBuildPrDeliveryAction({
        state,
        observation,
        readiness,
        mode,
        token,
        owner,
        repo,
      });
      if (outcome.actuated) actuated += 1;

      const saved = await prisma.workroom.updateMany({
        where: { id: capsule.id, updatedAt: capsule.updatedAt },
        data: {
          workspaceState: writeBuildPrDeliveryState(
            capsule.workspaceState,
            outcome.state,
          ) as unknown as import("@dpf/db").Prisma.InputJsonValue,
          headSha: outcome.state.lastObservedHeadSha,
        },
      });
      if (saved.count === 0) {
        compareAndSwapLost += 1;
        continue;
      }

      if (
        semanticBuildId
        && outcome.state.status === "awaiting-release"
      ) {
        const { resolveAutonomousBuildPhaseEligibility } = await import(
          "@/lib/build/autonomous-build-phase-runtime"
        );
        await resolveAutonomousBuildPhaseEligibility({
          buildId: semanticBuildId,
          checkpoint: "release",
          gateOutcome: "recommend",
          deliveryStatusOverride: "awaiting-release",
        }).catch(() => {});
      }

      if (
        outcome.action.kind === "escalate" &&
        state.escalationKey !== outcome.state.escalationKey
      ) {
        const { createPlatformIssueReport } = await import("@/lib/quality/platform-issue-reports");
        await createPlatformIssueReport({
          type: "build-stall-escalation",
          source: "build-studio",
          severity: "high",
          title: `Build Studio needs a PR delivery decision: #${prNumber}`,
          description:
            `Build Studio stopped autonomous PR delivery for ${capsule.capsuleId}.\n\n` +
            `Reason: ${outcome.action.reason}\nHead: ${outcome.action.headSha ?? "unknown"}\nPR: ${prUrl}\n\n` +
            "No direct merge, force-push, or automatic conflict edit was attempted.",
          featureBuildId: capsule.featureBuildId,
          triggerKind: "build-pr-delivery-reconcile",
          dedupeKey: outcome.state.escalationKey ?? `build-pr-delivery:${prNumber}`,
          selfFixClass: "needs-human",
        });
        escalated += 1;
      }
    } catch (error) {
      const failed = {
        ...state,
        reconciliationAttempts: state.reconciliationAttempts + 1,
        lastObservedAt: new Date().toISOString(),
        lastError: String(error instanceof Error ? error.message : error).slice(0, 240),
      };
      const saved = await prisma.workroom.updateMany({
        where: { id: capsule.id, updatedAt: capsule.updatedAt },
        data: {
          workspaceState: writeBuildPrDeliveryState(
            capsule.workspaceState,
            failed,
          ) as unknown as import("@dpf/db").Prisma.InputJsonValue,
        },
      });
      if (saved.count === 0) compareAndSwapLost += 1;
    }
  }

  return { observed, actuated, escalated, compareAndSwapLost };
}

export const buildPrDeliveryReconcile = inngest.createFunction(
  {
    id: "build/pr-delivery-reconcile",
    retries: 2,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron(BUILD_PR_DELIVERY_RECONCILE_CRON)],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "build/pr-delivery-reconcile");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("reconcile-build-pr-delivery", runBuildPrDeliveryReconcile);
  },
);
