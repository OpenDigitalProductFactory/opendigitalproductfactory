"use server";

// BI-F8F8C383 — the operator's approval of a Docker VM restart.
//
// The portal cannot restart the VM it runs in. This action records the
// operator's confirmation as an approved ChangeRequest, drains the platform
// through quiescence (the same handshake teardown uses), and only then queues a
// signed, machine-bound remote action for the native Edge agent on the Windows
// host. It is never called automatically. The rules live in
// lib/remote-action/docker-vm-restart-action.ts; this file wires real I/O.

import { prisma } from "@dpf/db";
import { DOCKER_VM_RESTART_ACTION_TYPE } from "@dpf/db/remote-action-dispatch";

import { requireCapability } from "@/lib/actions/shared/guards";
import { registerChange } from "@/lib/change-management/register-change";
import { resolveActiveHumanPrincipalRecordIdForUser } from "@/lib/identity/principal-linking";
import { DOCKER_VM_WEDGED_ISSUE_KEY } from "@/lib/platform-runtime/substrate-reconciler";
import {
  checkDockerVmRestart,
  queueDockerVmRestart,
  type DockerVmRestartCheck,
  type DockerVmRestartDeps,
} from "@/lib/remote-action/docker-vm-restart-action";
import {
  failQuiescenceSwap,
  signalSwapComplete,
  signalSwapStarting,
  startQuiescence,
} from "@/lib/self-upgrade/quiescence";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { getErrorMessage } from "@/lib/shared/get-error-message";

function restartDeps(): DockerVmRestartDeps {
  return {
    findOpenWedgedIssue: async () => {
      const issue = await prisma.portfolioQualityIssue.findUnique({
        where: { issueKey: DOCKER_VM_WEDGED_ISSUE_KEY },
        select: { status: true, summary: true, lastDetectedAt: true },
      });
      return issue?.status === "open"
        ? { summary: issue.summary, observedAt: issue.lastDetectedAt?.toISOString() ?? null }
        : null;
    },
    findActiveRestart: () => prisma.remoteAction.findFirst({
      where: { actionType: DOCKER_VM_RESTART_ACTION_TYPE, status: { in: ["queued", "claimed", "running"] } },
      select: { actionKey: true, status: true },
    }),
    findHostExecutors: () => prisma.edgeNode.findMany({
      where: { trustState: "trusted", customerAccountId: null },
      select: {
        id: true,
        nodeId: true,
        trustState: true,
        customerAccountId: true,
        scopePolicy: true,
        capabilityRows: { where: { capability: "action.execute" }, select: { capability: true, mode: true } },
      },
    }),
    countRunningGates: () => prisma.nonProductionEnvironmentLease.count({
      where: { environmentKey: "local-integration-ci", releasedAt: null, status: { in: ["admitted", "active"] } },
    }),
    registerApprovedChange: async (input) => {
      const change = await registerChange({
        title: input.title,
        description: input.description,
        type: "normal",
        scope: "platform",
        riskLevel: "high",
        status: "approved",
        impactReport: input.impactReport,
        items: [{ itemType: "docker-vm-restart", title: "Restart the Docker VM (WSL)", rollbackPlan: input.rollbackPlan }],
      });
      await prisma.changeRequest.update({ where: { id: change.id }, data: { approvedById: input.approvedByUserId } });
      return change;
    },
    createAction: (data) => prisma.remoteAction.create({ data: data as never, select: { actionKey: true } }),
    now: () => new Date(),
  };
}

/** What the Health page shows: whether a restart can be offered, and its impact. */
export async function getDockerVmRestartOffer(): Promise<DockerVmRestartCheck> {
  await requireCapability("manage_platform");
  return checkDockerVmRestart(restartDeps());
}

export async function requestDockerVmRestartAction(input: {
  operatorConfirmed: boolean;
}): Promise<ActionResult<{ actionKey: string; rfcId: string }>> {
  const { userId } = await requireCapability("manage_platform");
  if (!input.operatorConfirmed) return err("Confirm the impact before restarting the Docker VM.");
  const principalId = await resolveActiveHumanPrincipalRecordIdForUser(userId);
  if (!principalId) return err("Your account has no active principal, so the restart cannot be attributed.");

  const deps = restartDeps();
  const offer = await checkDockerVmRestart(deps);
  if (!offer.offered) return err(offer.message);

  let quiescenceRunId: string | null = null;
  try {
    const quiescence = await startQuiescence({
      trigger: "docker-vm-restart",
      triggerRefId: `docker-vm-restart:${offer.edgeNodeId}`,
      targetVersion: "docker-vm-restart",
      targetBundleHash: "docker-vm-restart",
    });
    quiescenceRunId = quiescence.runId;
    const ready = await quiescence.awaitReady();
    if (!ready.ok) {
      return err(`The Docker VM was not restarted because the platform could not drain safely${ready.outcome === "deferred" && ready.deferSurface ? ` (${ready.deferSurface})` : ""}.`);
    }
    const queued = await queueDockerVmRestart(deps, {
      requestedByUserId: userId,
      requestedByPrincipalId: principalId,
      operatorConfirmed: true,
    });
    if (!queued.queued) {
      await failQuiescenceSwap(quiescenceRunId, queued.message);
      return err(queued.message);
    }
    // The host agent claims within its poll interval and the portal stops with
    // the VM. Close the coordinator now, as teardown does, so no new work is
    // admitted into a drain that can receive no callback once the VM stops.
    await signalSwapStarting(quiescenceRunId);
    await signalSwapComplete(quiescenceRunId);
    return ok({ actionKey: queued.actionKey, rfcId: queued.rfcId });
  } catch (error) {
    const message = getErrorMessage(error);
    if (quiescenceRunId) await failQuiescenceSwap(quiescenceRunId, message).catch(() => {});
    return err(message);
  }
}
