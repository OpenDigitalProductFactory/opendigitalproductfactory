// Inbound responder for email-postmark.
//
// Each newly persisted InboundChannelMessage runs through:
//   1. rule-based pre-filter: known spam patterns, bounces, no-reply senders.
//   2. LLM classifier (qualified-inquiry | support | spam | other) — the
//      marketing-specialist agent answers a focused classifier turn.
//   3. side-effects keyed by classification:
//      - qualified-inquiry: create/link Engagement; draft a holding-pattern
//        reply via OutboundDraft(sourceType="inbound-channel-message").
//      - support: skip Engagement; draft a holding-pattern reply.
//      - spam / other: no draft, no Engagement.
//
// Reply prompt is constrained to a "I'll follow up by X" holding pattern.
// Never makes commitments. The actual outbound response goes through the
// same human-approval queue the rest of Phase 1/2 use.

import { prisma } from "@dpf/db";

export type InboundClassification = "qualified-inquiry" | "support" | "spam" | "other";

const SPAM_FROM_PATTERNS = [
  /^no-?reply@/i,
  /^postmaster@/i,
  /^mailer-daemon@/i,
  /^bounces?\+/i,
];

const HOLDING_REPLY_BY_CLASSIFICATION: Readonly<Record<InboundClassification, string>> = {
  "qualified-inquiry":
    "Thanks for reaching out — this looks like the right fit for a quick conversation. I want to make sure I read your context properly before I respond in detail. I'll review the thread today and follow up with concrete next steps within one business day. — {{senderName}}",
  support:
    "Thanks for the note. I want to make sure I get you the right answer rather than a fast one, so I'm pulling in the right context now. I'll follow up within one business day with either a resolution or a clear next step. — {{senderName}}",
  spam: "",
  other:
    "Thanks for reaching out. Let me make sure this gets to the right person on our side — I'll reply within one business day with either an answer or a redirect. — {{senderName}}",
};

export type ResponderResult = {
  classification: InboundClassification;
  draftId: string | null;
  engagementId: string | null;
};

export function runInboundResponder(input: {
  inboundId: string;
}): Promise<ResponderResult> {
  return runInboundResponderOnce(input);
}

async function runInboundResponderOnce(input: { inboundId: string }): Promise<ResponderResult> {
  const inbound = await prisma.inboundChannelMessage.findUnique({
    where: { inboundId: input.inboundId },
  });
  if (!inbound) {
    return { classification: "other", draftId: null, engagementId: null };
  }

  // 1. Rule-based pre-filter.
  const classification = preFilter(inbound.fromAddress, inbound.subject ?? "", inbound.body)
    ?? (await classifyWithLlm(inbound.subject ?? "", inbound.body));
  return prisma.$transaction(async (tx) => {
    let engagementId: string | null = null;
    if (classification === "qualified-inquiry" && inbound.fromAddress) {
      const contact = await tx.customerContact.findUnique({ where: { email: inbound.fromAddress }, select: { id: true, accountId: true } });
      if (contact) {
        const engagement = await tx.engagement.upsert({
          where: { engagementId: `ENG-${inbound.inboundId.slice(-8)}` },
          create: { engagementId: `ENG-${inbound.inboundId.slice(-8)}`, title: inbound.subject ?? "Inbound marketing inquiry", contactId: contact.id, accountId: contact.accountId, source: "marketing-inbound", sourceRefId: inbound.inboundId, status: "new" },
          update: {}, select: { id: true },
        });
        engagementId = engagement.id;
      }
    }
    let draftId: string | null = null;
    const replyBody = HOLDING_REPLY_BY_CLASSIFICATION[classification];
    if (replyBody) {
      const existing = await tx.outboundDraft.findFirst({ where: { sourceType: "inbound-channel-message", sourceId: inbound.inboundId }, select: { draftId: true } });
      const draft = existing ?? await tx.outboundDraft.create({
        data: { organizationId: inbound.organizationId, domain: "marketing", sourceType: "inbound-channel-message", sourceId: inbound.inboundId, status: "pending-review", channelId: "email-postmark", assetType: "email", body: replyBody, bodyFormat: "plain", metadata: { to: inbound.fromAddress, subject: replyToSubject(inbound.subject), inReplyTo: inbound.externalMessageId }, createdByAgentId: "marketing-specialist" },
        select: { draftId: true },
      });
      draftId = draft.draftId;
    }
    await tx.inboundChannelMessage.update({ where: { inboundId: inbound.inboundId }, data: { classification, routedEngagementId: engagementId, draftedReplyId: draftId } });
    return { classification, draftId, engagementId };
  });
}

function preFilter(
  fromAddress: string | null,
  subject: string,
  body: string,
): InboundClassification | null {
  if (fromAddress) {
    for (const re of SPAM_FROM_PATTERNS) {
      if (re.test(fromAddress)) return "spam";
    }
  }
  // Trivially-short bodies are usually auto-responders or out-of-office;
  // route to "other" without an LLM call.
  if (body.trim().length < 20 && subject.trim().length < 5) return "other";
  return null;
}

async function classifyWithLlm(subject: string, body: string): Promise<InboundClassification> {
  try {
    const { routeAndCall } = await import("@/lib/routed-inference");
    const result = await routeAndCall(
      [
        {
          role: "user",
          content: `Classify the following inbound email into one of:
- qualified-inquiry (a real person interested in our product / service)
- support (existing customer / contributor needs help)
- spam (cold outbound, list-spam, irrelevant)
- other (newsletter, automated notice, anything else)

Subject: ${subject}

Body:
${body.slice(0, 4000)}

Respond with ONLY the classification token, no preamble.`,
        },
      ],
      "You are a focused email classifier. Return exactly one token from the four-class list.",
      "internal",
      // SysML AI-cockpit model, Slice E1: route inbound-email triage through the
      // "email-triage" task requirement so it pins to the utility tier
      // (cheap/local-preferred, never frontier) + minimize_cost, as a background
      // (non-streaming) task. Previously this passed no taskType and could land on
      // a frontier model.
      { taskType: "email-triage", interactionMode: "background" },
    );
    const raw = (result?.content ?? "").trim().toLowerCase();
    if (raw.includes("qualified")) return "qualified-inquiry";
    if (raw.includes("support")) return "support";
    if (raw.includes("spam")) return "spam";
    return "other";
  } catch {
    // Classifier failure shouldn't break the inbound loop — default to
    // "other" which still drafts a holding reply for human review.
    return "other";
  }
}

function replyToSubject(subject: string | null): string {
  if (!subject) return "Re: your message";
  if (/^re:/i.test(subject)) return subject;
  return `Re: ${subject}`;
}
