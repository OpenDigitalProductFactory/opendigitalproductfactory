import type { AttentionItem, AttentionSource } from "./types";

const HEADLINE: Record<AttentionSource, string> = {
  escalation: "Choose what happens to this build?",
  "ai-decision": "Make this business decision?",
  "paused-ai": "Help your coworker continue?",
  "scheduled-task": "Review this scheduled task?",
  "agent-proposal": "Let this coworker do more?",
  "approval-outbound": "Send this message?",
  "approval-bill": "Approve this bill?",
  "approval-expense": "Approve this expense?",
  "compliance-submission": "File this report?",
  "research-proposal": "Approve this research?",
  "ai-readiness-blocker": "Choose an intelligence setup fix?",
  "platform-health": "Choose how to handle this outage?",
  "provider-credential": "Reconnect this service?",
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
  "ai-readiness-blocker": "Technology",
  "platform-health": "Platform operations",
  "provider-credential": "Technology",
};

export function specialistFor(source: AttentionSource): string {
  return SPECIALIST[source];
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
      return "Your team cannot finish this work without a choice from you.";
    case "research-proposal":
      return "This research may improve how your team serves customers.";
    default:
      return "This technical issue matters only if it changes customer or business work.";
  }
}

export function consequenceFor(item: AttentionItem): string {
  if (item.triage.blastRadius && !looksLikeInternalId(item.triage.blastRadius)) {
    return `If you do nothing, ${lowerFirst(item.triage.blastRadius)} stays blocked.`;
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
    case "research-proposal":
      return "keep this in the weekly review unless it affects a decision due sooner.";
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
