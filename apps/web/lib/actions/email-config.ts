"use server";

import { z } from "zod";
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { encryptSecret } from "@/lib/govern/credential-crypto";
import { sendEmail, isEmailConfigured } from "@/lib/email";
import { suggestSmtpForDomain } from "@/lib/shared/smtp-config";

// Admin → Settings → Email. Same guard the adjacent platform-key / social-auth
// panels use (manage_provider_connections) — SMTP is an outbound-email provider
// connection at the install level.
async function requireManageEmailConfig(): Promise<void> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "manage_provider_connections",
    )
  ) {
    throw new Error("Unauthorized");
  }
}

const emailConfigSchema = z.object({
  host: z.string().trim().min(1, "SMTP host is required").max(255),
  port: z.number().int().min(1).max(65535).default(587),
  user: z.string().trim().max(255).optional().default(""),
  from: z.string().trim().max(320).optional().default(""),
  secure: z.boolean().optional().default(false),
  // Only set/replace the password when a non-empty value is provided; a blank
  // value means "keep the existing password" so editing other fields is safe.
  pass: z.string().max(1024).optional(),
});

// z.input (not z.infer): defaulted fields (port/user/from/secure) stay optional
// for callers; emailConfigSchema.parse() fills the defaults inside the action.
export type EmailConfigInput = z.input<typeof emailConfigSchema>;

export async function saveEmailConfig(input: EmailConfigInput): Promise<{ ok: true }> {
  await requireManageEmailConfig();
  const parsed = emailConfigSchema.parse(input);

  const writes: Array<{ key: string; value: string }> = [
    { key: "smtp_host", value: parsed.host },
    { key: "smtp_port", value: String(parsed.port) },
    { key: "smtp_user", value: parsed.user ?? "" },
    { key: "smtp_from", value: parsed.from ?? "" },
    { key: "smtp_secure", value: parsed.secure ? "true" : "false" },
  ];
  // Password is stored encrypted at rest (credential-crypto), never plaintext.
  if (parsed.pass && parsed.pass.length > 0) {
    writes.push({ key: "smtp_pass_enc", value: encryptSecret(parsed.pass) });
  }

  for (const { key, value } of writes) {
    await prisma.platformConfig.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  revalidatePath("/admin/settings");
  return { ok: true };
}

/**
 * Suggest SMTP settings for the operator's OWN email provider, detected from the
 * org's domain (email, falling back to website). Lets the Email panel / setup
 * agent pre-fill host/port/secure and surface the one credential the operator
 * must paste — the near-zero-config path (PBI-INV-04). Detection is best-effort
 * and read-only; it never writes config.
 */
export type EmailProviderSuggestion = {
  found: boolean;
  /** Domain detection ran against (normalized), or null. */
  domain: string | null;
  /** How the provider was identified. */
  via: "domain" | "mx" | "none";
  preset: {
    id: string;
    label: string;
    host: string;
    port: number;
    secure: boolean;
    credentialHint: string;
    docsUrl?: string;
    sharedRelay?: boolean;
  } | null;
};

export async function suggestEmailProvider(): Promise<EmailProviderSuggestion> {
  await requireManageEmailConfig();
  // Single org per install — the first row is the operator's organization.
  const org = await prisma.organization.findFirst({ select: { email: true, website: true } });
  const seed = org?.email || org?.website || null;
  const s = await suggestSmtpForDomain(seed);
  return {
    found: Boolean(s.preset),
    domain: s.domain,
    via: s.via,
    preset: s.preset ? { ...s.preset } : null,
  };
}

const testEmailSchema = z.object({ to: z.string().trim().email() });

export async function sendTestEmail(to: string): Promise<{ ok: true }> {
  await requireManageEmailConfig();
  const { to: recipient } = testEmailSchema.parse({ to });

  if (!(await isEmailConfigured())) {
    throw new Error("Save your SMTP settings before sending a test email.");
  }

  await sendEmail({
    to: recipient,
    subject: "DPF test email",
    text: "This is a test email from DPF. If you received it, outbound email is configured correctly.",
    html: "<p>This is a test email from DPF.</p><p>If you received it, your outbound email (SMTP) is configured correctly.</p>",
  });

  return { ok: true };
}
