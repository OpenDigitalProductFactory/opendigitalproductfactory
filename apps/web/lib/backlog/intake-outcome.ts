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
