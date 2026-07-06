"use server";

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import {
  checkCustomerContactDuplicates,
  type DedupCheckResult,
  type DedupResolution,
} from "@/lib/mdm/dedup-gate";
import { standardizeName } from "@/lib/mdm/standardize";
import crypto from "crypto";

// Structured contact capture (BI-D873CD28). CustomerContact existed as a model
// but was unreachable from the CRM surface — no create action, no coworker
// tool, no UI button — so real contacts (Ian Pruden, Dan Warfield) ended up as
// free-text in account notes. This is the missing create door, gated by the
// MDM write-time dedup check like createCustomerAccount (EP-4A12A7CB).

export type CreateCustomerContactResult =
  | { outcome: "created"; contact: Awaited<ReturnType<typeof prisma.customerContact.create>> }
  | { outcome: "existing"; contact: Awaited<ReturnType<typeof prisma.customerContact.create>> }
  | { outcome: "duplicates-found"; check: DedupCheckResult };

export async function createCustomerContact(
  input: {
    accountId: string;
    firstName: string;
    lastName?: string;
    email: string;
    phone?: string;
    jobTitle?: string;
    notes?: string;
  },
  dedup?: DedupResolution,
): Promise<CreateCustomerContactResult> {
  const account = await prisma.customerAccount.findUnique({
    where: { id: input.accountId },
    select: { id: true, name: true },
  });
  if (!account) throw new Error("Account not found");

  const email = input.email.trim().toLowerCase();
  if (!email) throw new Error("Email is required for a contact");
  const firstName = input.firstName.trim();
  if (!firstName) throw new Error("First name is required");
  const lastName = input.lastName?.trim() || undefined;

  // Email is the identity key — an exact match is always "use existing".
  const existing = await prisma.customerContact.findUnique({ where: { email } });
  if (existing) {
    return { outcome: "existing", contact: existing };
  }

  if (dedup?.kind === "use-existing") {
    const chosen = await prisma.customerContact.findUnique({ where: { id: dedup.existingId } });
    if (!chosen) throw new Error("Selected existing contact not found");
    return { outcome: "existing", contact: chosen };
  }

  if (dedup?.kind !== "confirm-new") {
    const check = await checkCustomerContactDuplicates({
      firstName,
      lastName: lastName ?? null,
      email,
      phone: input.phone ?? null,
      accountId: input.accountId,
    });
    if (check.verdict !== "clear") {
      return { outcome: "duplicates-found", check };
    }
  }

  const displayName = [firstName, lastName].filter(Boolean).join(" ");
  const contact = await prisma.customerContact.create({
    data: {
      accountId: input.accountId,
      email,
      firstName,
      lastName: lastName ?? null,
      name: displayName,
      nameNormalized: standardizeName(displayName),
      phone: input.phone?.trim() || null,
      jobTitle: input.jobTitle?.trim() || null,
      source: "manual",
    },
  });

  // Auto-capture: contact creation lands on the account timeline like every
  // other CRM mutation, whether a human or a coworker performed it.
  await prisma.activity
    .create({
      data: {
        activityId: `ACT-${crypto.randomUUID()}`,
        type: "note",
        subject: `Contact added: ${displayName} (${email})`,
        accountId: input.accountId,
        contactId: contact.id,
        completedAt: new Date(),
      },
    })
    .catch(() => {});

  revalidatePath(`/customer/${input.accountId}`);
  revalidatePath("/customer");
  return { outcome: "created", contact };
}
