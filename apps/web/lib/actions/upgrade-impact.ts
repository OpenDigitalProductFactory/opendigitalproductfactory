"use server";

// apps/web/lib/actions/upgrade-impact.ts
//
// Server action wrapper around the on-demand "What's in this update?"
// summary (BI-C26F7EE1). Same auth gate as the other self-upgrade actions
// (`view_operations`). Action is read-only and advisory — it never queues
// or applies an upgrade.

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { summarizeUpgradeImpact } from "@/lib/self-upgrade/impact";
import type { SummarizeOptions } from "@/lib/self-upgrade/impact";
import type { SummaryResult } from "@/lib/self-upgrade/impact/types";

async function requireOpsAccess(): Promise<void> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "view_operations",
    )
  ) {
    throw new Error("Unauthorized");
  }
}

export async function getUpgradeImpactSummary(
  options?: SummarizeOptions,
): Promise<SummaryResult> {
  await requireOpsAccess();
  return summarizeUpgradeImpact(options ?? {});
}
