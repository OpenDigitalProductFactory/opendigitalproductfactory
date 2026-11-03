import { prisma, type Prisma } from "@dpf/db";
import { withQuiescenceStartSerialization, type QuiescenceReservationDb } from "@/lib/self-upgrade/quiescence-start-reservation";
import { isRecord } from "@/lib/shared/coerce";
import { MANAGED_INFERENCE_UNSETTLED_WHERE } from "./managed-inference-action";
import { classifyManagedInferenceRequest, parseManagedInferenceRequestId } from "./managed-inference-request";

/** Bounded original-request observation for an already-authorized operator.
 * No raw host policy, credentials or provider calls. Absence uses the exact
 * serialization boundary that admits starts and queues their native action. */
export async function readManagedInferenceRequestState(input: { requestId?: string;
  db?: QuiescenceReservationDb } = {}) {
  const db = input.db ?? prisma as unknown as QuiescenceReservationDb;
  return withQuiescenceStartSerialization(db, "portal.quiescence", async port => {
    const tx = port as unknown as Prisma.TransactionClient;
    let requestId = input.requestId;
    if (requestId === undefined) {
      const action = await tx.remoteAction.findFirst({ where: MANAGED_INFERENCE_UNSETTLED_WHERE,
        orderBy: { createdAt: "asc" }, select: { actionKey: true } });
      const drain = action ? null : await tx.quiescenceRun.findFirst({ where: { trigger: "manual", triggerRefId: { startsWith: "inference-runtime:ra_native_" },
        status: { notIn: ["completed", "deferred", "aborted", "failed"] } }, orderBy: { startedAt: "asc" }, select: { triggerRefId: true } });
      requestId = action?.actionKey.replace(/^ra_native_/, "") ?? drain?.triggerRefId?.replace(/^inference-runtime:ra_native_/, "");
      if (!requestId) return null;
    }
    const request = parseManagedInferenceRequestId(requestId);
    if (!request) throw new Error("Invalid managed inference request identity");
    const [action, drain, global] = await Promise.all([
      tx.remoteAction.findUnique({ where: { actionKey: request.actionKey }, select: { status: true, dispatchNonce: true, evidence: true } }),
      tx.quiescenceRun.findFirst({ where: { trigger: "manual", triggerRefId: request.triggerRefId }, orderBy: { startedAt: "asc" }, select: { runId: true, status: true } }),
      tx.platformConfig.findUnique({ where: { key: "portal.quiescence" }, select: { value: true } }),
    ]);
    if (global && (!isRecord(global.value) || !["normal", "draining", "swapping"].includes(String(global.value.level))
      || (global.value.runId !== null && typeof global.value.runId !== "string"))) throw new Error("Current admission ownership is unavailable");
    return classifyManagedInferenceRequest({ request, action, drain, nowMs: Date.now(),
      globalRunId: isRecord(global?.value) && typeof global.value.runId === "string" ? global.value.runId : null });
  });
}
