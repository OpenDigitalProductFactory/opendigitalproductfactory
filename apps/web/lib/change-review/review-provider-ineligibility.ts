// A required review that no provider could run must say so (BI-9F620FE1).
//
// When every eligible provider is paused, unconnected or excluded, the review
// ends inconclusive and Failure Readiness used to report only "No
// failure-analysis review exists". Thirty PRs sat blocked behind that generic
// line while the local provider was paused. This names the data class, the
// router's exclusions and the enabled providers that are not available, so the
// single point of failure is visible where the merge is blocked.

import { readRoutingEligibility, type RoutingEligibility } from "@/lib/inference/routing-exclusion-buckets";

export type ProviderAvailabilityRow = { providerId: string; status: string; connectionStatus: string | null };

const CONNECTION_LABEL: Record<string, string> = {
  paused: "paused by an operator",
  unconfigured: "not connected",
  error: "connection error",
  expired: "sign-in expired",
};

/** Validated eligibility entries from a persisted receipt result. */
export function readReceiptEligibility(value: unknown): RoutingEligibility[] {
  return Array.isArray(value) ? value.flatMap(entry => readRoutingEligibility(entry) ?? []) : [];
}

/** Enabled providers whose connection cannot take work, worded for an operator. */
export function unavailableProviders(rows: readonly ProviderAvailabilityRow[]): string[] {
  return rows
    .filter(row => row.status === "active" && row.connectionStatus !== null && row.connectionStatus !== "active")
    .map(row => `${row.providerId} ${CONNECTION_LABEL[row.connectionStatus!] ?? row.connectionStatus}`)
    .sort();
}

/** The Failure Readiness reason for a review no provider could run. Leads with the cause: GitHub keeps 140 characters. */
export function describeReviewIneligibility(eligibility: readonly RoutingEligibility[], unavailable: readonly string[]): string {
  const entry = eligibility[0]!;
  const exclusions = entry.exclusions.map(item => `${item.count} ${item.bucket}`).join(", ");
  return [
    `No AI provider could run the required review (data class ${entry.sensitivity}, residency ${entry.residencyPolicy}).`,
    `${entry.excludedCount} endpoint${entry.excludedCount === 1 ? "" : "s"} excluded${exclusions ? ` (${exclusions})` : ""}.`,
    ...(unavailable.length ? [`Unavailable: ${unavailable.join("; ")}.`] : []),
    "Connect or resume a provider cleared for this data class, then recover the review.",
  ].join(" ");
}

export async function loadProviderAvailability(): Promise<ProviderAvailabilityRow[]> {
  const { prisma } = await import("@dpf/db");
  const providers = await prisma.modelProvider.findMany({
    where: { status: "active", endpointType: { in: ["llm", "responses"] } },
    select: { providerId: true, status: true, connections: { select: { status: true }, take: 1 } },
  });
  return providers.map(provider => ({ providerId: provider.providerId, status: provider.status,
    connectionStatus: provider.connections[0]?.status ?? null }));
}
