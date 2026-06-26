"use server";

// apps/web/lib/actions/upgrade-impact.ts
//
// Server action wrapper around the on-demand "What's in this update?"
// summary (BI-C26F7EE1). Same auth gate as the other self-upgrade actions
// (`view_operations`). Action is read-only and advisory — it never queues
// or applies an upgrade.

import { requireCapability } from "@/lib/actions/shared/guards";
import { summarizeUpgradeImpact } from "@/lib/self-upgrade/impact";
import type { SummarizeOptions } from "@/lib/self-upgrade/impact";
import type { SummaryResult } from "@/lib/self-upgrade/impact/types";

async function requireOpsAccess(): Promise<void> {
  await requireCapability("view_operations");
}

export async function getUpgradeImpactSummary(
  options?: SummarizeOptions,
): Promise<SummaryResult> {
  await requireOpsAccess();
  return summarizeUpgradeImpact(options ?? {});
}
