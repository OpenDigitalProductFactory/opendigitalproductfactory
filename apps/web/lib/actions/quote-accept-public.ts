"use server";

import crypto from "crypto";
import { prisma } from "@dpf/db";
import { acceptQuoteImpl } from "@/lib/actions/crm-quote-acceptance";
import { logSystemActivity } from "@/lib/crm/crm-activity";

// PUBLIC quote acceptance, authorized by accept-token possession (the exact
// pattern of the invoice payment portal: sendQuote mints Quote.acceptToken and
// the customer opens /s/quote/[token]). Accepting drives the existing
// acceptQuote flow — order + invoice + closed-won — with the acceptor's
// name/email recorded on the timeline.
//
// Deliberately calls `acceptQuoteImpl`, not the `acceptQuote` server action:
// that action carries the internal `operate_customer` capability guard, which a
// signed-out customer clicking their own accept link will never hold. Token
// possession IS the authority here, and it is checked below (token lookup +
// status + expiry) before the commit runs.

export async function getQuoteByAcceptToken(token: string) {
  if (!token || token.length < 16) return null;
  return prisma.quote.findUnique({
    where: { acceptToken: token },
    include: {
      lineItems: { orderBy: { sortOrder: "asc" } },
      account: { select: { name: true } },
      opportunity: { select: { title: true } },
      salesOrder: { select: { orderRef: true } },
    },
  });
}

export async function acceptQuoteByToken(input: {
  token: string;
  acceptedByName: string;
  acceptedByEmail: string;
}) {
  const name = input.acceptedByName.trim();
  const email = input.acceptedByEmail.trim().toLowerCase();
  if (!name || !email.includes("@")) {
    throw new Error("Your name and a valid email are required to accept");
  }

  const quote = await prisma.quote.findUnique({
    where: { acceptToken: input.token },
    select: { id: true, status: true, validUntil: true, quoteNumber: true, accountId: true, opportunityId: true },
  });
  if (!quote) throw new Error("This quote link is not valid");
  if (quote.status === "accepted") return { ok: true as const, alreadyAccepted: true };
  if (quote.status !== "sent") throw new Error("This quote is no longer open for acceptance");
  if (quote.validUntil && quote.validUntil.getTime() < Date.now()) {
    throw new Error("This quote has expired — please ask for a refreshed quote");
  }

  await acceptQuoteImpl(quote.id, undefined, logSystemActivity);

  await prisma.activity
    .create({
      data: {
        activityId: `ACT-${crypto.randomUUID()}`,
        type: "quote_event",
        subject: `Quote ${quote.quoteNumber} accepted by ${name} (${email}) via accept link`,
        accountId: quote.accountId,
        opportunityId: quote.opportunityId,
        completedAt: new Date(),
      },
    })
    .catch(() => {});

  return { ok: true as const, alreadyAccepted: false };
}
