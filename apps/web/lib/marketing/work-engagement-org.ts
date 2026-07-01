// Marketing → work-capture seam (BI-4C5F7A2D slice 4).
//
// Resolves the org's marketing workspace and computes the materialization window
// from a horizon, then delegates to the org-agnostic work-capture core. This is
// where the marketing coworker's long-running/recurring campaign work becomes a
// WorkEngagement — the primitive stays domain-neutral; org/context binding lives
// here.

import { getMarketingWorkspaceSnapshot } from "../marketing";
import { createRecurringWorkEngagement as createCore } from "../work-capture/work-engagement";

const DEFAULT_HORIZON_DAYS = 75;
const MAX_MATERIALIZED_PER_CREATE = 500;

export async function createRecurringWorkEngagement(input: {
  title: string;
  requestedOutcome?: string;
  rrule: string;
  timezone: string;
  anchorAt: string; // ISO
  until?: string; // ISO
  horizonDays?: number;
  createdByAgentId?: string | null;
}): Promise<
  | { parentId: string; message: string; data: { scheduleId: string; instances: number } }
  | { error: string; message: string }
> {
  const snapshot = await getMarketingWorkspaceSnapshot();
  if (!snapshot) {
    return { error: "no-workspace", message: "No configured marketing workspace; cannot create recurring work." };
  }
  const anchorAt = new Date(input.anchorAt);
  if (Number.isNaN(anchorAt.getTime())) {
    return { error: "invalid-input", message: "anchorAt must be a valid ISO datetime." };
  }
  const until = input.until ? new Date(input.until) : null;
  if (until && Number.isNaN(until.getTime())) {
    return { error: "invalid-input", message: "until must be a valid ISO datetime." };
  }
  const horizonDays = input.horizonDays && input.horizonDays > 0 ? input.horizonDays : DEFAULT_HORIZON_DAYS;
  const windowStart = anchorAt;
  const windowEnd = new Date(Math.max(Date.now(), anchorAt.getTime()) + horizonDays * 86_400_000);

  const result = await createCore({
    organizationId: snapshot.organization.id,
    title: input.title.trim(),
    requestedOutcome: input.requestedOutcome?.trim(),
    createdByAgentId: input.createdByAgentId ?? null,
    rrule: input.rrule,
    timezone: input.timezone,
    anchorAt,
    until,
    windowStart,
    windowEnd,
    maxOccurrences: MAX_MATERIALIZED_PER_CREATE,
  });
  return {
    parentId: result.parentId,
    message: `Created recurring work "${input.title}" — ${result.instances} instance(s) materialized over ${horizonDays} days.`,
    data: { scheduleId: result.scheduleId, instances: result.instances },
  };
}
