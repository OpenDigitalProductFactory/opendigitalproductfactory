// apps/web/lib/actions/customer-auth.ts
"use server";

import { prisma } from "@dpf/db";
import * as crypto from "crypto";

async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function customerSignup(input: {
  email: string;
  password: string;
  companyName: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!input.email?.trim()) return { success: false, error: "Email is required" };
  if (!input.password || input.password.length < 8) return { success: false, error: "Password must be at least 8 characters" };
  if (!input.companyName?.trim()) return { success: false, error: "Company name is required" };

  // Check for existing contact
  const existing = await prisma.customerContact.findUnique({ where: { email: input.email.trim().toLowerCase() } });
  if (existing) return { success: false, error: "An account with this email already exists" };

  const passwordHash = await hashPassword(input.password);
  const accountId = `CUST-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  await prisma.customerAccount.create({
    data: {
      accountId,
      name: input.companyName.trim(),
      status: "active",
      contacts: {
        create: {
          email: input.email.trim().toLowerCase(),
          passwordHash,
        },
      },
    },
  });

  return { success: true };
}

export async function customerResetPassword(input: {
  email: string;
}): Promise<{ success: boolean; error?: string }> {
  // Always return success to prevent email enumeration
  const contact = await prisma.customerContact.findUnique({
    where: { email: input.email.trim().toLowerCase() },
  });

  if (contact) {
    // TODO: Send reset email via notification system (EP-NOTIFY-001)
    console.log(`[customer-auth] Password reset requested for ${contact.email}`);
  }

  return { success: true };
}
