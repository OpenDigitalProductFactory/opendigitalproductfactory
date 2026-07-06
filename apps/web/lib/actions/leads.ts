"use server";

import crypto from "crypto";
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { checkCustomerAccountDuplicates } from "@/lib/mdm/dedup-gate";
import { standardizeName } from "@/lib/mdm/standardize";

// Manual lead capture — the missing top of the funnel. An Engagement (status
// lifecycle new→contacted→qualified/unqualified→converted) IS this platform's
// lead record; qualifyEngagement IS lead-convert (it creates the opportunity
// and links contact+account). What was missing is a door that takes the way
// leads actually arrive — "Dan Warfield at Managing Digital, dan@..." — and
// lands the whole trio: contact (email identity), account, engagement.

export async function createLead(input: {
  firstName: string;
  lastName?: string;
  email: string;
  company: string;
  phone?: string;
  note?: string;
}) {
  const email = input.email.trim().toLowerCase();
  const firstName = input.firstName.trim();
  const company = input.company.trim();
  if (!firstName || !email || !company) {
    throw new Error("First name, email, and company are required");
  }
  const lastName = input.lastName?.trim() || undefined;
  const personName = [firstName, lastName].filter(Boolean).join(" ");

  // Account: reuse an exact-name match, then a likely-duplicate (same company
  // spelled slightly differently — the dedup gate's high-confidence verdict),
  // else create a fresh prospect. Lead capture must never mint dup accounts.
  let account = await prisma.customerAccount.findFirst({
    where: { name: { equals: company, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!account) {
    const check = await checkCustomerAccountDuplicates({ name: company });
    const top = check.candidates[0];
    if (check.verdict === "likely-duplicate" && top) {
      const existing = await prisma.customerAccount.findUnique({
        where: { id: top.id },
        select: { id: true, name: true },
      });
      account = existing ?? null;
    }
  }
  if (!account) {
    account = await prisma.customerAccount.create({
      data: {
        accountId: `ACCT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        name: company,
        nameNormalized: standardizeName(company),
        status: "prospect",
        notes: input.note?.trim() || null,
      },
      select: { id: true, name: true },
    });
  }

  // Contact: email is the identity key — reuse or create under the account.
  let contact = await prisma.customerContact.findUnique({ where: { email } });
  if (!contact) {
    contact = await prisma.customerContact.create({
      data: {
        accountId: account.id,
        email,
        firstName,
        lastName: lastName ?? null,
        name: personName,
        nameNormalized: standardizeName(personName),
        phone: input.phone?.trim() || null,
        source: "manual",
      },
    });
  }

  const engagement = await prisma.engagement.create({
    data: {
      engagementId: `ENG-${crypto.randomUUID()}`,
      title: `${personName} — ${account.name}`,
      status: "new",
      source: "manual",
      accountId: account.id,
      contactId: contact.id,
      notes: input.note?.trim() || null,
    },
  });

  revalidatePath("/customer/engagements");
  revalidatePath("/customer");
  return { engagementId: engagement.id, accountId: account.id, contactId: contact.id };
}

/** Triage transitions for the lead lifecycle (qualify has its own convert action). */
export async function updateEngagementStatus(
  engagementId: string,
  status: "contacted" | "unqualified",
) {
  const engagement = await prisma.engagement.update({
    where: { id: engagementId },
    data: { status },
    select: { id: true, accountId: true },
  });
  revalidatePath("/customer/engagements");
  return engagement;
}
