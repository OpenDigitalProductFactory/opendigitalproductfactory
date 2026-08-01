// apps/web/lib/business-activity-sim/archetype-flows.ts
//
// Business Activity Simulator — per-archetype operational flows (P2).
// EP-BUSINESS-ACTIVITY-SIM · BI-78B83F58.
//
// One BusinessFlow per archetype: an ordered operational lifecycle plus the shared
// runBillingCycle. Field-service (trades) reuses the REAL @dpf/validators dispatch
// vocabulary via P1's runFieldServiceFlow. SaaS and retail use sim-local
// lifecycles — a deliberate FINDING, not an oversight: @dpf/validators has a rich
// lifecycle ONLY for field-dispatch, so the operational vocabulary for non-trades
// archetypes is a real substrate gap (a candidate follow-up BI). The financial
// half is identical for all of them, which is exactly why one oracle set scores
// the whole matrix.

import { runFieldServiceFlow } from "./field-service-flow";
import { runBillingCycle, type BillingInput, type FinancialFlowShape } from "./billing-cycle";

export type ArchetypeScenario = BillingInput & { id: string };

export type ArchetypeFlowResult = FinancialFlowShape & {
  archetypeId: string;
  scenarioId: string;
  /** The operational lifecycle statuses the flow passed through, in order. */
  lifecycle: string[];
};

/**
 * A minimal operational lifecycle: the ordered statuses a job/subscription/order
 * passes through to the terminal "paid", and which of them count as
 * service-delivered (the states that precede — and therefore justify — the
 * invoice). Every lifecycle ends in "invoiced" then "paid".
 */
type LifecycleSpec = {
  statuses: string[];
  workCompleteStatuses: string[];
};

function runGenericArchetypeFlow(
  archetypeId: string,
  spec: LifecycleSpec,
  scenario: ArchetypeScenario,
): ArchetypeFlowResult {
  const billing = runBillingCycle(scenario);
  const lifecycle: string[] = [];
  let workCompletedBeforeInvoice = false;
  for (const status of spec.statuses) {
    lifecycle.push(status);
    if (spec.workCompleteStatuses.includes(status) && status !== "invoiced" && status !== "paid") {
      workCompletedBeforeInvoice = true;
    }
  }
  return {
    ...billing,
    archetypeId,
    scenarioId: scenario.id,
    lifecycle,
    finalStatus: lifecycle[lifecycle.length - 1],
    workCompletedBeforeInvoice,
  };
}

export type ArchetypeFlow = {
  /** The real StorefrontArchetype id (packages/storefront-templates). */
  archetypeId: string;
  label: string;
  run: (scenario: ArchetypeScenario) => ArchetypeFlowResult;
  defaultScenarios: ArchetypeScenario[];
};

// SaaS: a subscription is delivered while "active", then billed and settled.
const SAAS_SPEC: LifecycleSpec = {
  statuses: ["trial", "active", "invoiced", "paid"],
  workCompleteStatuses: ["active", "invoiced", "paid"],
};

// Retail POS: goods are fulfilled at the counter, then the receipt bills + settles.
const RETAIL_SPEC: LifecycleSpec = {
  statuses: ["cart", "checkout", "fulfilled", "invoiced", "paid"],
  workCompleteStatuses: ["fulfilled", "invoiced", "paid"],
};

/**
 * The archetype coverage set. Keyed by REAL StorefrontArchetype ids so the matrix
 * maps 1:1 onto the platform's archetypes. Field-service delegates to P1 (real
 * dispatch lifecycle); SaaS + retail use the generic lifecycle flow.
 */
export const ARCHETYPE_FLOWS: ArchetypeFlow[] = [
  {
    archetypeId: "trades-maintenance",
    label: "Field service (trades)",
    run: (scenario) => {
      const r = runFieldServiceFlow(scenario);
      return { ...r, archetypeId: "trades-maintenance" };
    },
    defaultScenarios: [
      { id: "fs-taxed-full", customerAccountId: "fs-c1", subtotal: 300, taxAmount: 30 },
      { id: "fs-untaxed-full", customerAccountId: "fs-c2", subtotal: 450 },
      { id: "fs-partial", customerAccountId: "fs-c3", subtotal: 200, taxAmount: 20, paymentAmount: 150 },
    ],
  },
  {
    archetypeId: "software-platform",
    label: "SaaS subscription",
    run: (scenario) => runGenericArchetypeFlow("software-platform", SAAS_SPEC, scenario),
    defaultScenarios: [
      { id: "saas-monthly", customerAccountId: "saas-c1", subtotal: 99 },
      { id: "saas-annual-taxed", customerAccountId: "saas-c2", subtotal: 1200, taxAmount: 96 },
    ],
  },
  {
    archetypeId: "retail-goods",
    label: "Retail POS",
    run: (scenario) => runGenericArchetypeFlow("retail-goods", RETAIL_SPEC, scenario),
    defaultScenarios: [
      { id: "retail-taxed", customerAccountId: "retail-c1", subtotal: 80, taxAmount: 8 },
      { id: "retail-partial", customerAccountId: "retail-c2", subtotal: 200, taxAmount: 20, paymentAmount: 150 },
    ],
  },
];
