import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

/**
 * Settle budget reservations against their items' status (BI-EF265C9A).
 * Done consumes, retired or deferred releases, a re-size adjusts and records
 * the change. The status tools settle at once; this sweep covers every other
 * status writer, including the work-sync mirror. Idempotent.
 */
export const budgetReservationSettle = inngest.createFunction(
  {
    id: "portfolio/budget-reservation-settle",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("11,26,41,56 * * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "portfolio/budget-reservation-settle");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("settle-open-reservations", async () => {
      const { prisma } = await import("@dpf/db");
      const { settleBudgetReservations } = await import("@/lib/portfolio/budget-reservation");
      return settleBudgetReservations(prisma as never, { limit: 1000 });
    });
  },
);
