import { listStallThresholds } from "@/lib/actions/stall-threshold-admin";
import { StallThresholdsClient } from "./StallThresholdsClient";

export const dynamic = "force-dynamic";

/**
 * Admin → Build Studio → Stall Thresholds.
 *
 * Operator-editable per-phase timeouts consumed by the ops/taskrun-watchdog
 * cron. Changes take effect on the next watchdog tick — no portal restart
 * required (the watchdog reads thresholds fresh every minute).
 *
 * BI-4ab6be39 Phase G.
 */
export default async function StallThresholdsAdminPage() {
  const rows = await listStallThresholds();
  return <StallThresholdsClient initialRows={rows} />;
}
