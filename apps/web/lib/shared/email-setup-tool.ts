// Handler for the `setup_email` coworker tool (PBI-INV-04 Phase 2). Lets the
// onboarding/COO coworker walk a non-technical operator through configuring
// their OWN outbound email (SMTP) conversationally:
//
//   detect → identify the provider from the org domain + the one credential to get
//   save   → persist the SMTP settings the operator provides
//   test   → send a test email to confirm delivery
//
// Authorization is handled upstream: the tool carries
// `requiredCapability: "manage_provider_connections"` (operator-only) and an
// `email_config` agent grant, so this handler — like other write-tool handlers
// (e.g. publishApprovedDraft) — runs only after the tool layer has gated it. It
// calls the auth-free cores (email-config-core) rather than the "use server"
// actions, which would try to read a request session that an agent call lacks.
//
// Server-only. Returns a structured result; never throws to the dispatcher.

import { writeSmtpConfig, detectOrgEmailProvider } from "./email-config-core";
import { isEmailConfigured, sendEmail } from "./email";

export type EmailSetupAction = "detect" | "save" | "test";

export type EmailSetupToolArgs = {
  action: EmailSetupAction;
  // save
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  from?: string;
  pass?: string;
  // test
  to?: string;
};

export type EmailSetupToolResult = {
  ok: boolean;
  message: string;
  error?: string;
  data?: unknown;
};

export async function runEmailSetupTool(args: EmailSetupToolArgs): Promise<EmailSetupToolResult> {
  const action = args.action;
  try {
    switch (action) {
      case "detect": {
        const s = await detectOrgEmailProvider();
        if (!s.found || !s.preset) {
          return {
            ok: true,
            message: s.domain
              ? `No known email provider matched the domain "${s.domain}". Ask the operator which email provider they use (e.g. Google Workspace, Microsoft 365) or for their SMTP host and port, then call setup_email with action="save".`
              : `No organization domain is on file to detect from. Ask the operator which email provider they use or for their SMTP host and port, then call setup_email with action="save".`,
            data: s,
          };
        }
        const p = s.preset;
        const docs = p.docsUrl ? ` Setup docs: ${p.docsUrl}.` : "";
        const shared = p.sharedRelay
          ? " This is a transactional email service — the operator must also verify their sending domain (SPF/DKIM) in its dashboard for good deliverability."
          : "";
        return {
          ok: true,
          message:
            `Detected ${p.label}${s.domain ? ` for ${s.domain}` : ""}. ` +
            `Server settings are known (host ${p.host}, port ${p.port}). ` +
            `Tell the operator, in plain language, what credential to get: ${p.credentialHint}${docs}${shared} ` +
            `When they give it to you, call setup_email with action="save" (host="${p.host}", port=${p.port}, secure=${p.secure}, their username, the password/app-key, and a From address), then action="test".`,
          data: s,
        };
      }

      case "save": {
        const host = (args.host ?? "").trim();
        if (!host) {
          return {
            ok: false,
            message:
              'A SMTP host is required to save email settings. Run action="detect" first, or ask the operator for their provider\'s SMTP host.',
            error: "missing_host",
          };
        }
        await writeSmtpConfig({
          host,
          port: typeof args.port === "number" ? args.port : 587,
          secure: typeof args.secure === "boolean" ? args.secure : undefined,
          user: args.user,
          from: args.from,
          // Omit pass entirely when blank so we never clobber an existing one.
          ...(args.pass && args.pass.length > 0 ? { pass: args.pass } : {}),
        });
        return {
          ok: true,
          message: `Saved outbound email settings for ${host}. Now call setup_email with action="test" and the operator's own address to confirm delivery.`,
          data: { host, port: typeof args.port === "number" ? args.port : 587 },
        };
      }

      case "test": {
        const to = (args.to ?? "").trim();
        if (!to) {
          return {
            ok: false,
            message: "A recipient address (to) is required to send the test email.",
            error: "missing_recipient",
          };
        }
        if (!(await isEmailConfigured())) {
          return {
            ok: false,
            message:
              'Email is not configured yet — call setup_email with action="save" and the SMTP settings before sending a test.',
            error: "not_configured",
          };
        }
        const result = await sendEmail({
          to,
          subject: "DPF test email",
          text: "This is a test email from DPF. If you received it, outbound email is configured correctly.",
          html: "<p>This is a test email from DPF.</p><p>If you received it, your outbound email (SMTP) is configured correctly.</p>",
        });
        return {
          ok: true,
          message: `Test email sent to ${to}. Ask the operator to confirm it arrived (check spam too).`,
          data: { messageId: result.messageId },
        };
      }

      default: {
        return {
          ok: false,
          message: `Unknown setup_email action "${String(action)}". Use "detect", "save", or "test".`,
          error: "unknown_action",
        };
      }
    }
  } catch (e) {
    // Surface a clean, actionable failure to the coworker instead of throwing.
    const msg = e instanceof Error ? e.message : "Email setup failed.";
    return { ok: false, message: `Email setup (${action}) failed: ${msg}`, error: "email_setup_failed" };
  }
}
