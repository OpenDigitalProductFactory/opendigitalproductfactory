// Pure utility — maps a customer account / sales opportunity onto its stage in the
// Operational Value Stream (OVSM), so the CRM can show where a relationship sits in the value
// stream (BI-9078F4EE / EP-VSL-SURFACE). No new stage vocabulary: it reuses the canonical
// OVSM stage keys (packages/storefront-templates/src/operational-value-stream.ts) and the
// account/opportunity lifecycle grammars (apps/web/lib/lifecycle-grammars.ts).

import type { OperationalValueStreamStageKey } from "@dpf/storefront-templates";
import { resolveCustomerAccountPoint, resolveOpportunityPoint } from "../lifecycle-grammars";

/** The six PRIMARY OVSM stages a customer relationship can occupy, in order. */
export const CUSTOMER_OVSM_STAGES: OperationalValueStreamStageKey[] = [
  "attract",
  "capture",
  "qualify",
  "deliver",
  "settle",
  "retain",
];

// Account lifecycle STAGE (from CUSTOMER_ACCOUNT_GRAMMAR) → its representative OVSM stage.
// prospect = a captured lead (capture); qualified = qualify; onboarding = delivering first
// value (deliver); active = the recurring back-half (retain); closed = terminal, still shown
// against retain (the account's in-stage state carries the "ended" nuance).
const ACCOUNT_STAGE_TO_OVSM: Record<string, OperationalValueStreamStageKey> = {
  prospect: "capture",
  qualified: "qualify",
  onboarding: "deliver",
  active: "retain",
  closed: "retain",
};

// Opportunity STAGE → OVSM. An open sales opportunity IS the "qualify & schedule" work of the
// value stream; a won deal moves to delivery; a lost deal falls back to capture (an un-converted
// captured lead).
const OPPORTUNITY_STAGE_TO_OVSM: Record<string, OperationalValueStreamStageKey> = {
  qualification: "qualify",
  discovery: "qualify",
  proposal: "qualify",
  negotiation: "qualify",
  closed_won: "deliver",
  closed_lost: "capture",
};

/** OVSM stage for a stored CustomerAccount.status. */
export function accountStatusToOvsmStage(status: string): OperationalValueStreamStageKey {
  const point = resolveCustomerAccountPoint(status);
  return ACCOUNT_STAGE_TO_OVSM[point.stage] ?? "capture";
}

/** OVSM stage for a stored Opportunity.stage. */
export function opportunityStageToOvsmStage(stage: string): OperationalValueStreamStageKey {
  const point = resolveOpportunityPoint(stage);
  return OPPORTUNITY_STAGE_TO_OVSM[point.stage] ?? "qualify";
}

const OVSM_STAGE_LABELS: Record<OperationalValueStreamStageKey, string> = {
  attract: "Attract & Discover",
  capture: "Capture Demand",
  qualify: "Qualify & Schedule",
  deliver: "Deliver the Value",
  settle: "Settle & Account",
  retain: "Retain & Grow",
  "trust-compliance": "Trust & Compliance",
  "operate-improve": "Operate & Improve",
  "return-inspect": "Return & Inspect",
  "receive-store": "Receive & Store",
};

export function ovsmStageLabel(stage: OperationalValueStreamStageKey): string {
  return OVSM_STAGE_LABELS[stage] ?? stage;
}
