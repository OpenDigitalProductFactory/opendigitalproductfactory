import { cron } from "@/lib/jobs/triggers";
import { jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";
import { selectPrDeliveryRooms } from "./build-pr-delivery-selection";
import type { BuildPrDeliveryStateV1 } from "@/lib/build/build-pr-delivery-state";
import type { GithubPrObservation } from "@/lib/build/github-pr-readiness";
import type { PrRepairPacket } from "@/lib/build/pr-follow-through";
import { isEligiblePrCustodyRoom, readPrCustodyRecord } from "@/lib/build/pr-ci-repair";
import { isRecord } from "@/lib/shared/coerce";

export const BUILD_PR_DELIVERY_RECONCILE_CRON = "2,7,12,17,22,27,32,37,42,47,52,57 * * * *";

const PR_DELIVERY_CLOSEOUT_ACTOR = {
  userId: "system:build-pr-delivery-reconcile",
  agentId: "build-pr-delivery-reconcile",
  principalId: null,
} as const;

export type PrTerminalCloseoutPlan =
  | {
      kind: "close";
      targetStatus: "archived" | "abandoned";
      outcome: "delivered" | "undelivered";
      reason: string;
      headSha: string;
    }
  | { kind: "retain"; reason: string };

/**
 * Provider-confirmed terminal settlement policy for PR-only custody rooms
 * (BI-C3EBDCEC FLOW-PR-3 / CONTRACT-PR-CLOSE). Never infers delivery from
 * branch title, mergeability, or failed provider reads; preserves rooms that
 * still carry a FeatureBuild, backlog item, task run, or unmerged worktree.
 */
export function planPrTerminalCloseout(input: {
  capsule: {
    capsuleId: string;
    featureBuildId: string | null;
    backlogItemId?: string | null;
    taskRunId?: string | null;
    worktreePath?: string | null;
    pullRequestNumber: number | null;
    pullRequestUrl: string | null;
    workspaceState: unknown;
  };
  observation: Pick<GithubPrObservation, "number" | "url" | "state" | "merged" | "headSha">;
}): PrTerminalCloseoutPlan {
  const { capsule, observation } = input;
  const custody = readPrCustodyRecord(capsule.workspaceState);
  if (!custody) return { kind: "retain", reason: "not-pr-custody-room" };
  const headSha = observation.headSha.trim();
  if (!headSha || observation.number !== capsule.pullRequestNumber || observation.url !== capsule.pullRequestUrl) {
    return { kind: "retain", reason: "provider-identity-mismatch" };
  }
  const hasGovernedWork = Boolean(capsule.featureBuildId || capsule.backlogItemId || capsule.taskRunId);
  if (observation.merged || observation.state === "MERGED") {
    if (hasGovernedWork) return { kind: "retain", reason: "governed-work-linked" };
    return {
      kind: "close",
      targetStatus: "archived",
      outcome: "delivered",
      headSha,
      reason: `Provider confirmed PR #${observation.number} merged at head ${headSha.slice(0, 12)}; archived PR-only custody room as delivered.`,
    };
  }
  if (observation.state === "CLOSED") {
    if (hasGovernedWork || capsule.worktreePath) {
      return { kind: "retain", reason: "outstanding-owned-work" };
    }
    return {
      kind: "close",
      targetStatus: "abandoned",
      outcome: "undelivered",
      headSha,
      reason: `Provider confirmed PR #${observation.number} closed unmerged at head ${headSha.slice(0, 12)}; ended PR-only custody as undelivered with evidence preserved.`,
    };
  }
  return { kind: "retain", reason: "pull-request-open" };
}

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
 * froze the room in "updating" forever. Dispatched PR repairs and PR-only
 * custody rooms without a local checkout likewise follow new commits on their
 * exact bound PR (BI-C3EBDCEC).
 */
export function observesRoomHead(
  roomHeadSha: string | null | undefined,
  observedHeadSha: string,
  state: (Pick<BuildPrDeliveryStateV1, "status" | "lastObservedHeadSha"> & {
    followThrough?: Pick<BuildPrDeliveryStateV1["followThrough"], "hold" | "judgedHeadSha"> | null;
  }) | null | undefined,
  options?: { followPrHead?: boolean },
): boolean {
  if (!roomHeadSha) return true;
  const room = roomHeadSha.toLowerCase();
  if (observedHeadSha.toLowerCase() === room) return true;
  if (options?.followPrHead) return true;
  if (state?.status === "updating" && state.lastObservedHeadSha?.toLowerCase() === room) return true;
  return state?.followThrough?.hold === "repairing" && state.followThrough.judgedHeadSha?.toLowerCase() === room;
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
    rerunFailedWorkflowJobs,
  } = await import("@/lib/build/github-pr-readiness");
  const { refreshFailureReadinessForDelivery } = await import("@/lib/build/failure-readiness-delivery-refresh");
  const { checkWorkroomFailureReadiness } = await import("@/lib/change-review/failure-readiness-publication");
  const { publishFailureReadinessStatus } = await import("@/lib/change-review/failure-readiness-status");
  const {
    executeBuildPrDeliveryAction,
    holdsPrQueueAttempt,
    projectBuildPrDeliveryReadiness,
    resolveBuildPrReconcilerMode,
  } = await import("@/lib/build/build-pr-delivery-reconciler");
  const {
    createBuildPrDeliveryState,
    readBuildPrDeliveryState,
    restoreBuildPrQueueHistory,
    writeBuildPrDeliveryState,
  } = await import("@/lib/build/build-pr-delivery-state");
  const {
    announcePrFollowThrough,
    resolvePrFollowThroughPosture,
  } = await import("@/lib/build/pr-follow-through-announce");
  const { getWorkroomPostureDefault } = await import("@/lib/work-management/workroom-posture-defaults");
  // Every owner hand-off below passes the escalation gate (BI-5E067004).
  const { routeToHuman } = await import("@/lib/govern/authority/route-to-human");
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
    let state = existing ?? restoreBuildPrQueueHistory(createBuildPrDeliveryState({ repository, prNumber, prUrl }), capsule.workspaceState);
    const withheldKey = `build-pr-delivery:${prNumber}:autonomous-eligibility-withheld`;

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
            const blockers = autonomy.eligibility.blockers;
            // A recorded human gate must still reach a person. The seam treats
            // a missing pattern as ordinary evidence and would hand it to an agent.
            const declarations = blockers.includes("high_sensitivity_requires_human")
              ? { sensitivity: "restricted" as const }
              : blockers.includes("regulatory_ceiling_requires_human")
                ? { regulated: true }
                : undefined;
            if (state.escalationKey == null) {
              const filed = await routeToHuman({
                producer: "build-pr-delivery",
                subject: { kind: "pull-request", id: `#${prNumber}` },
                blockingFacts: blockers.length > 0 ? blockers : ["autonomous-eligibility-withheld"],
                blockerClass: "evidence-withheld",
                ...(declarations ? { declarations } : {}),
                report: {
                  source: "build-studio",
                  severity: "high",
                  title: `Build Studio withheld PR #${prNumber}`,
                  description:
                    `Build Studio will not move PR #${prNumber} (${capsule.capsuleId}) while autonomous eligibility is withheld.\n` +
                    `Blockers: ${blockers.join(", ") || "autonomous-eligibility-withheld"}\nPR: ${prUrl}`,
                  featureBuildId: capsule.featureBuildId,
                  triggerKind: "build-pr-delivery-reconcile",
                  dedupeKey: withheldKey,
                },
                notice: { deepLink: "/admin/issue-reports" },
              });
              if (filed.error) throw new Error(`autonomous-eligibility-route-failed:${filed.error}`);
            }
            const blockedState = {
              ...state,
              status: "escalated" as const,
              escalationKey: state.escalationKey ?? withheldKey,
              lastError: blockers.join(",") || "autonomous-eligibility-withheld",
              lastObservedAt: new Date().toISOString(),
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
          if (state.escalationKey === withheldKey) {
            state = {
              ...state,
              status: "checking",
              escalationKey: null,
              lastError: null,
              nextObservationAt: null,
            };
          }
        }
      }
      const custody = readPrCustodyRecord(capsule.workspaceState);
      const prCustodyEligible = isEligiblePrCustodyRoom(capsule);
      const followPrHead = Boolean(custody && !capsule.featureBuildId && !capsule.worktreePath);
      let observation = await observeGithubPullRequest({ owner, repo, prNumber, token });
      observed += 1;
      if (!observesRoomHead(capsule.headSha, observation.headSha, existing, { followPrHead })) continue;
      let readiness = projectBuildPrDeliveryReadiness(state, observation);
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
      if (mode === "enforce" && actuationAllowed && !holdsPrQueueAttempt(state, readiness)
        && (readiness.kind !== "ready" || state.queueIntentHeadSha === readiness.headSha)) {
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
          if (!observesRoomHead(capsule.headSha, observation.headSha, existing, { followPrHead })) continue;
          readiness = projectBuildPrDeliveryReadiness(state, observation);
        }
      }
      const closeoutPlan = planPrTerminalCloseout({ capsule, observation });
      const prOnlyCloseout = closeoutPlan.kind === "close" && closeoutPlan.outcome === "undelivered";
      const accountableOwnerPrincipalId =
        custody?.accountableOwnerPrincipalId
        ?? capsule.leaseHolderPrincipalId
        ?? capsule.requestedByPrincipalId
        ?? capsule.createdByPrincipalId
        ?? null;
      const outcome = await executeBuildPrDeliveryAction({
        state,
        observation,
        readiness,
        mode,
        token,
        owner,
        repo,
        actuationAllowed,
        routeQueueHold: async (hold) => {
          const facts = hold.failingChecks.map((check) =>
            `${check.name} (${check.conclusion})${check.url ? ` — ${check.url}` : ""}`);
          const filed = await routeToHuman({
            producer: "build-pr-delivery",
            subject: { kind: "workroom", id: capsule.capsuleId },
            blockingFacts: [hold.reason, ...facts],
            report: {
              source: capsule.featureBuildId ? "build-studio" : "workroom-pr-follow-through",
              severity: "medium",
              title: `PR #${prNumber} queue follow-through: ${hold.owner}`,
              description: [
                `Workroom ${capsule.capsuleId} observed ${hold.reason} at ${hold.eventAt}.`,
                `Current PR head: ${hold.headSha}. Removed group: ${hold.groupHeadSha ?? "unread"}.`,
                "Queue-group checks are not a verdict on the current author head.",
                facts.length ? facts.join("\n") : "Queue-group failing check details are unread.",
                `Next action for ${hold.owner}: ${hold.nextAction}`,
                "Build Studio checks again on the existing delivery tick. It does not re-arm this request.",
                prUrl,
              ].join("\n"),
              featureBuildId: capsule.featureBuildId,
              triggerKind: "build-pr-delivery-reconcile",
              dedupeKey: `build-pr-delivery:${capsule.capsuleId}:queue-hold:${hold.reason === "disarmed" ? "disarmed" : hold.headSha}:${hold.eventId}`,
            },
          });
          return filed.error ? null : filed.reportId;
        },
        prOnlyCustody: prOnlyCloseout,
        // BI-085A37EC / BI-C3EBDCEC: Build Studio builds and eligible PR-only
        // Build Studio custody rooms dispatch bounded CI repair unless the room
        // is quiet or advise-only. Observe-only and other rooms keep their posture.
        repairAuthority: (capsule.featureBuildId || prCustodyEligible) && posture.authority !== "record"
          ? "dispatch"
          : posture.authority,
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
          : prCustodyEligible && accountableOwnerPrincipalId && capsule.headBranch
            ? {
                dispatchRepair: async (packet: PrRepairPacket) => {
                  const { dispatchWorkroomPrCiRepair } = await import("@/lib/build/pr-ci-repair");
                  return dispatchWorkroomPrCiRepair({
                    capsuleId: capsule.capsuleId,
                    owner,
                    repo,
                    prNumber,
                    prUrl,
                    baseBranch: capsule.baseBranch ?? custody?.baseBranch ?? "main",
                    headBranch: capsule.headBranch!,
                    accountableOwnerPrincipalId,
                    authorLogin: custody?.authorLogin ?? null,
                    authorType: custody?.authorType ?? null,
                    packet,
                    github: { owner, repo, token },
                  });
                },
              }
            : {}),
      });
      if (outcome.actuated) actuated += 1;

      const nextWorkspaceState = writeBuildPrDeliveryState(
        closeoutPlan.kind === "close"
          ? {
              ...(isRecord(capsule.workspaceState) ? capsule.workspaceState : {}),
              prCloseout: {
                outcome: closeoutPlan.outcome,
                targetStatus: closeoutPlan.targetStatus,
                repository,
                prNumber,
                prUrl,
                headSha: closeoutPlan.headSha,
                providerState: observation.merged ? "MERGED" : observation.state,
                preservedEvidence: true,
                closedAt: new Date().toISOString(),
              },
            }
          : capsule.workspaceState,
        outcome.state,
      );
      const saved = await prisma.workroom.updateMany({
        where: { id: capsule.id, updatedAt: capsule.updatedAt },
        data: {
          workspaceState: nextWorkspaceState as unknown as import("@dpf/db").Prisma.InputJsonValue,
          // Never erase a room's recorded head on an observation that lacked one.
          ...(outcome.state.lastObservedHeadSha ? { headSha: outcome.state.lastObservedHeadSha } : {}),
        },
      });
      if (saved.count === 0) {
        compareAndSwapLost += 1;
        continue;
      }

      if (closeoutPlan.kind === "close") {
        const { updateWorkCapsuleStatus } = await import("@/lib/work-capsules/work-capsule-store");
        await updateWorkCapsuleStatus({
          db: prisma as never,
          capsuleId: capsule.capsuleId,
          status: closeoutPlan.targetStatus,
          reason: closeoutPlan.reason,
          actor: PR_DELIVERY_CLOSEOUT_ACTOR,
        });
        await prisma.workroomActivity.create({
          data: {
            workCapsuleId: capsule.id,
            kind: "evidence",
            summary: closeoutPlan.reason,
            payload: {
              event: "workroom-pr-custody-closed",
              outcome: closeoutPlan.outcome,
              targetStatus: closeoutPlan.targetStatus,
              repository,
              prNumber,
              prUrl,
              headSha: closeoutPlan.headSha,
              providerState: observation.merged ? "MERGED" : observation.state,
              preservedEvidence: true,
            } as import("@dpf/db").Prisma.InputJsonValue,
          },
        });
        actuated += 1;
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
        await routeToHuman({
          producer: "build-pr-delivery",
          subject: { kind: "pull-request", id: `#${prNumber}` },
          blockingFacts: ["merge-state-undecided: GitHub has not decided the merge state"],
          blockerClass: "infrastructure",
          report: {
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
          },
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
            await routeToHuman({
              producer: "pull-request-follow-through",
              subject: { kind: "workroom", id: capsule.capsuleId },
              blockingFacts: issue.blockingFacts,
              declarations: { proposeBoundary: issue.proposeBoundary },
              report: {
                source: "workroom-pr-follow-through",
                severity: "high",
                title: issue.title,
                description: issue.description,
                featureBuildId: issue.featureBuildId,
                triggerKind: "build-pr-delivery-reconcile",
                dedupeKey: issue.dedupeKey,
              },
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
        await routeToHuman({
          producer: "build-pr-delivery",
          subject: { kind: "pull-request", id: `#${prNumber}` },
          blockingFacts: [outcome.action.reason],
          // A person closed this PR; reopening or replacing it overrides them.
          declarations: outcome.action.reason === "pull-request-closed-unmerged" ? { consequence: "authority" } : {},
          report: {
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
          },
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
