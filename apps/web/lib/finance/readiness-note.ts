// Finance readiness-note prompt builder.
//
// BI-3326DA86 asks that "the coworker can draft readiness notes" for a
// food-hospitality owner. This builds the PROMPT the existing Finance
// Specialist coworker is dispatched with (see AiFinanceCoworkerAskButton →
// dispatchAgentPrompt) — it does not add agent infrastructure of its own.
//
// The prompt is grounded in the figures already on screen so the coworker
// drafts against the owner's real position instead of inventing numbers, and it
// explicitly constrains the coworker to a DRAFT FOR REVIEW: no action taken, no
// claim that money moved. That constraint matters because DPF is not the
// payment rail — the same honesty boundary the payment-run disclosure enforces.
//
// Dependency-free (no prisma, no react) so it unit-tests in isolation.

import type {
  FinanceMetricKey,
  FinanceMoneyJob,
  FinanceSurfaceSubtype,
} from "./finance-surface";

export type ReadinessMetricValue = {
  /** Pre-formatted display value, e.g. "£1,250.00" or "3". */
  value: string;
  hint?: string;
};

const BUSINESS_LABEL: Record<FinanceSurfaceSubtype, string> = {
  restaurant: "restaurant",
  catering: "catering business",
  bakery: "bakery",
  generic: "food and drink business",
  "pet-rescue": "animal rescue",
};

/**
 * Build the readiness-note prompt for the Finance Specialist coworker.
 *
 * Only money jobs that actually have a live figure are quoted — a job with no
 * metric is omitted rather than described with a placeholder, so the coworker is
 * never handed a number that does not exist.
 */
export function buildFinanceReadinessNotePrompt(input: {
  subtype: FinanceSurfaceSubtype;
  moneyJobs: FinanceMoneyJob[];
  metrics: Partial<Record<FinanceMetricKey, ReadinessMetricValue>>;
}): string {
  const business = BUSINESS_LABEL[input.subtype];

  const lines = input.moneyJobs
    .filter((job) => job.kind === "monitor" && job.metricKey != null)
    .map((job) => {
      const metric = input.metrics[job.metricKey as FinanceMetricKey];
      if (!metric) return null;
      const hint = metric.hint ? ` (${metric.hint})` : "";
      return `- ${job.label}: ${metric.value}${hint} — ${job.question}`;
    })
    .filter((line): line is string => line != null);

  const header = `Draft a short finance readiness note for my ${business}.`;

  const guardrails = [
    "Write 3-5 short bullets in plain language. For each: what needs attention, why it matters, and the safest next action.",
    "Ground every point in the figures above — do not invent numbers or estimate anything that is not listed.",
    "This is a DRAFT for me to review. Do not take any action, do not send anything to anyone, and do not say that money has been paid or moved — recording a payment in DPF is not a bank transfer.",
  ].join("\n");

  if (lines.length === 0) {
    return [
      header,
      "",
      "No live finance figures are available yet for this business.",
      "",
      "Explain in 3-5 short bullets what I need to set up first before a readiness note is meaningful, and the safest next action for each.",
      "This is a DRAFT for me to review. Do not take any action on my behalf.",
    ].join("\n");
  }

  return [header, "", "Today's position:", ...lines, "", guardrails].join("\n");
}
