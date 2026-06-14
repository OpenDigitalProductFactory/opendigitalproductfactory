// Server-only core for outbound-email (SMTP) configuration: schema + the
// auth-free DB write + provider detection.
//
// Deliberately NOT in the "use server" action module (lib/actions/email-config.ts):
// every export of a "use server" file is a client-callable endpoint, so an
// auth-free writeSmtpConfig there would be an unauthenticated SMTP-write hole.
// Here it is a plain server module that can be called server-to-server (the
// agent setup tool) where the CALLER is responsible for authorization:
//   - the action wrapper (email-config.ts) checks manage_provider_connections;
//   - the agent `setup_email` tool is gated by requiredCapability + grants.
//
// Server-only (reads/writes the DB, encrypts secrets). Do not import from a
// client component.

import { z } from "zod";
import { prisma } from "@dpf/db";
import { encryptSecret } from "@/lib/govern/credential-crypto";
import { suggestSmtpForDomain } from "./smtp-config";

export const emailConfigSchema = z.object({
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
// for callers; emailConfigSchema.parse() fills the defaults inside writeSmtpConfig.
export type EmailConfigInput = z.input<typeof emailConfigSchema>;

/**
 * Persist SMTP config to PlatformConfig, encrypting the password at rest.
 * NO authorization and NO revalidatePath (not request-scoped) — the caller MUST
 * authorize first. Validates input; throws ZodError on a missing/oversized field.
 */
export async function writeSmtpConfig(input: EmailConfigInput): Promise<void> {
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
}

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

/**
 * Detect the operator's OWN email provider from the org's domain (email,
 * falling back to website) so a setup form/agent can pre-fill host/port/secure
 * and surface the one credential to paste. Read-only; no authorization.
 */
export async function detectOrgEmailProvider(): Promise<EmailProviderSuggestion> {
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
