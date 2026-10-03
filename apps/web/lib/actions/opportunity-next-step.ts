"use server";

import crypto from "crypto";
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";

// The activity-based-selling loop: every open opportunity carries a planned
// next step. Setting one updates the deal's nextActivityAt AND logs a task
// activity on the timeline, so the plan is visible in both places.

/**
 * A date-only value (`yyyy-mm-dd`) is a calendar day, not an instant.
 * `new Date("2026-08-31")` is UTC midnight, which `toLocaleDateString()`
 * renders as the previous day in every negative UTC offset (BI-954B4FA7).
 * Store that calendar day at 12:00 UTC so the same civil date survives
 * offsets from UTC-12 through UTC+12. A full timestamp is left absolute.
 */
export function parseOpportunityScheduledAt(value: string): Date {
  const trimmed = value.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const when = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    if (
      when.getUTCFullYear() !== year ||
      when.getUTCMonth() !== month - 1 ||
      when.getUTCDate() !== day
    ) {
      throw new Error("A valid date is required");
    }
    return when;
  }
  const when = new Date(trimmed);
  if (Number.isNaN(when.getTime())) throw new Error("A valid date is required");
  return when;
}

export async function setOpportunityNextStep(input: {
  opportunityId: string;
  /** ISO date (yyyy-mm-dd) or datetime for the planned step. */
  scheduledAt: string;
  /** Short description, e.g. "Follow-up call on proposal". */
  note?: string;
}) {
  const when = parseOpportunityScheduledAt(input.scheduledAt);

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
