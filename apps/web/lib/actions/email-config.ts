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
import { interpretSmtpError, type SmtpErrorInfo } from "@/lib/shared/smtp-error";

// Result of a test-send. We RETURN failures as data instead of throwing so the
// actionable SMTP detail survives to the client: in a production build Next.js
// redacts thrown server-action error messages ("…omitted in production builds"),
// which is exactly what turned a 535 SMTP-AUTH-disabled failure into an
// unreadable Server Components error (BI-6AA848A7). Authorization/validation
// still throw — those are programmer/permission errors, not operator-fixable
// SMTP outcomes.
export type SendTestEmailResult = { ok: true } | ({ ok: false } & SmtpErrorInfo);

// NOTE: every export of a "use server" module must be an async function — the
// server-action compiler collects ALL exports into ensureServerEntryExports([...])
// as runtime values, so a re-exported *type* (erased at runtime) becomes a
// `ReferenceError: X is not defined` that poisons the whole co-bundled actions
// chunk. Callers import EmailConfigInput/EmailProviderSuggestion directly from
// the server-only core (lib/shared/email-config-core) instead. The core holds
// the auth-free logic; this module is the "use server" surface that adds the
// operator-capability guard so the client-callable actions can't bypass authz.

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

export async function sendTestEmail(to: string): Promise<SendTestEmailResult> {
  await requireManageEmailConfig();
  const { to: recipient } = testEmailSchema.parse({ to });

  if (!(await isEmailConfigured())) {
    return {
      ok: false,
      message: "Save your SMTP settings before sending a test email.",
    };
  }

  try {
    await sendEmail({
      to: recipient,
      subject: "DPF test email",
      text: "This is a test email from DPF. If you received it, outbound email is configured correctly.",
      html: "<p>This is a test email from DPF.</p><p>If you received it, your outbound email (SMTP) is configured correctly.</p>",
    });
  } catch (err) {
    // Never let a failed test crash the Server Component render — surface the
    // real SMTP failure to the operator inline instead (BI-6AA848A7).
    return { ok: false, ...interpretSmtpError(err) };
  }

  return { ok: true };
}
