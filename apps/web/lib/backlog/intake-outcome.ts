// BI-B1B44777: every new backlog item states the outcome it delivers — what
// will be true, for whom — because the outcome is how anyone tells it is done.
// "How will we know?" is asked only when the outcome is not self-evident.
//
// The outcome lives in the item body, the field every intake path already
// writes (kernel decision DI-1263D968DC26: no new substrate). It is a soft
// prompt, never a gate: an item filed without one is still filed, and the
// filer is told what is missing at the moment it is cheapest to add.

export const OUTCOME_HEADING = "## Outcome";
export const HOW_WE_KNOW_HEADING = "## How we'll know";

/** A heading naming the outcome, or an `Outcome:` line. Prose that mentions outcomes is not one. */
const OUTCOME_STATEMENT = /^\s{0,3}(?:#{1,6}\s+(?:expected\s+|desired\s+|intended\s+)?outcomes?\b|[-*+]?\s*\*{0,2}outcome\*{0,2}\s*:\s*\S)/im;

function text(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Whether the body already states the outcome it delivers. */
export function statesOutcome(body: string | null | undefined): boolean {
  return typeof body === "string" && OUTCOME_STATEMENT.test(body);
}

/**
 * The body an intake path stores: the stated outcome (and, when given, how we
 * will know) first, then the filer's own text. With no outcome the body is
 * returned exactly as it came.
 */
export function composeIntakeBody(args: {
  body?: string | null;
  outcome?: string | null;
  howWeKnow?: string | null;
}): string | null {
  const outcome = text(args.outcome);
  if (!outcome) return args.body ?? null;
  const body = text(args.body);
  const howWeKnow = text(args.howWeKnow);
  const sections = [`${OUTCOME_HEADING}\n${outcome}`];
  if (howWeKnow) sections.push(`${HOW_WE_KNOW_HEADING}\n${howWeKnow}`);
  if (body) sections.push(body);
  return sections.join("\n\n");
}

/** The soft prompt shown when an item is filed without an outcome. It never refuses the filing. */
export const OUTCOME_INTAKE_PROMPT =
  "No outcome stated. Add what will be true, and for whom, once this is done "
  + `(the \`outcome\` field, or an "${OUTCOME_HEADING}" section in the body via update_backlog_item). `
  + "Delivery closes the item when its change merges. Add \"How we'll know\" only when the outcome is not obvious from the change, "
  + "and tag the item `contractual` only when a customer commitment needs a separate acceptance step.";

/** The soft prompt for an item filed without an outcome, or null when it has one. */
export function outcomeIntakeAdvisory(body: string | null | undefined): string | null {
  return statesOutcome(body) ? null : OUTCOME_INTAKE_PROMPT;
}

/**
 * The outcome a customer inquiry is filed for (storefront intake): the
 * customer gets what they asked for, or a clear answer.
 */
export function customerInquiryOutcome(args: {
  customerName?: string | null;
  inquiryRef: string;
  itemLabel?: string | null;
}): string {
  const customer = text(args.customerName) ?? "The customer";
  const item = text(args.itemLabel);
  return item
    ? `${customer} gets what they asked about ${item}, or a clear answer (${args.inquiryRef}).`
    : `${customer} gets what they asked for, or a clear answer (${args.inquiryRef}).`;
}

// ─── Derived outcomes (BI-458CCA8D) ──────────────────────────────────────────
// Routes that file work without a person typing an outcome (detectors, triage
// projections, decomposition) derive one from what they observed. The text is
// deterministic — no model call — so the same detection always states the same
// outcome, and it names the thing that will stop happening or start working.

/**
 * The derived outcome, unless the body already states one. Routes that carry
 * someone else's request (a peer install, an upstream issue) keep the outcome
 * that person wrote and derive one only when they wrote none.
 */
export function outcomeUnlessStated(body: string | null | undefined, derived: string): string | null {
  return statesOutcome(body) ? null : derived;
}

/** A reported platform problem (issue-report triage, admin "send to Build Studio"). */
export function issueReportOutcome(report: {
  title: string;
  routeContext?: string | null;
  reportId: string;
}): string {
  const route = text(report.routeContext);
  return `"${report.title.trim()}" no longer happens${route ? ` on ${route}` : ""} (${report.reportId}).`;
}

/** Technical debt logged through register_tech_debt when the filer states no outcome. */
export function techDebtOutcome(title: string): string {
  return `The shortcut "${title.trim()}" is replaced by the intended design, so nothing has to work around it.`;
}

/** A recurring failure the platform captured (build, self-upgrade, functional test). */
export function recurringFailureOutcome(what: string): string {
  return `${what.trim()} stops recurring: the next run that used to fail succeeds.`;
}
