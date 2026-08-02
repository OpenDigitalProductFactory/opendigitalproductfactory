import type { CapacityAttentionKind, CapacityAttentionSignal } from "@/lib/capacity/contracts";

export interface RentalPrimaryAttention {
  signalId: string;
  kind: CapacityAttentionKind;
  title: string;
  detail: string;
  recommendedAction: string;
  urgency: "critical" | "high" | "medium" | "opportunity";
}

interface AttentionPresentation {
  rank: number;
  title: string;
  recommendedAction: string;
  urgency: RentalPrimaryAttention["urgency"];
}

const PRESENTATION: Partial<Record<CapacityAttentionKind, AttentionPresentation>> = {
  "overdue-return": {
    rank: 100,
    title: "Overdue return",
    recommendedAction: "Contact the customer and protect the next booking window.",
    urgency: "critical",
  },
  "time-overlap": {
    rank: 95,
    title: "Booking conflict",
    recommendedAction: "Choose a substitute unit or adjust the booking window.",
    urgency: "critical",
  },
  "capacity-exceeded": {
    rank: 94,
    title: "Rental capacity exceeded",
    recommendedAction: "Move demand to available stock or arrange a sub-rental.",
    urgency: "critical",
  },
  "maintenance-hold": {
    rank: 90,
    title: "Maintenance hold",
    recommendedAction: "Confirm downtime and protect every affected reservation.",
    urgency: "high",
  },
  "return-inspection": {
    rank: 85,
    title: "Return inspection due",
    recommendedAction: "Inspect the return and record damage before re-pooling.",
    urgency: "high",
  },
  "kit-incomplete": {
    rank: 82,
    title: "Kit incomplete",
    recommendedAction: "Locate or substitute the missing kit items before pickup.",
    urgency: "high",
  },
  "access-not-ready": {
    rank: 80,
    title: "Storage access not ready",
    recommendedAction: "Resolve the access or overlock state before move-in.",
    urgency: "high",
  },
  "verification-gap": {
    rank: 75,
    title: "Checkout verification incomplete",
    recommendedAction: "Complete customer verification before releasing the unit.",
    urgency: "medium",
  },
  "repool-not-ready": {
    rank: 70,
    title: "Not ready to re-pool",
    recommendedAction: "Complete readiness work before offering this unit again.",
    urgency: "medium",
  },
  "occupancy-opportunity": {
    rank: 60,
    title: "Fill a vacant unit",
    recommendedAction: "Allocate the best-fit waiting tenant to this unit.",
    urgency: "opportunity",
  },
  "waitlist-demand": {
    rank: 55,
    title: "Storage waitlist demand",
    recommendedAction: "Review upcoming move-outs and offer the closest-fit unit.",
    urgency: "opportunity",
  },
  "idle-capacity": {
    rank: 40,
    title: "Ready fleet is idle",
    recommendedAction: "Review upcoming demand, transfers, and promotion opportunities.",
    urgency: "opportunity",
  },
};

export function selectRentalPrimaryAttention(
  signals: readonly CapacityAttentionSignal[],
): RentalPrimaryAttention | null {
  const selected = signals
    .map((item, index) => ({ item, index, presentation: PRESENTATION[item.kind] }))
    .filter((candidate): candidate is typeof candidate & { presentation: AttentionPresentation } =>
      candidate.presentation !== undefined)
    .sort((left, right) =>
      right.presentation.rank - left.presentation.rank || left.index - right.index)[0];
  if (!selected) return null;
  return {
    signalId: selected.item.signalId,
    kind: selected.item.kind,
    title: selected.presentation.title,
    detail: selected.item.detail,
    recommendedAction: selected.presentation.recommendedAction,
    urgency: selected.presentation.urgency,
  };
}
