"use server";

import { prisma } from "@dpf/db";
import * as crypto from "crypto";

export async function generateInviteCode(
  accountId: string,
  createdBy: string
): Promise<{ success: boolean; code?: string; error?: string }> {
  const account = await prisma.customerAccount.findUnique({
    where: { id: accountId },
    select: { id: true, name: true },
  });
  if (!account) return { success: false, error: "Account not found" };

  const prefix = account.name.replace(/[^a-zA-Z]/g, "").slice(0, 4).toUpperCase().padEnd(4, "X");

  // Retry on collision (unique constraint on code)
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = crypto.randomUUID().slice(0, 4).toUpperCase();
    const code = `${prefix}-${suffix}`;
    try {
      const invite = await prisma.accountInvite.create({
        data: { code, accountId: account.id, createdBy },
      });
      return { success: true, code: invite.code };
    } catch (e: unknown) {
      if (e && typeof e === "object" && "code" in e && e.code === "P2002") continue;
      throw e;
    }
  }
  return { success: false, error: "Failed to generate unique invite code" };
}

export async function validateInviteCode(
  code: string
): Promise<{
  valid: boolean;
  error?: string;
  account?: { id: string; accountId: string; name: string };
  inviteId?: string;
}> {
  const invite = await prisma.accountInvite.findUnique({
    where: { code: code.trim().toUpperCase() },
    include: { account: { select: { id: true, accountId: true, name: true, status: true } } },
  });
  if (!invite) return { valid: false, error: "Invalid invite code" };
  if (invite.usedAt) return { valid: false, error: "This invite has already been used" };
  if (invite.expiresAt && invite.expiresAt < new Date()) return { valid: false, error: "This invite has expired" };
  if (invite.account.status === "inactive") return { valid: false, error: "This account is no longer active" };
  return { valid: true, account: { id: invite.account.id, accountId: invite.account.accountId, name: invite.account.name }, inviteId: invite.id };
}

export async function consumeInviteCode(inviteId: string, usedBy: string): Promise<void> {
  await prisma.accountInvite.update({
    where: { id: inviteId },
    data: { usedAt: new Date(), usedBy },
  });
}
