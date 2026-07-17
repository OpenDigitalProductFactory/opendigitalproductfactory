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
import { createSingleFlight } from "@/lib/integrations/kernel/single-flight";

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

const responderFlights = createSingleFlight<ResponderResult>();

export function runInboundResponder(input: {
  inboundId: string;
}): Promise<ResponderResult> {
  return responderFlights.run(input.inboundId, () => runInboundResponderOnce(input));
}

async function runInboundResponderOnce(input: { inboundId: string }): Promise<ResponderResult> {
  const inbound = await prisma.inboundChannelMessage.findUnique({
    where: { inboundId: input.inboundId },
  });
  if (!inbound) {
    return { classification: "other", draftId: null, engagementId: null };
  }

  // Callback delivery is at-least-once. Recover an already-created draft when
  // a worker crashed before linking it back to the inbound row, so replaying
  // the same inboundId never creates a second reply draft.
  const existingDraft = inbound.draftedReplyId
    ? { draftId: inbound.draftedReplyId }
    : await prisma.outboundDraft.findFirst({
        where: { sourceType: "inbound-channel-message", sourceId: inbound.inboundId },
        select: { draftId: true },
      });
  if (existingDraft) {
    if (!inbound.draftedReplyId) {
      await prisma.inboundChannelMessage.update({
        where: { inboundId: inbound.inboundId },
        data: { draftedReplyId: existingDraft.draftId },
      });
    }
    const classification = isInboundClassification(inbound.classification)
      ? inbound.classification
      : "other";
    return { classification, draftId: existingDraft.draftId, engagementId: inbound.routedEngagementId };
  }

  // 1. Rule-based pre-filter.
  const classification = preFilter(inbound.fromAddress, inbound.subject ?? "", inbound.body)
    ?? (await classifyWithLlm(inbound.subject ?? "", inbound.body));

  await prisma.inboundChannelMessage.update({
    where: { inboundId: inbound.inboundId },
    data: { classification },
  });

  if (classification === "spam") {
    return { classification, draftId: null, engagementId: null };
  }

  // 2. Engagement linkage for qualified inquiries.
  let engagementId: string | null = null;
  if (classification === "qualified-inquiry") {
    engagementId = await linkOrCreateEngagement({
      organizationId: inbound.organizationId,
      fromAddress: inbound.fromAddress,
      fromDisplayName: inbound.fromDisplayName,
      subject: inbound.subject,
      inboundId: inbound.inboundId,
    });
    if (engagementId) {
      await prisma.inboundChannelMessage.update({
        where: { inboundId: inbound.inboundId },
        data: { routedEngagementId: engagementId },
      });
    }
  }

  // 3. Draft reply.
  const replyBody = HOLDING_REPLY_BY_CLASSIFICATION[classification];
  if (!replyBody) {
    return { classification, draftId: null, engagementId };
  }

  const draft = await prisma.outboundDraft.create({
    data: {
      organizationId: inbound.organizationId,
      domain: "marketing",
      sourceType: "inbound-channel-message",
      sourceId: inbound.inboundId,
      status: "pending-review",
      channelId: "email-postmark",
      assetType: "email",
      body: replyBody,
      bodyFormat: "plain",
      metadata: {
        to: inbound.fromAddress,
        subject: replyToSubject(inbound.subject),
        inReplyTo: inbound.externalMessageId,
      },
      createdByAgentId: "marketing-specialist",
    },
    select: { draftId: true },
  });

  await prisma.inboundChannelMessage.update({
    where: { inboundId: inbound.inboundId },
    data: { draftedReplyId: draft.draftId },
  });

  return { classification, draftId: draft.draftId, engagementId };
}

function isInboundClassification(value: string | null): value is InboundClassification {
  return value === "qualified-inquiry" || value === "support" || value === "spam" || value === "other";
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
    const { routeAndCall } = await import("../../../routed-inference");
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

async function linkOrCreateEngagement(input: {
  organizationId: string;
  fromAddress: string | null;
  fromDisplayName: string | null;
  subject: string | null;
  inboundId: string;
}): Promise<string | null> {
  // Engagement is contact-anchored: CustomerContact.id is REQUIRED. If we
  // don't have a matching contact for the inbound sender, we skip the CRM
  // linkage rather than fabricate a synthetic contact — the inbound message
  // row alone is enough signal for human review.
  if (!input.fromAddress) return null;
  const contact = await prisma.customerContact.findUnique({
    where: { email: input.fromAddress },
    select: { id: true, accountId: true },
  });
  if (!contact) return null;

  try {
    const engagement = await prisma.engagement.create({
      data: {
        engagementId: `ENG-${input.inboundId.slice(-8)}`,
        title: input.subject ?? "Inbound marketing inquiry",
        contactId: contact.id,
        accountId: contact.accountId,
        source: "marketing-inbound",
        sourceRefId: input.inboundId,
        status: "new",
      },
      select: { id: true },
    });
    return engagement.id;
  } catch {
    // Best-effort — the inbound message is still useful without CRM linkage.
    return null;
  }
}

function replyToSubject(subject: string | null): string {
  if (!subject) return "Re: your message";
  if (/^re:/i.test(subject)) return subject;
  return `Re: ${subject}`;
}
