import { cron } from "@/lib/jobs/triggers";
import { jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";
import { selectPrDeliveryRooms } from "./build-pr-delivery-selection";
import type { BuildPrDeliveryStateV1 } from "@/lib/build/build-pr-delivery-state";
import type { PrRepairPacket } from "@/lib/build/pr-follow-through";

export const BUILD_PR_DELIVERY_RECONCILE_CRON = "2,7,12,17,22,27,32,37,42,47,52,57 * * * *";

/**
 * PR follow-through is a Workroom duty (BI-88341B5D): every non-terminal room
 * with a bound PR is reconciled here, whichever client opened the PR. Build
 * Studio rooms keep their autonomy-eligibility check; every other room acts
 * within its own posture (resolvePrFollowThroughPosture).
 */
/**
 * Whether an observed PR head belongs to the room's current source (#6148): a
 * PR still showing the head a room held before it was re-adopted elsewhere is
 * stale and must not be actuated. One move is the room's own doing and is
 * followed (BI-ECA50241): after this reconciler had GitHub update the branch
 * from the room's head, the PR head is GitHub's merge commit. Refusing that
 * froze the room in "updating" forever.
 */
export function observesRoomHead(
  roomHeadSha: string | null | undefined,
  observedHeadSha: string,
  state: Pick<BuildPrDeliveryStateV1, "status" | "lastObservedHeadSha"> | null | undefined,
): boolean {
  if (!roomHeadSha) return true;
  const room = roomHeadSha.toLowerCase();
  if (observedHeadSha.toLowerCase() === room) return true;
  return state?.status === "updating" && state.lastObservedHeadSha?.toLowerCase() === room;
}

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
    rerunFailedWorkflowJobs,
  } = await import("@/lib/build/github-pr-readiness");
  const { refreshFailureReadinessForDelivery } = await import("@/lib/build/failure-readiness-delivery-refresh");
  const { checkWorkroomFailureReadiness } = await import("@/lib/change-review/failure-readiness-publication");
  const { publishFailureReadinessStatus } = await import("@/lib/change-review/failure-readiness-status");
  const {
    executeBuildPrDeliveryAction,
    resolveBuildPrReconcilerMode,
  } = await import("@/lib/build/build-pr-delivery-reconciler");
  const {
    createBuildPrDeliveryState,
    readBuildPrDeliveryState,
    writeBuildPrDeliveryState,
  } = await import("@/lib/build/build-pr-delivery-state");
  const {
    announcePrFollowThrough,
    resolvePrFollowThroughPosture,
  } = await import("@/lib/build/pr-follow-through-announce");
  const { getWorkroomPostureDefault } = await import("@/lib/work-management/workroom-posture-defaults");
  const { createPlatformIssueReport } = await import("@/lib/quality/platform-issue-reports");
  const { MAX_UNKNOWN_OBSERVATIONS, resumeClearedEscalation } = await import("@/lib/build/build-pr-delivery-recheck");

  const mode = resolveBuildPrReconcilerMode();
  if (mode === "off") return { observed: 0, actuated: 0, escalated: 0, compareAndSwapLost: 0 };

  const token = await resolveGithubToken(
    prisma as unknown as Parameters<typeof resolveGithubToken>[0],
  );
  if (!token) throw new Error("Build PR delivery reconcile: GitHub credential unavailable");

  const platformDefaultActionBoundary = (await getWorkroomPostureDefault())?.actionBoundary ?? null;

  const capsules = await selectPrDeliveryRooms(prisma);

  let observed = 0;
  let actuated = 0;
  let escalated = 0;
  let compareAndSwapLost = 0;

  for (const capsule of capsules) {
    const prNumber = capsule.pullRequestNumber;
    const prUrl = capsule.pullRequestUrl;
    if (!prNumber || !prUrl) continue;
    const existing = readBuildPrDeliveryState(capsule.workspaceState);
    const repository = existing?.repository || capsule.repositoryFullName || (() => {
      try {
        return new URL(prUrl).pathname.split("/").filter(Boolean).slice(0, 2).join("/");
      } catch {
        return "";
      }
    })();
    const [owner, repo] = repository.split("/");
    if (!owner || !repo) continue;
    let state = existing ?? createBuildPrDeliveryState({ repository, prNumber, prUrl });

    try {
      const { getAutonomousPlaybookMode } = await import(
        "@/lib/build/build-studio-config"
      );
      const autonomousMode = getAutonomousPlaybookMode();
      let semanticBuildId: string | null = null;
      if (capsule.featureBuildId && autonomousMode !== "off") {
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
      let observation = await observeGithubPullRequest({ owner, repo, prNumber, token });
      observed += 1;
      if (!observesRoomHead(capsule.headSha, observation.headSha, existing)) continue;
      let readiness = projectGithubPrReadiness(observation);
      // BI-0EDCF2EC: a stopped room the selector handed back is looked at again.
      // A stop whose cause still holds only records that it looked.
      const recheck = resumeClearedEscalation(state, readiness);
      if (recheck.kind === "not-reevaluable") continue;
      if (recheck.kind === "holds") {
        const looked = await prisma.workroom.updateMany({
          where: { id: capsule.id, updatedAt: capsule.updatedAt },
          data: {
            workspaceState: writeBuildPrDeliveryState(capsule.workspaceState, {
              ...state,
              lastObservedAt: new Date().toISOString(),
            }) as unknown as import("@dpf/db").Prisma.InputJsonValue,
          },
        });
        if (looked.count === 0) compareAndSwapLost += 1;
        continue;
      }
      const resumedFrom = recheck.kind === "cleared" ? recheck.reason : null;
      if (recheck.kind === "cleared") state = recheck.state;
      const posture = resolvePrFollowThroughPosture({
        scopeClaims: capsule.scopeClaims,
        executorKind: capsule.executorKind,
        platformDefaultActionBoundary,
      });
      // Build Studio rooms were gated by autonomy eligibility above.
      const actuationAllowed = capsule.featureBuildId ? true : posture.actuationAllowed;
      if (mode === "enforce" && actuationAllowed) {
        // A passed review's status expires after an hour (BI-4D0B2AAB); refresh
        // it from the server verdict before queueing or when it is the only red check.
        const refresh = await refreshFailureReadinessForDelivery({
          observation,
          readiness,
          verdict: () => checkWorkroomFailureReadiness(capsule.capsuleId),
          publish: () => publishFailureReadinessStatus(capsule.capsuleId),
          rerun: (workflowRunId) => rerunFailedWorkflowJobs({ owner, repo, workflowRunId, token }),
        });
        readiness = refresh.readiness;
        if (refresh.observeAgain) {
          observation = await observeGithubPullRequest({ owner, repo, prNumber, token });
          if (!observesRoomHead(capsule.headSha, observation.headSha, existing)) continue;
          readiness = projectGithubPrReadiness(observation);
        }
      }
      const outcome = await executeBuildPrDeliveryAction({
        state,
        observation,
        readiness,
        mode,
        token,
        owner,
        repo,
        actuationAllowed,
        // BI-085A37EC (WWMD DI-8172B1A35993, design §8): a Build Studio build
        // repairs through its own bounded loop and pushes a fast-forward
        // follow-up commit, so its room dispatches unless it is quiet or
        // advise-only. Other rooms keep their posture and have no dispatcher.
        repairAuthority: capsule.featureBuildId && posture.authority !== "record" ? "dispatch" : posture.authority,
        ...(capsule.featureBuildId
          ? {
              dispatchRepair: async (packet: PrRepairPacket) => {
                const buildId = semanticBuildId ?? (await prisma.featureBuild.findUnique({
                  where: { id: capsule.featureBuildId! },
                  select: { buildId: true },
                }))?.buildId;
                if (!buildId) return "unavailable" as const;
                const { dispatchBuildPrCiRepair } = await import("@/lib/build/pr-ci-repair");
                return dispatchBuildPrCiRepair({ buildId, packet, github: { owner, repo, token } });
              },
            }
          : {}),
      });
      if (outcome.actuated) actuated += 1;

      const saved = await prisma.workroom.updateMany({
        where: { id: capsule.id, updatedAt: capsule.updatedAt },
        data: {
          workspaceState: writeBuildPrDeliveryState(
            capsule.workspaceState,
            outcome.state,
          ) as unknown as import("@dpf/db").Prisma.InputJsonValue,
          // Never erase a room's recorded head on an observation that lacked one.
          ...(outcome.state.lastObservedHeadSha ? { headSha: outcome.state.lastObservedHeadSha } : {}),
        },
      });
      if (saved.count === 0) {
        compareAndSwapLost += 1;
        continue;
      }

      if (resumedFrom) {
        await prisma.workroomActivity.create({
          data: {
            workCapsuleId: capsule.id,
            kind: "workroom-pr-delivery-resumed",
            summary: `PR #${prNumber} delivery resumed: the stop (${resumedFrom}) no longer holds; GitHub now reports ${readiness.kind}.`,
            payload: { prNumber, clearedStop: resumedFrom, readiness: readiness.kind, headSha: observation.headSha } as import("@dpf/db").Prisma.InputJsonValue,
          },
        });
      }
      if (outcome.state.unknownObservations === MAX_UNKNOWN_OBSERVATIONS) {
        // Told once per head; the room keeps observing under its backoff.
        const surface = capsule.featureBuildId ? "Build Studio" : `Workroom ${capsule.capsuleId}`;
        await createPlatformIssueReport({
          type: "build-stall-escalation",
          source: capsule.featureBuildId ? "build-studio" : "workroom-pr-follow-through",
          severity: "medium",
          title: `${surface}: GitHub has not decided PR #${prNumber}'s merge state`,
          description:
            `GitHub reported an undecided merge state for PR #${prNumber} (${capsule.capsuleId}) ` +
            `${MAX_UNKNOWN_OBSERVATIONS} times in a row at head ${outcome.state.lastObservedHeadSha ?? "unknown"}. ` +
            `The room keeps observing at up to hourly intervals and continues on its own once GitHub decides.\nPR: ${prUrl}`,
          featureBuildId: capsule.featureBuildId,
          triggerKind: "build-pr-delivery-reconcile",
          dedupeKey: `build-pr-delivery:${prNumber}:merge-state-undecided:${outcome.state.lastObservedHeadSha ?? "unknown"}`,
        });
      }

      await announcePrFollowThrough({
        room: { id: capsule.id, capsuleId: capsule.capsuleId, featureBuildId: capsule.featureBuildId, prNumber, prUrl },
        priorAttentionKey: state.followThrough.attentionKey,
        decision: outcome.followThrough,
        deps: {
          recordActivity: async (activity) => {
            await prisma.workroomActivity.create({
              data: {
                workCapsuleId: activity.roomId,
                kind: activity.kind,
                summary: activity.summary,
                payload: activity.payload as import("@dpf/db").Prisma.InputJsonValue,
              },
            });
          },
          raiseIssue: async (issue) => {
            await createPlatformIssueReport({
              type: "build-stall-escalation",
              source: "workroom-pr-follow-through",
              severity: "high",
              title: issue.title,
              description: issue.description,
              featureBuildId: issue.featureBuildId,
              triggerKind: "build-pr-delivery-reconcile",
              dedupeKey: issue.dedupeKey,
              selfFixClass: issue.selfFixClass,
            });
          },
        },
      });

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
        const surface = capsule.featureBuildId ? "Build Studio" : `Workroom ${capsule.capsuleId}`;
        await createPlatformIssueReport({
          type: "build-stall-escalation",
          source: capsule.featureBuildId ? "build-studio" : "workroom-pr-follow-through",
          severity: "high",
          title: `${surface} needs a PR delivery decision: #${prNumber}`,
          description:
            `${surface} stopped autonomous PR delivery for ${capsule.capsuleId}.\n\n` +
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

export const buildPrDeliveryReconcile = jobs.createFunction(
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
