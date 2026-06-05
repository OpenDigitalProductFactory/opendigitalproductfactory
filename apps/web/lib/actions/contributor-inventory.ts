"use server";

// apps/web/lib/actions/contributor-inventory.ts
// Phase 5 of BI-063BDF1B — server actions backing the Refresh button
// on /platform/development/change-lanes.
//
// Spec: docs/superpowers/specs/2026-05-26-contributor-inventory-sync-design.md
//   §"Manual refresh affordance"
//
// Both actions are admin-gated. The trigger action sends the
// `ops/contributor-inventory-sync.run` Inngest event, which the
// `contributorInventorySyncOnDemand` function in
// apps/web/lib/queue/functions/contributor-inventory-sync.ts consumes.
// The status action is read-only and used by the client's polling loop
// to flip the button out of in-flight state.

import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { inngest } from "@/lib/queue/inngest-client";

const TRIGGER_EVENT = "ops/contributor-inventory-sync.run";
// Permission reuse: refreshing the inventory cron is a platform-admin
// surface; same authority as the backup-trigger action.
const REQUIRED_CAPABILITY = "manage_provider_connections" as const;

async function requireContributorInventoryAdmin(): Promise<void> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      REQUIRED_CAPABILITY,
    )
  ) {
    throw new Error("Unauthorized");
  }
}

/**
 * Refresh affordance — dispatches the on-demand Inngest event so the cron
 * runs out-of-band. The actual `ContributorInventorySyncRun` row is created
 * by the runner once Inngest invokes the handler; this action returns the
 * Inngest event id so the caller can poll until the row appears.
 */
export async function triggerContributorInventorySyncAction(
  reason?: string,
): Promise<{ ok: true; eventIds: string[] } | { ok: false; error: string }> {
  try {
    await requireContributorInventoryAdmin();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  try {
    const result = await inngest.send({
      name: TRIGGER_EVENT,
      data: { triggeredBy: reason ? `ui:${reason}` : "ui" },
    });
    return { ok: true, eventIds: result.ids };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type ContributorInventorySyncStatus = {
  syncRunId: string;
  status: "running" | "completed" | "partial" | "failed";
  startedAt: Date;
  completedAt: Date | null;
  perSourceResult: unknown;
};

/**
 * Read-only status snapshot — used by the client poller to decide whether
 * to keep the spinner spinning or flip to a terminal state. Admin-gated
 * because exposing inventory-cron status outside admin scope leaks
 * platform-internal state. Returns `null` if the run isn't visible yet
 * (event was sent but the runner hasn't created the row).
 */
export async function getContributorInventorySyncStatusAction(
  syncRunIdOrNull?: string,
): Promise<ContributorInventorySyncStatus | null> {
  await requireContributorInventoryAdmin();

  // If the caller doesn't yet have a syncRunId (event just dispatched, the
  // runner hasn't started), look up the most recent run instead.
  const row = syncRunIdOrNull
    ? await prisma.contributorInventorySyncRun.findUnique({
        where: { syncRunId: syncRunIdOrNull },
      })
    : await prisma.contributorInventorySyncRun.findFirst({
        orderBy: { startedAt: "desc" },
      });

  if (!row) return null;
  return {
    syncRunId: row.syncRunId,
    status: row.status as ContributorInventorySyncStatus["status"],
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    perSourceResult: row.perSourceResult,
  };
}
