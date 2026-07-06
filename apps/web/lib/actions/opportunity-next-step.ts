"use server";

import crypto from "crypto";
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";

// The activity-based-selling loop: every open opportunity carries a planned
// next step. Setting one updates the deal's nextActivityAt AND logs a task
// activity on the timeline, so the plan is visible in both places.

export async function setOpportunityNextStep(input: {
  opportunityId: string;
  /** ISO date (yyyy-mm-dd) or datetime for the planned step. */
  scheduledAt: string;
  /** Short description, e.g. "Follow-up call on proposal". */
  note?: string;
}) {
  const when = new Date(input.scheduledAt);
  if (Number.isNaN(when.getTime())) throw new Error("A valid date is required");

  const opportunity = await prisma.opportunity.update({
    where: { id: input.opportunityId },
    data: { nextActivityAt: when, isDormant: false },
    select: { id: true, accountId: true, title: true },
  });

  await prisma.activity
    .create({
      data: {
        activityId: `ACT-${crypto.randomUUID()}`,
        type: "task",
        subject: input.note?.trim() || `Next step planned for ${opportunity.title}`,
        scheduledAt: when,
        accountId: opportunity.accountId,
        opportunityId: opportunity.id,
      },
    })
    .catch(() => {});

  revalidatePath("/customer/opportunities");
  revalidatePath(`/customer/opportunities/${opportunity.id}`);
  return { ok: true as const, nextActivityAt: when.toISOString() };
}
