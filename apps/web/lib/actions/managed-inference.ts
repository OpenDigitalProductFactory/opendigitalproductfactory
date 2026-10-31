"use server";

import { prisma, type Prisma } from "@dpf/db";
import { MANAGED_INFERENCE_ACTION_TYPE } from "@dpf/db/remote-action-dispatch";
import { requireCapability } from "@/lib/actions/shared/guards";
import { registerChange } from "@/lib/change-management/register-change";
import { resolveActiveHumanPrincipalRecordIdForUser } from "@/lib/identity/principal-linking";
import { buildManagedInferenceOffer, MANAGED_INFERENCE_UNSETTLED_WHERE, type ManagedInferenceOffer } from "@/lib/remote-action/managed-inference-action";
import { managedInferenceProviderDigest, managedInferenceProviderAllowsTransition } from "@/lib/remote-action/managed-inference-admission";
import { startQuiescence, signalSwapStarting, failQuiescenceSwap } from "@/lib/self-upgrade/quiescence";
import { isRecord } from "@/lib/shared/coerce";
import { envFlagEnabled } from "@/lib/runtime/env-flags";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { parseManagedInferenceRequestId } from "@/lib/remote-action/managed-inference-request";
import { readManagedInferenceRequestState } from "@/lib/remote-action/managed-inference-request-state";
import { withQuiescenceStartSerialization, type QuiescenceReservationDb } from "@/lib/self-upgrade/quiescence-start-reservation";

class NativeQueueRefused extends Error {}

async function loadOffer(operation: "activate" | "rollback", ownActionKey?: string): Promise<ManagedInferenceOffer> {
  if (!envFlagEnabled(process.env, "DPF_REMOTE_ACTION_DISPATCH_ENABLED")) return { available: false, message: "The host action channel is not enabled." };
  const now = new Date();
  const [nodes, leases, workrooms, active, provider, pendingDrain, globalRow, connection] = await Promise.all([
    prisma.edgeNode.findMany({ where: { platform: "darwin", installMode: "native", trustState: "trusted", customerAccountId: null, customerSiteId: null },
      take: 20, include: { capabilityRows: { where: { capability: "action.execute" } } } }),
    prisma.nonProductionEnvironmentLease.findMany({ where: { environmentKey: "host-heavy-resource", resourceClass: "inference",
      status: "active", releasedAt: null, expiresAt: { gt: now } }, take: 20 }),
    prisma.workroom.findMany({ where: { executorRef: { not: null }, headSha: { not: null } },
      orderBy: { updatedAt: "desc" }, take: 100, select: { executorRef: true, headSha: true, headBranch: true } }),
    prisma.remoteAction.findFirst({ where: MANAGED_INFERENCE_UNSETTLED_WHERE, select: { actionKey: true } }),
    prisma.modelProvider.findUnique({ where: { providerId: "local" } }),
    prisma.quiescenceRun.findFirst({ where: { triggerRefId: { startsWith: "inference-runtime:" }, status: { in: ["pending", "preparing", "draining", "awaiting-operator", "ready-to-swap", "swapping"] },
      ...(ownActionKey ? { NOT: { triggerRefId: `inference-runtime:${ownActionKey}` } } : {}) }, select: { runId: true } }),
    prisma.platformConfig.findUnique({ where: { key: "portal.quiescence" } }),
    prisma.aiProviderConnection.findUnique({ where: { connectionId: "provider-default-local" }, select: { connectionId: true, providerId: true, status: true } }),
  ]);
  if (!managedInferenceProviderAllowsTransition(provider, connection)) return { available: false, message: "The local provider is paused or unavailable for routing. Reconcile its account before changing the engine." };
  const global = isRecord(globalRow?.value) ? globalRow.value : {};
  const ownDrain = ownActionKey ? await prisma.quiescenceRun.findFirst({ where: { triggerRefId: `inference-runtime:${ownActionKey}` }, select: { runId: true } }) : null;
  const foreignCurrent = (global.runId && global.runId !== ownDrain?.runId) || (["draining", "swapping"].includes(String(global.level)) && !ownDrain);
  try { return buildManagedInferenceOffer({ nodes, leases, workrooms, activeAction: active !== null || pendingDrain !== null || !!foreignCurrent, providerDigest: managedInferenceProviderDigest(provider), operation, now }); }
  catch { return { available: false, message: "The existing model settings conflict with managed inference. They need to be reconciled first." }; }
}

export type ManagedInferencePublicOffer = { available: false; message: string } | {
  available: true; token: string; operation: "activate" | "rollback"; impact: string; needsNodeGrant: boolean;
};
function publicOffer(offer: ManagedInferenceOffer): ManagedInferencePublicOffer {
  return offer.available ? { available: true, token: offer.token, operation: offer.operation, impact: offer.impact, needsNodeGrant: offer.needsNodeGrant } : offer;
}

export async function getManagedInferenceOffers(): Promise<{ activate: ManagedInferencePublicOffer; rollback: ManagedInferencePublicOffer; pendingRequestId: string | null }> {
  await requireCapability("manage_platform");
  const [activate, rollback, pending] = await Promise.all([loadOffer("activate"), loadOffer("rollback"), readManagedInferenceRequestState()]);
  return { activate: publicOffer(activate), rollback: publicOffer(rollback), pendingRequestId: pending && !pending.canSubmitNewRequest ? pending.requestId : null };
}

// A concrete human confirmation may grant this ONE closed action type on this
// ONE already-enabled trusted native node. Automatic host-upkeep grants and
// other node policies/capabilities are neither broadened nor re-enabled.
export async function requestManagedInferenceTransition(input: {
  requestId: string; operation: "activate" | "rollback"; offerToken: string; operatorConfirmed: boolean; allowNodeAction: boolean;
}): Promise<ActionResult<{ actionKey: string; rfcId: string }>> {
  const { userId } = await requireCapability("manage_platform");
  const request = parseManagedInferenceRequestId(input?.requestId);
  if (!request || request.issuedAtMs > Date.now() + 30000 || request.acceptByMs <= Date.now()) return err("The original request acceptance window has ended. Check its status before a fresh request.");
  if (!input || !["activate", "rollback"].includes(input.operation) || input.operatorConfirmed !== true
    || !/^[a-f0-9]{64}$/.test(input.offerToken ?? "")) return err("Review the ready engine change before confirming it.");
  const principalId = await resolveActiveHumanPrincipalRecordIdForUser(userId);
  if (!principalId) return err("This change needs an active human operator account.");
  const original = await readManagedInferenceRequestState({ requestId: request.requestId });
  if (original?.recorded) return err(original.message);
  const first = await loadOffer(input.operation);
  if (!first.available) return err(first.message);
  if (first.token !== input.offerToken || (first.needsNodeGrant && input.allowNodeAction !== true)) return err("The host or change details have changed. Refresh them before proceeding.");
  const actionKey = request.actionKey;
  let runId: string | null = null, queueAttempted = false;
  try {
    const drain = await startQuiescence({ trigger: "manual", triggerRefId: `inference-runtime:${actionKey}`,
      targetVersion: first.parameters.sourceSha, targetBundleHash: first.parameters.profileSha256, ifBusy: "refuse",
      requestNotAfter: new Date(request.acceptByMs) });
    runId = drain.runId;
    const ready = await drain.awaitReady();
    if (!ready.ok) return err("The engine was not changed because running work could not pause safely.");
    const fresh = await loadOffer(input.operation, actionKey);
    if (!fresh.available || fresh.token !== first.token) {
      await failQuiescenceSwap(runId, "Native inference offer changed before queueing");
      return err("The host, settings or processing window changed. No engine switch was queued.");
    }
    const change = await registerChange({ title: input.operation === "activate" ? "Activate the qualified Mac inference engine" : "Restore the Docker inference engine",
      description: fresh.impact, type: "normal", scope: "platform", riskLevel: "high", status: "approved",
      impactReport: { actionType: MANAGED_INFERENCE_ACTION_TYPE, edgeNodeId: fresh.edgeNodeId, operatorConfirmation: true,
        parameters: fresh.parameters, controllerManifestSha256: fresh.controllerManifestSha256, nodeGrantConfirmed: fresh.needsNodeGrant },
      items: [{ itemType: "managed-inference", title: "Switch the qualified local inference engine",
        rollbackPlan: "Stop only the owned native service and descendants; restore recorded Docker model settings and endpoint selection. Retain the local fence when cleanup or authority is uncertain." }] });
    await prisma.changeRequest.update({ where: { id: change.id }, data: { approvedById: userId } });
    await signalSwapStarting(runId);
    queueAttempted = true;
    await withQuiescenceStartSerialization(prisma as unknown as QuiescenceReservationDb, "portal.quiescence", async port => {
      const tx = port as unknown as Prisma.TransactionClient;
      await tx.$executeRaw`SELECT 1 FROM "QuiescenceRun" WHERE "runId" = ${runId} FOR UPDATE`;
      const [node, cap, lease, provider, ownDrain, currentFence, connection] = await Promise.all([
        tx.edgeNode.findUnique({ where: { id: fresh.edgeNodeId } }),
        tx.edgeNodeCapability.findUnique({ where: { edgeNodeId_capability: { edgeNodeId: fresh.edgeNodeId, capability: "action.execute" } } }),
        tx.nonProductionEnvironmentLease.findUnique({ where: { leaseId: fresh.parameters.leaseId } }),
        tx.modelProvider.findUnique({ where: { providerId: "local" } }),
        tx.quiescenceRun.findUnique({ where: { runId: runId! } }),
        tx.platformConfig.findUnique({ where: { key: "portal.quiescence" } }),
        tx.aiProviderConnection.findUnique({ where: { connectionId: "provider-default-local" }, select: { connectionId: true, providerId: true, status: true } }),
      ]);
      const fence = isRecord(currentFence?.value) ? currentFence.value : {};
      if (!ownDrain || ownDrain.triggerRefId !== request.triggerRefId || !["ready-to-swap", "swapping"].includes(ownDrain.status)
        || ownDrain.targetVersion !== fresh.parameters.sourceSha || ownDrain.targetBundleHash !== fresh.parameters.profileSha256
        || fence.runId !== runId || !["draining", "swapping"].includes(String(fence.level))) throw new NativeQueueRefused("Original drain no longer owned");
      if (!node || node.nodeId !== fresh.nodeId || node.trustState !== "trusted" || node.customerAccountId || node.customerSiteId
        || cap?.mode !== "enabled" || !lease || lease.status !== "active" || lease.phase !== "running" || lease.releasedAt
        || lease.expiresAt <= new Date() || lease.ownerPid !== fresh.lease.ownerPid || lease.ownerProcessIdentity !== fresh.lease.ownerProcessIdentity
        || lease.ownerSessionId !== fresh.lease.ownerSessionId || lease.branchName !== fresh.lease.branchName
        || !managedInferenceProviderAllowsTransition(provider, connection) || managedInferenceProviderDigest(provider) !== fresh.providerDigest) throw new NativeQueueRefused("Native source admission changed");
      if (await tx.remoteAction.count({ where: MANAGED_INFERENCE_UNSETTLED_WHERE })) throw new NativeQueueRefused("Native change already in progress");
      const policy = isRecord(node.scopePolicy) ? node.scopePolicy : {};
      const types = Array.isArray(policy.actionTypes) ? policy.actionTypes.filter((x): x is string => typeof x === "string") : [];
      if (!types.includes(MANAGED_INFERENCE_ACTION_TYPE)) {
        if (!fresh.needsNodeGrant || input.allowNodeAction !== true) throw new NativeQueueRefused("Exact host procedure permission missing");
        await tx.edgeNode.update({ where: { id: node.id }, data: { scopePolicy: { ...policy, actionTypes: [...types, MANAGED_INFERENCE_ACTION_TYPE] } as never } });
      }
      await tx.remoteAction.create({ data: { actionKey, actionType: MANAGED_INFERENCE_ACTION_TYPE, edgeNodeId: node.id,
        riskClass: "high", approvalState: "approved", requestedByPrincipalId: principalId, approvedByPrincipalId: principalId,
        changeRequestId: change.id, status: "queued", parameters: fresh.parameters as never,
        evidence: { governance: "operator-confirmed-approved-change-request", operatorConfirmedAt: new Date().toISOString(),
          nativeAdmission: { ownerSessionId: lease.ownerSessionId, branchName: lease.branchName, ownerPid: lease.ownerPid,
            ownerProcessIdentity: lease.ownerProcessIdentity, quiescenceRunId: runId, controllerManifestSha256: fresh.controllerManifestSha256,
            providerDigest: fresh.providerDigest } } as never } });
    });
    return ok({ actionKey, rfcId: change.rfcId });
  } catch (error) {
    if (error instanceof NativeQueueRefused) queueAttempted = false;
    // A lost commit response is not proof that queueing failed. Retain the
    // pause until the existing action/result lineage can establish settlement.
    if (runId && !queueAttempted) await failQuiescenceSwap(runId, "Native request failed before queueing").catch(() => {});
    return err(queueAttempted ? `The request outcome needs reconciliation (${actionKey}). The engine change must not be replayed.`
      : "The engine change could not be prepared. No host action was queued.");
  }
}
