"use server";

// Opportunity maintenance actions. Extracted from crm.ts to keep that module focused
// (module-size ratchet, BI-OPT-RATCHETS).

import { prisma } from "@dpf/db";
import { logSystemActivity } from "@/lib/crm/crm-activity";

const DORMANT_THRESHOLD_DAYS = 45;

/** Mark open opportunities with no stage change in DORMANT_THRESHOLD_DAYS as dormant. */
export async function flagDormantOpportunities() {
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - DORMANT_THRESHOLD_DAYS);

  const stale = await prisma.opportunity.findMany({
    where: {
      isDormant: false,
      stage: { notIn: ["closed_won", "closed_lost"] },
      stageChangedAt: { lt: threshold },
    },
    select: { id: true, accountId: true, contactId: true, title: true },
  });

  for (const opp of stale) {
    await prisma.opportunity.update({
      where: { id: opp.id },
      data: { isDormant: true },
    });

    await logSystemActivity(
      `Opportunity "${opp.title}" marked dormant (no stage change in ${DORMANT_THRESHOLD_DAYS} days)`,
      {
        type: "system",
        accountId: opp.accountId,
        contactId: opp.contactId || undefined,
        opportunityId: opp.id,
      },
    );
  }

  return { flagged: stale.length };
}
