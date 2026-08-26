import type { AttentionItem, AttentionSource } from "./types";

const HEADLINE: Record<AttentionSource, string> = {
  escalation: "What should happen to this build?",
  "ai-decision": "Make this business decision?",
  "paused-ai": "Help your coworker continue?",
  "scheduled-task": "Review this scheduled task?",
  "agent-proposal": "Let this coworker do more?",
  "approval-outbound": "Send this message?",
  "approval-bill": "Approve this bill?",
  "approval-expense": "Approve this expense?",
  "compliance-submission": "File this report?",
  "research-proposal": "Approve this research?",
  "coworker-memory": "Review what your coworker learned?",
  "ai-readiness-blocker": "How should we fix your intelligence setup?",
  "platform-health": "How should we handle this outage?",
  "provider-credential": "Reconnect this service?",
  "reservation-exception": "Handle this reservation?",
  "hospitality-capacity": "Resolve this capacity issue?",
  "storefront-inquiry": "Reply to this enquiry?",
  "business-journey": "How should we fix this for customers?",
  "compliance-source-freshness": "Renew this compliance evidence?",
  "coworker-envelope": "Approve this coworker action?",
  "skill-proposal": "Approve this change to a coworker skill?",
};

const SPECIALIST: Record<AttentionSource, string> = {
  escalation: "Platform operations",
  "ai-decision": "Business operations",
  "paused-ai": "Digital workforce",
  "scheduled-task": "Digital workforce",
  "agent-proposal": "Digital workforce",
  "approval-outbound": "Marketing",
  "approval-bill": "Finance",
  "approval-expense": "Finance",
  "compliance-submission": "Compliance",
  "research-proposal": "Research",
  "coworker-memory": "Digital workforce",
  "ai-readiness-blocker": "Technology",
  "platform-health": "Platform operations",
  "provider-credential": "Technology",
  "reservation-exception": "Front of house",
  "hospitality-capacity": "Hospitality operations",
  "storefront-inquiry": "Front of house",
  "business-journey": "Front of house",
  "compliance-source-freshness": "Legal and compliance",
  "coworker-envelope": "Digital workforce",
  "skill-proposal": "Digital workforce",
};

export function specialistFor(source: AttentionSource): string {
  return SPECIALIST[source];
}

// Approval sources whose headline already says what the decision is — they do not
// need a separate "what is happening" rationale line.
const SELF_EXPLANATORY_SOURCES = new Set<AttentionSource>([
  "approval-bill",
  "approval-expense",
  "approval-outbound",
  "compliance-submission",
]);

/** Source context that is valuable to builders but is not safe owner copy.
 * Keep the raw `item.context` unchanged for `technicalFields()` and replace only
 * the collapsed situation line. This is the progressive-disclosure boundary:
 * translation here, complete source record one click down. */
const OWNER_SAFE_SITUATION: Partial<Record<AttentionSource, string>> = {
  "coworker-memory": "A coworker saved a new note from completed work.",
};

/** The plain "what the coworker was doing and why it stalled" line. Surfaced from
 *  the item's own context one-liner for sources whose headline is generic
 *  (blocked/paused/proposal); undefined for self-explanatory approvals. This is
 *  the rationale the owner needs to decide — it was previously discarded. */
export function situationFor(item: AttentionItem): string | undefined {
  if (SELF_EXPLANATORY_SOURCES.has(item.source)) return undefined;
  const translated = OWNER_SAFE_SITUATION[item.source];
  if (translated) return translated;
  const context = (item.context ?? "").trim();
  return context.length > 0 ? context : undefined;
}

export function headlineFor(item: AttentionItem): string {
  if (
    item.source === "escalation" &&
    /(?:upgrade[- ]to[- ]gpu|speechtotext|voice typing)/i.test(item.title)
  ) {
    return "Turn on faster voice typing?";
  }
  if (item.source === "agent-proposal" && !/proactiv/i.test(item.title)) {
    return "Approve this coworker action?";
  }
  return HEADLINE[item.source];
}

export function whyItMattersFor(item: AttentionItem): string {
  switch (item.source) {
    case "approval-bill":
      return "Paying the right bills on time keeps your business supplied and avoids late fees.";
    case "approval-expense":
      return "This pays back a team member and keeps your business records accurate.";
    case "approval-outbound":
      return "Customers may see this message as soon as you approve it.";
    case "compliance-submission":
      return "This report helps your business meet an external filing duty.";
    case "paused-ai":
    case "ai-decision":
    case "agent-proposal":
    case "coworker-envelope":
      return "Your team cannot finish this work without a choice from you.";
    case "research-proposal":
      return "This research may improve how your team serves customers.";
    case "coworker-memory":
      return "Your digital team is accumulating working memory from completed work.";
    case "reservation-exception":
      return "A guest booked through your storefront and is waiting to hear back.";
    case "hospitality-capacity":
      return "This capacity issue can prevent a reservation, event, production order, or delivery from being fulfilled.";
    default:
      return "This technical issue matters only if it changes customer or business work.";
  }
}

// Placeholder blast-radius strings that read as vague ("a coworker task stays
// blocked") — skip them so the consequence falls through to a source-specific line.
const GENERIC_BLAST_RADIUS = new Set(["a coworker task", "a coworker waiting on approval"]);

export function consequenceFor(item: AttentionItem): string {
  if (item.source === "reservation-exception") {
    return "If you do nothing, the guest is left without a confirmed reservation.";
  }
  if (item.source === "hospitality-capacity") {
    return "If you do nothing, the affected hospitality demand or resource stays unresolved.";
  }
  const blastRadius = item.triage.blastRadius;
  if (
    blastRadius &&
    !looksLikeInternalId(blastRadius) &&
    !GENERIC_BLAST_RADIUS.has(blastRadius.trim().toLowerCase())
  ) {
    return `If you do nothing, ${lowerFirst(blastRadius)} stays blocked.`;
  }
  switch (item.source) {
    case "approval-bill":
      return "If you do nothing, the bill may become late and the supplier may follow up.";
    case "approval-expense":
      return "If you do nothing, the claim stays unpaid.";
    case "approval-outbound":
      return "If you do nothing, the message stays private and is not sent.";
    case "compliance-submission":
      return "If you do nothing, the report stays unfiled and may miss its due date.";
    case "research-proposal":
      return "If you do nothing, the research waits for the weekly review.";
    case "coworker-memory":
      return "If you do nothing, the note remains available to that coworker and can be reviewed later.";
    case "paused-ai":
    case "ai-decision":
    case "agent-proposal":
      return "If you do nothing, your coworker stays stuck here and the work behind it waits.";
    case "coworker-envelope":
      return "If you do nothing, the approval window closes and your coworker stops.";
    default:
      return "If you do nothing, this work stays paused while your digital team keeps it safe.";
  }
}

export function recommendationFor(item: AttentionItem): string {
  switch (item.source) {
    case "approval-bill":
    case "approval-expense":
      return "review the amount and recipient, then approve it if both are right.";
    case "approval-outbound":
      return "read the customer-facing copy once, then send it if it sounds like your business.";
    case "compliance-submission":
      return "check the recipient and due date before filing.";
    case "agent-proposal":
      return "accept only the stated boundary; this does not give the coworker new authority.";
    case "coworker-envelope":
      return "check the exact record and the time left, then approve only if both are right.";
    case "research-proposal":
      return "keep this in the weekly review unless it affects a decision due sooner.";
    case "coworker-memory":
      return "scan it in the digest and open the memory page only if it looks stale, too broad, or unsafe.";
    case "reservation-exception":
      return "check the date, time, and party size, then confirm the table or offer another time.";
    case "hospitality-capacity":
      return "review the affected period, demand, and resource status, then restore supply or move the demand.";
    default:
      return "keep this with the specialist unless it forces a business choice from you.";
  }
}

function looksLikeInternalId(value: string): boolean {
  return /^(?:BI|FB|PIR|DI|TR)-[A-Z0-9-]+$/i.test(value.trim());
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}
