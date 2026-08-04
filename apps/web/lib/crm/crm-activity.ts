// Shared CRM timeline writers.
//
// Extracted from lib/actions/crm.ts (BI-1017777D) so the PUBLIC accept-link flow
// can log the same way without importing the capability-guarded crm.ts action
// module — importing it from crm-quote-acceptance's caller would also close an
// import cycle. Plain module, not "use server": crm.ts re-wraps `logActivity`
// as its exported server action.

import crypto from "crypto";
import { prisma } from "@dpf/db";

export type ActivityInput = {
  type: string;
  subject: string;
  body?: string;
  scheduledAt?: string;
  completedAt?: string;
  accountId?: string;
  contactId?: string;
  opportunityId?: string;
  createdById?: string | null;
};

export async function logActivity(input: ActivityInput) {
  return prisma.activity.create({
    data: {
      activityId: `ACT-${crypto.randomUUID()}`,
      type: input.type,
      subject: input.subject,
      body: input.body || null,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      completedAt: input.completedAt ? new Date(input.completedAt) : null,
      accountId: input.accountId || null,
      contactId: input.contactId || null,
      opportunityId: input.opportunityId || null,
      createdById: input.createdById || null,
    },
  });
}

/** Auto-log a system event (no user attribution). */
export async function logSystemActivity(
  subject: string,
  opts: {
    type?: string;
    body?: string;
    accountId?: string;
    contactId?: string;
    opportunityId?: string;
  } = {},
) {
  return logActivity({
    type: opts.type || "system",
    subject,
    body: opts.body,
    accountId: opts.accountId,
    contactId: opts.contactId,
    opportunityId: opts.opportunityId,
    createdById: null,
  });
}
