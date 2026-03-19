"use server";

import { prisma } from "@dpf/db";
import * as crypto from "crypto";
import { verifyPassword, hashPassword } from "@/lib/password";
import { verifyTempToken, type SocialProfile } from "@/lib/social-auth";

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

  if (needsRehash) {
    const newHash = await hashPassword(password);
    await prisma.customerContact.update({ where: { id: contact.id }, data: { passwordHash: newHash } });
  }

  await prisma.socialIdentity.create({
    data: {
      provider: profile.provider,
      providerAccountId: profile.providerAccountId,
      email: profile.email,
      contactId: contact.id,
    },
  });

  if (!contact.name && profile.name) {
    await prisma.customerContact.update({ where: { id: contact.id }, data: { name: profile.name } });
  }

  return { success: true, contactId: contact.id, accountId: contact.account.accountId, accountName: contact.account.name };
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
        data: { accountId: businessId, name: input.companyName.trim(), status: "active" },
      });
      const contact = await tx.customerContact.create({
        data: { email: profile.email.toLowerCase(), name: profile.name, accountId: account.id },
      });
      await tx.socialIdentity.create({
        data: { provider: profile.provider, providerAccountId: profile.providerAccountId, email: profile.email, contactId: contact.id },
      });
      return { contactId: contact.id, accountId: account.accountId, accountName: account.name };
    });
    return { success: true, ...result };
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
      data: { email: profile.email.toLowerCase(), name: profile.name, accountId: validation.account!.id },
    });
    await tx.socialIdentity.create({
      data: { provider: profile.provider, providerAccountId: profile.providerAccountId, email: profile.email, contactId: contact.id },
    });
    await tx.accountInvite.update({ where: { id: validation.inviteId }, data: { usedAt: new Date(), usedBy: contact.id } });
    return { contactId: contact.id, accountId: validation.account!.accountId, accountName: validation.account!.name };
  });
  return { success: true, ...result };
}
