// BI-B1B44777: every new backlog item states the outcome it delivers — what
// will be true, for whom — because the outcome is how anyone tells it is done.
// "How will we know?" is asked only when the outcome is not self-evident.
//
// Since BI-8DE5429B the outcome is a field, BacklogItem.outcome (see "The
// outcome field" below). Routes that still compose an Outcome section into the
// body are lifted into that field by the hourly reconcile job. It is a soft
// prompt, never a gate: an item filed without one is still filed, with a
// derived draft the filer is told about.

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

/** An improvement proposal filed as work: the friction it names stops, or the proposal is in place. */
export function improvementProposalOutcome(proposal: {
  title: string;
  proposalId: string;
  observedFriction?: string | null;
}): string {
  const friction = text(proposal.observedFriction);
  return friction
    ? `The friction this proposal names no longer happens: ${friction}`
    : `"${proposal.title.trim()}" is in place, as proposed in ${proposal.proposalId}.`;
}

// ─── The outcome field (BI-8DE5429B) ─────────────────────────────────────────
// Founder direction 2026-10-28: "The outcome is an aspect of the BI. No BI
// should be without a clear outcome." WWMD DI-342D45001EF5 makes it a field:
// BacklogItem.outcome, with outcomeSource saying who wrote it. A person or
// agent stating it writes `stated`; when nobody does, the platform derives a
// draft from the item's own context and writes `derived`, so the gap is
// visible and anyone can correct it (WWMD DI-D50BBC916B6D: deterministic, no
// model call, the same input always derives the same draft). Intake is never
// refused for a missing outcome.

export const OUTCOME_SOURCES = ["stated", "derived"] as const;
export type OutcomeSource = (typeof OUTCOME_SOURCES)[number];

/** The column's practical ceiling; an outcome is one or two sentences. */
export const OUTCOME_MAX_LENGTH = 2000;

const OUTCOME_HEADING_LINE = /^\s{0,3}#{1,6}\s+(?:expected\s+|desired\s+|intended\s+)?outcomes?\b.*$/i;
const OUTCOME_COLON_LINE = /^\s{0,3}[-*+]?\s*\*{0,2}outcome\*{0,2}\s*:\s*\*{0,2}\s*(\S.*)$/i;
const ANY_HEADING_LINE = /^\s{0,3}#{1,6}\s+\S/;

function clip(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > OUTCOME_MAX_LENGTH ? `${trimmed.slice(0, OUTCOME_MAX_LENGTH - 1).trimEnd()}…` : trimmed;
}

/**
 * The outcome a body already states: the text under its Outcome heading (up
 * to the next heading), or the text of an `Outcome:` line. Null when the body
 * states none.
 */
export function statedOutcomeFromBody(body: string | null | undefined): string | null {
  if (typeof body !== "string" || !body.trim()) return null;
  const lines = body.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const colon = OUTCOME_COLON_LINE.exec(line);
    if (colon && !ANY_HEADING_LINE.test(line)) {
      const value = colon[1]!.replace(/\*{1,2}$/, "").trim();
      if (value) return clip(value);
    }
    if (OUTCOME_HEADING_LINE.test(line)) {
      const section: string[] = [];
      for (let next = index + 1; next < lines.length && !ANY_HEADING_LINE.test(lines[next]!); next += 1) {
        section.push(lines[next]!);
      }
      const value = section.join("\n").trim();
      if (value) return clip(value);
    }
  }
  return null;
}

const TITLE_TAG_PREFIX = /^(?:\s*\[[^\]]{1,40}\]\s*)+/;

/** A title reduced to the thing it names: no `[tag]` prefixes, no trailing stop. */
function subjectOf(title: string): string {
  const cleaned = title.replace(TITLE_TAG_PREFIX, "").trim().replace(/[.\s]+$/, "");
  return cleaned || title.trim() || "This item";
}

/**
 * A draft outcome derived from the item's own context when nobody stated one.
 * Deterministic: a defect's draft says the reported problem no longer
 * happens; any other work's draft says the thing it names is in place and in
 * use. It is a draft to correct, and is stored as `derived`.
 */
export function deriveDraftOutcome(item: { title: string; workType?: string | null }): string {
  const subject = subjectOf(item.title);
  if (item.workType === "bug") {
    return clip(`The reported problem no longer happens: "${subject}".`);
  }
  return clip(`"${subject}" is in place and working for the people it is for.`);
}

/**
 * The outcome an item is stored with, and who wrote it. An explicit outcome
 * wins; an Outcome section the filer wrote in the body counts as stated;
 * otherwise a draft is derived.
 */
export function resolveItemOutcome(item: {
  outcome?: string | null;
  body?: string | null;
  title: string;
  workType?: string | null;
}): { outcome: string; outcomeSource: OutcomeSource } {
  const explicit = text(item.outcome);
  if (explicit) return { outcome: clip(explicit), outcomeSource: "stated" };
  const fromBody = statedOutcomeFromBody(item.body);
  if (fromBody) return { outcome: fromBody, outcomeSource: "stated" };
  return { outcome: deriveDraftOutcome(item), outcomeSource: "derived" };
}

/** The soft note returned when intake had to derive the outcome. It never refuses the filing. */
export function derivedOutcomeAdvisory(outcome: string): string {
  return `No outcome stated, so a draft was derived and marked derived: "${outcome}" `
    + "Correct it with update_backlog_item (`outcome`) if it is not what will be true, and for whom, once this is done. "
    + "Delivery closes the item when its change merges. Add \"How we'll know\" only when the outcome is not obvious from the change, "
    + "and tag the item `contractual` only when a customer commitment needs a separate acceptance step.";
}

/**
 * The body the ingest front door stores now that the outcome is a field:
 * "How we'll know" first when the filer gave it, then the filer's own text.
 */
export function composeHowWeKnowBody(args: { body?: string | null; howWeKnow?: string | null }): string | null {
  const howWeKnow = text(args.howWeKnow);
  if (!howWeKnow) return args.body ?? null;
  const body = text(args.body);
  return body ? `${HOW_WE_KNOW_HEADING}\n${howWeKnow}\n\n${body}` : `${HOW_WE_KNOW_HEADING}\n${howWeKnow}`;
}
