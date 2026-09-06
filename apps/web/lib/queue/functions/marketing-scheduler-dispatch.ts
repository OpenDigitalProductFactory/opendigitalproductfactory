// apps/web/lib/queue/functions/marketing-scheduler-dispatch.ts
// BI-SCHED-DORMANT / EP-SCHEDULING-SURFACE — wire the marketing scheduler.
//
// The marketing scheduler (ScheduledOutboundAction) already had a complete
// tick/dispatch runner (lib/marketing/scheduler.ts) but no timer: it fired only
// via the manual `tick_marketing_scheduler` MCP tool, so operator-/autopilot-
// scheduled outbound actions never ran on their own — a dormant substrate.
//
// This cron polls due actions on a 30-minute cadence. It only executes
// ScheduledOutboundActions an operator or autopilot policy already created; the
// outbound-send kernel veto still applies to every send; and the job is catalog
// `editable`, so an operator can disable it from /admin/scheduled-jobs.

import { cron } from "inngest";
import { prisma } from "@dpf/db";
import { createDurableConnectorAudit, drainDurableCallbackDispatch } from "@/lib/integrations/kernel/audit";
import { runInboundResponder } from "@/lib/marketing/channels/email-postmark/responder";

import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

export const marketingSchedulerDispatch = inngest.createFunction(
  { id: "marketing/scheduler-dispatch", retries: 1, triggers: [cron("5,35 * * * *")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "marketing/scheduler-dispatch");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return await step.run("tick-marketing-scheduler", async () => {
      const { tickScheduler } = await import("@/lib/marketing/scheduler");
      return tickScheduler();
    });
  },
);

export class PostmarkCallbackDispatchRetryableError extends Error {
  constructor(readonly failedDeliveries: readonly string[]) {
    super(`Postmark callback dispatch remains pending for ${failedDeliveries.length} delivery(s).`);
    this.name = "PostmarkCallbackDispatchRetryableError";
  }
}

type PostmarkReceipt = { deliveryKey: string; domainEntityId: string | null };
type PostmarkDrain = (receipt: { deliveryKey: string; domainEntityId: string }) => Promise<{
  claimedOrCompleted: boolean; retryableFailure: boolean;
}>;

export async function drainPostmarkCallbackBatch(
  receipts: readonly PostmarkReceipt[],
  drain: PostmarkDrain,
): Promise<{ attempted: number }> {
  const failures: string[] = [];
  let attempted = 0;
  for (const receipt of receipts) {
    if (!receipt.domainEntityId) continue;
    attempted += 1;
    try {
      const result = await drain({ ...receipt, domainEntityId: receipt.domainEntityId });
      if (result.retryableFailure) failures.push(receipt.deliveryKey);
    } catch {
      failures.push(receipt.deliveryKey);
    }
  }
  if (failures.length > 0) throw new PostmarkCallbackDispatchRetryableError(failures);
  return { attempted };
}

async function drainPostmarkCallbacks(deliveryKey?: string, terminalAudit?: {
  eventKey: string; responseKind: string; errorCode: string;
}) {
  if (terminalAudit) await createDurableConnectorAudit({ repository: prisma.integrationToolCallLog }).record({
    connectorId: "email-postmark", actor: { coworkerId: "external-webhook", userId: null },
    operation: "callback", redactedInput: { event: "inbound-email", eventKey: terminalAudit.eventKey },
    responseKind: terminalAudit.responseKind, resultCount: 0, durationMs: 0,
    error: { kind: terminalAudit.errorCode as "configuration", safeMessage: terminalAudit.responseKind },
  });
  const receipts = await prisma.integrationCallbackReceipt.findMany({
    where: { connectorId: "email-postmark", status: "completed", dispatchPending: true, ...(deliveryKey ? { deliveryKey } : {}) },
    select: { deliveryKey: true, domainEntityId: true }, orderBy: { updatedAt: "asc" }, take: deliveryKey ? 1 : 50,
  });
  const batch = await drainPostmarkCallbackBatch(receipts, (receipt) => drainDurableCallbackDispatch({
    client: prisma as unknown as Parameters<typeof drainDurableCallbackDispatch>[0]["client"],
    connectorId: "email-postmark", ...receipt,
    responder: async (inboundId) => { await runInboundResponder({ inboundId }); },
  }));
  return { attempted: batch.attempted, terminalAudits: terminalAudit ? 1 : 0 };
}

export const postmarkCallbackDispatchRequested = inngest.createFunction(
  { id: "integrations/postmark-callback-dispatch", retries: 3, triggers: [{ event: "integrations/postmark-callback.received" }] },
  async ({ event: received, step }) => step.run("drain-postmark-callback", () => drainPostmarkCallbacks(received.data.deliveryKey, received.data.terminalAudit)),
);

export const postmarkCallbackDispatchSweep = inngest.createFunction(
  {
    id: "integrations/postmark-callback-sweep",
    retries: 2,
    triggers: [cron("2,7,12,17,22,27,32,37,42,47,52,57 * * * *")],
  },
  async ({ step }) => step.run("sweep-postmark-callbacks", () => drainPostmarkCallbacks()),
);
