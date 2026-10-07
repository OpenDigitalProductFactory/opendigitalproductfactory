// BI-F8F8C383 — the operator-approved Docker VM (WSL) restart.
//
// The substrate reconciler raises `substrate:docker-vm-wedged` when processes
// sit in uninterruptible I/O. Only a Docker VM restart clears them, and the
// portal runs inside that VM, so it cannot do it itself. The native Edge agent
// is the one DPF process that runs on the Windows host, and it already polls the
// signed remote-action channel. This module decides whether the restart may be
// offered and queues it for that agent:
//   - only while the wedged-VM condition is open,
//   - only one at a time,
//   - only to a trusted, internal node with action.execute enabled and this
//     action type allowlisted,
//   - only on the operator's explicit confirmation, recorded as an approved
//     ChangeRequest that the claim re-checks.
// It is never queued automatically. Quiescence is the caller's job: the server
// action drains the platform before it queues the action.
//
// DB-injected so every rule is unit-tested without a live runtime.

import { randomUUID } from "node:crypto";

import { DOCKER_VM_RESTART_ACTION_TYPE } from "@dpf/db/remote-action-dispatch";

import { DOCKER_VM_WEDGED_ISSUE_KEY } from "@/lib/platform-runtime/substrate-reconciler";
import { isRecord } from "@/lib/shared/coerce";

export const DOCKER_VM_RESTART_IMPACT =
  "Restarting the Docker VM stops the portal, every container and any running gate for a few minutes, "
  + "then starts Docker and the platform again. This is not a host reboot: Windows keeps running.";

export interface HostExecutorView {
  id: string;
  nodeId: string;
  trustState: string;
  customerAccountId: string | null;
  scopePolicy: unknown;
  capabilityRows: Array<{ capability: string; mode: string }>;
}

export interface DockerVmRestartDeps {
  findOpenWedgedIssue: () => Promise<{ summary: string; observedAt: string | null } | null>;
  findActiveRestart: () => Promise<{ actionKey: string; status: string } | null>;
  findHostExecutors: () => Promise<HostExecutorView[]>;
  countRunningGates: () => Promise<number>;
  registerApprovedChange: (input: {
    title: string;
    description: string;
    approvedByUserId: string;
    impactReport: Record<string, unknown>;
    rollbackPlan: string;
  }) => Promise<{ id: string; rfcId: string }>;
  createAction: (data: Record<string, unknown> & { actionKey: string }) => Promise<{ actionKey: string }>;
  now: () => Date;
  actionKeyFactory?: () => string;
}

export type DockerVmRestartCheck =
  | { offered: true; edgeNodeId: string; nodeId: string; impact: string; runningGates: number; wedged: string }
  | { offered: false; reason: "no-wedged-vm" | "restart-already-in-flight" | "no-host-executor"; message: string };

function allowedActionTypes(scopePolicy: unknown): string[] {
  if (!isRecord(scopePolicy) || !Array.isArray(scopePolicy.actionTypes)) return [];
  return scopePolicy.actionTypes.filter((item): item is string => typeof item === "string");
}

function canRunRestart(node: HostExecutorView): boolean {
  return node.trustState === "trusted"
    && node.customerAccountId === null
    && node.capabilityRows.some((row) => row.capability === "action.execute" && row.mode === "enabled")
    && allowedActionTypes(node.scopePolicy).includes(DOCKER_VM_RESTART_ACTION_TYPE);
}

export async function checkDockerVmRestart(deps: DockerVmRestartDeps): Promise<DockerVmRestartCheck> {
  const issue = await deps.findOpenWedgedIssue();
  if (!issue) {
    return { offered: false, reason: "no-wedged-vm", message: "The Docker VM is not reported as wedged, so there is nothing to restart." };
  }
  const active = await deps.findActiveRestart();
  if (active) {
    return {
      offered: false,
      reason: "restart-already-in-flight",
      message: `A Docker VM restart is already ${active.status} (${active.actionKey}).`,
    };
  }
  const node = (await deps.findHostExecutors()).find(canRunRestart);
  if (!node) {
    return {
      offered: false,
      reason: "no-host-executor",
      message: "No host executor can run this. The restart runs through the native Edge agent on the Windows host: "
        + "install with -WithEdge, enable remote action dispatch, and allow substrate.docker-vm.restart for that node.",
    };
  }
  const runningGates = await deps.countRunningGates();
  const gates = runningGates > 0
    ? ` ${runningGates} running local-CI gate${runningGates === 1 ? "" : "s"} will stop and record no verdict.`
    : "";
  return {
    offered: true,
    edgeNodeId: node.id,
    nodeId: node.nodeId,
    impact: `${DOCKER_VM_RESTART_IMPACT}${gates}`,
    runningGates,
    wedged: issue.summary,
  };
}

export type QueueDockerVmRestartResult =
  | { queued: true; actionKey: string; changeRequestId: string; rfcId: string }
  | { queued: false; reason: string; message: string };

export async function queueDockerVmRestart(
  deps: DockerVmRestartDeps,
  input: { requestedByUserId: string; requestedByPrincipalId: string; operatorConfirmed: boolean },
): Promise<QueueDockerVmRestartResult> {
  if (!input.operatorConfirmed) {
    return { queued: false, reason: "operator-confirmation-required", message: "The operator must confirm the impact before the VM is restarted." };
  }
  if (!input.requestedByPrincipalId.trim()) {
    return { queued: false, reason: "requesting-principal-required", message: "The requesting person has no active principal." };
  }
  const check = await checkDockerVmRestart(deps);
  if (!check.offered) return { queued: false, reason: check.reason, message: check.message };

  const now = deps.now();
  const change = await deps.registerApprovedChange({
    title: "Restart the Docker VM to clear processes stuck in uninterruptible I/O",
    description: `${check.wedged}\n\n${check.impact}`,
    approvedByUserId: input.requestedByUserId,
    impactReport: {
      actionType: DOCKER_VM_RESTART_ACTION_TYPE,
      edgeNodeId: check.edgeNodeId,
      issueKey: DOCKER_VM_WEDGED_ISSUE_KEY,
      operatorConfirmation: true,
      impact: check.impact,
      runningGates: check.runningGates,
    },
    rollbackPlan: "None needed: a VM restart changes no data. If Docker does not come back, the host executor reports the failure on the action and the wedged-VM condition stays open.",
  });
  const actionKey = deps.actionKeyFactory?.() ?? `ra_vm_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  await deps.createAction({
    actionKey,
    actionType: DOCKER_VM_RESTART_ACTION_TYPE,
    edgeNodeId: check.edgeNodeId,
    customerAccountId: null,
    customerSiteId: null,
    parameters: { issueKey: DOCKER_VM_WEDGED_ISSUE_KEY },
    riskClass: "high",
    requestedByPrincipalId: input.requestedByPrincipalId,
    approvalState: "approved",
    approvedByPrincipalId: input.requestedByPrincipalId,
    changeRequestId: change.id,
    status: "queued",
    evidence: {
      governance: "operator-confirmed-approved-change-request",
      operatorConfirmedAt: now.toISOString(),
      impact: check.impact,
    },
  });
  return { queued: true, actionKey, changeRequestId: change.id, rfcId: change.rfcId };
}

/**
 * Carry the host's report onto the restart's ChangeRequest, so the change
 * register shows the outcome without anyone closing it by hand. A failed
 * restart completes as unsuccessful: nothing was changed, so nothing rolls back.
 */
export function changeStepsForRestartReport(
  outcome: "running" | "succeeded" | "failed",
  errorCode?: string | null,
): Array<{ status: string; extra?: Record<string, unknown> }> {
  if (outcome === "running") return [{ status: "scheduled" }, { status: "in-progress" }];
  return [
    { status: "scheduled" },
    { status: "in-progress" },
    {
      status: "completed",
      extra: outcome === "succeeded"
        ? { outcome: "successful", outcomeNotes: "The host agent restarted the Docker VM and the engine answered." }
        : { outcome: "unsuccessful", outcomeNotes: `The host agent could not complete the restart (${errorCode || "no error code"}).` },
    },
  ];
}

