import type { ContributorLaneStatus } from "@/lib/contributor-change-lanes/types";
import { StatusBadge, type Intent } from "@/components/ui/report-kit";

// Contributor-lane status → semantic intent. Kept local (rather than in the
// shared STATUS_INTENT registry) because lane status is niche to this surface;
// the shared StatusBadge still owns all rendering + token color.
const LANE_INTENT: Record<ContributorLaneStatus, Intent> = {
  blocked: "danger",
  starting: "warning",
  verifying: "warning",
  running: "accent",
  "ready-for-review": "success",
  claimed: "neutral",
  available: "neutral",
  released: "neutral",
  stale: "warning",
};

export function ChangeLaneStatusBadge({ status }: { status: ContributorLaneStatus }) {
  return <StatusBadge intent={LANE_INTENT[status]} label={status} variant="outline" />;
}
