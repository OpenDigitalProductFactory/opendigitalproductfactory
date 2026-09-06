// apps/web/lib/queue/functions/recurring-invoice-dispatch.ts
// BI-SCHED-DORMANT / EP-SCHEDULING-SURFACE — wire recurring invoicing.
//
// generateDueInvoices() (lib/actions/recurring.ts) is a complete, idempotent
// generator — it dedups per day, advances nextInvoiceDate, and honours autoSend
// and endDate — but had no timer: recurring invoices only generated on a manual
// call, a dormant substrate.
//
// This daily cron runs it. It only acts on RecurringSchedules an operator set to
// status="active"; the job is catalog `editable`, so an operator can disable it.

import { cron } from "inngest";

import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

export const recurringInvoiceDispatch = inngest.createFunction(
  { id: "finance/recurring-invoice-dispatch", retries: 1, triggers: [cron("30 6 * * *")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "finance/recurring-invoice-dispatch");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return await step.run("generate-due-invoices", async () => {
      const { generateDueInvoices } = await import("@/lib/actions/recurring");
      return generateDueInvoices();
    });
  },
);
