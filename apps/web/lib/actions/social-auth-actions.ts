"use server";

import { prisma } from "@dpf/db";
import { customerAccountNormalizedColumns, customerContactNormalizedColumns } from "@/lib/mdm/dedup-gate";
import { registerCustomerAccountSource } from "@/lib/mdm/crosswalk";
import * as crypto from "crypto";
import { verifyPassword, hashPassword } from "@/lib/password";
import { verifyTempToken, type SocialProfile } from "@/lib/social-auth";
import { authorizeIdentityForSession } from "@/lib/identity/authentication";
import { syncCustomerPrincipal } from "@/lib/identity/principal-linking";

type LinkResult = {
  success: boolean;
  error?: string;
  contactId?: string;
  accountId?: string;
  accountName?: string;
};

export async function linkSocialIdentity(
  tempToken: string,
  password: string
): Promise<LinkResult> {
  let profile: SocialProfile;
  try {
    profile = await verifyTempToken(tempToken);
  } catch {
    return { success: false, error: "Session expired. Please try signing in again." };
  }

  const contact = await prisma.customerContact.findUnique({
    where: { email: profile.email.toLowerCase() },
    include: { account: { select: { id: true, accountId: true, name: true, status: true } } },
  });

  if (!contact || !contact.isActive) return { success: false, error: "Account not found or inactive." };
  if (!contact.passwordHash) return { success: false, error: "This account has no password set." };

  const { valid, needsRehash } = await verifyPassword(password, contact.passwordHash);
  if (!valid) return { success: false, error: "Incorrect password. Please try again." };

  const nextHash = needsRehash ? await hashPassword(password) : null;
  const linked = await prisma.$transaction(async (tx) => {
    // Re-read under the same transaction that writes the provider identity, so
    // account/contact deactivation cannot race the credential proof.
    const current = await tx.customerContact.findUnique({
      where: { id: contact.id },
      include: { account: { select: { id: true, accountId: true, name: true, status: true } } },
    });
    if (!current || current.passwordHash !== contact.passwordHash) return null;
    const authority = await authorizeIdentityForSession(
      { population: "customer", credentialId: current.id },
      tx as never,
    );
    if (!authority.authorized) return null;

    if (nextHash || (!current.name && profile.name)) {
      await tx.customerContact.update({
        where: { id: current.id },
        data: {
          ...(nextHash ? { passwordHash: nextHash } : {}),
          ...(!current.name && profile.name ? { name: profile.name } : {}),
        },
      });
    }
    await tx.socialIdentity.create({
      data: {
        provider: profile.provider,
        providerAccountId: profile.providerAccountId,
        email: profile.email,
        contactId: current.id,
      },
    });
    return {
      contactId: current.id,
      accountId: current.account.accountId,
      accountName: current.account.name,
    };
  });
  if (!linked) return { success: false, error: "Account not found or inactive." };
  return { success: true, ...linked };
}

type OnboardInput =
  | { mode: "create"; companyName: string }
  | { mode: "join"; inviteCode: string };

export async function completeProfileWithSocial(
  tempToken: string,
  input: OnboardInput
): Promise<LinkResult> {
  let profile: SocialProfile;
  try {
    profile = await verifyTempToken(tempToken);
  } catch {
    return { success: false, error: "Session expired. Please try signing in again." };
  }

  const existing = await prisma.customerContact.findUnique({ where: { email: profile.email.toLowerCase() } });
  if (existing) return { success: false, error: "An account with this email already exists." };

  if (input.mode === "create") {
    if (!input.companyName?.trim()) return { success: false, error: "Company name is required." };

    const result = await prisma.$transaction(async (tx) => {
      const businessId = `CUST-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const account = await tx.customerAccount.create({
        data: { accountId: businessId, name: input.companyName.trim(), ...customerAccountNormalizedColumns({ name: input.companyName }), status: "active" },
      });
      const contact = await tx.customerContact.create({
        data: { email: profile.email.toLowerCase(), name: profile.name, ...customerContactNormalizedColumns({ name: profile.name }), accountId: account.id },
      });
      await syncCustomerPrincipal(contact.id, tx as never);
      await tx.socialIdentity.create({
        data: { provider: profile.provider, providerAccountId: profile.providerAccountId, email: profile.email, contactId: contact.id },
      });
      return { contactId: contact.id, accountId: account.accountId, accountName: account.name, accountRowId: account.id };
    });
    await registerCustomerAccountSource({
      accountId: result.accountRowId,
      sourceSystem: "social-auth",
      sourceEntityId: `${profile.provider}:${profile.providerAccountId}`,
    });
    const { accountRowId: _ignored, ...publicResult } = result;
    return { success: true, ...publicResult };
  }

  // mode === "join"
  if (!input.inviteCode?.trim()) return { success: false, error: "Invite code is required." };

  const { validateInviteCode } = await import("./invite-actions");
  const validation = await validateInviteCode(input.inviteCode);
  if (!validation.valid || !validation.account || !validation.inviteId) {
    return { success: false, error: validation.error ?? "Invalid invite code." };
  }

  const result = await prisma.$transaction(async (tx) => {
    const contact = await tx.customerContact.create({
      data: { email: profile.email.toLowerCase(), name: profile.name, ...customerContactNormalizedColumns({ name: profile.name }), accountId: validation.account!.id },
    });
    await syncCustomerPrincipal(contact.id, tx as never);
    await tx.socialIdentity.create({
      data: { provider: profile.provider, providerAccountId: profile.providerAccountId, email: profile.email, contactId: contact.id },
    });
    await tx.accountInvite.update({ where: { id: validation.inviteId }, data: { usedAt: new Date(), usedBy: contact.id } });
    return { contactId: contact.id, accountId: validation.account!.accountId, accountName: validation.account!.name };
  });
  return { success: true, ...result };
}
