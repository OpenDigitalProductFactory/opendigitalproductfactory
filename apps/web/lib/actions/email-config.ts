"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/actions/shared/guards";
import { sendEmail, isEmailConfigured } from "@/lib/email";
import {
  writeSmtpConfig,
  detectOrgEmailProvider,
  type EmailConfigInput,
  type EmailProviderSuggestion,
} from "@/lib/shared/email-config-core";

// Re-export the input/result types for the settings panel + callers. The
// auth-free logic lives in the server-only core (lib/shared/email-config-core);
// this module is the "use server" surface that adds the operator-capability
// guard so the client-callable actions can't bypass authorization.
export type { EmailConfigInput, EmailProviderSuggestion };

// Admin → Settings → Email. Same guard the adjacent platform-key / social-auth
// panels use (manage_provider_connections) — SMTP is an outbound-email provider
// connection at the install level.
async function requireManageEmailConfig(): Promise<void> {
  await requireCapability("manage_provider_connections");
}

export async function saveEmailConfig(input: EmailConfigInput): Promise<{ ok: true }> {
  await requireManageEmailConfig();
  await writeSmtpConfig(input);
  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function suggestEmailProvider(): Promise<EmailProviderSuggestion> {
  await requireManageEmailConfig();
  return detectOrgEmailProvider();
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
