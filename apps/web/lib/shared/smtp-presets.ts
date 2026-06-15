// SMTP provider presets + detection — the knowledge that makes outbound-email
// setup near-zero-config (PBI-INV-04 / #1888).
//
// DPF can't be the sender-of-record for every install's email (operating a
// central relay for millions of messages/day is untenable, and `conduit-not-
// broker` says the operator's own identity should send). What we CAN do is make
// wiring up the operator's *own* provider trivial: most operators already have a
// mailbox bundled with their domain/hosting, and a known provider's SMTP differs
// only by host/port/secure. Given the org's domain (which the install already
// knows), we can pre-select the provider, pre-fill the transport, and tell the
// operator the one credential to paste — collapsing a 6-field form to a confirm
// + one app-password. This module is the catalog + the pure detection logic;
// the live MX lookup that drives custom-domain detection lives in smtp-config.ts.
//
// Pure + framework-free (no DB, no node:dns) so it unit-tests trivially and can
// be shared by the settings UI and the setup agent alike.

export type SmtpPreset = {
  /** Stable id, e.g. "google-workspace". */
  id: string;
  /** Human label shown in the UI / spoken by the agent. */
  label: string;
  host: string;
  port: number;
  /** Implicit TLS (port 465). false → STARTTLS (587). */
  secure: boolean;
  /**
   * What the operator must supply and where to get it. Shown verbatim in the
   * panel and used by the setup agent to guide the one manual step.
   */
  credentialHint: string;
  /** Provider doc for the credential step (e.g. how to mint an app password). */
  docsUrl?: string;
  /**
   * True for shared transactional relays (SendGrid, SES, …) where mail is sent
   * from a verified sender on the PROVIDER's authenticated domain, so the
   * operator's intended From should be preserved via Reply-To and the provider
   * needs domain/sender verification for deliverability. Drives extra UI/agent
   * guidance; does not change the resolver.
   */
  sharedRelay?: boolean;
};

// ─── Catalog ──────────────────────────────────────────────────────────────────
// Keep additions principled: a preset earns its place when it removes a real
// host/port guess for a provider operators actually use. Ordered roughly by how
// often a small business hits it.

export const SMTP_PRESETS = {
  "google-workspace": {
    id: "google-workspace",
    label: "Google Workspace / Gmail",
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    credentialHint:
      "Use your full email as the username and a 16-character Google App Password (not your normal password). Requires 2-Step Verification to be on.",
    docsUrl: "https://support.google.com/mail/answer/185833",
  },
  "microsoft-365": {
    id: "microsoft-365",
    label: "Microsoft 365 / Outlook",
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    credentialHint:
      "Use your full email as the username. If your tenant enforces modern auth, create an app password (or have an admin enable SMTP AUTH for the mailbox).",
    docsUrl:
      "https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission",
  },
  outlook: {
    id: "outlook",
    label: "Outlook.com / Hotmail",
    host: "smtp-mail.outlook.com",
    port: 587,
    secure: false,
    credentialHint:
      "Use your full email as the username and an app password created in your Microsoft account security settings.",
    docsUrl: "https://support.microsoft.com/en-us/account-billing/using-app-passwords-with-apps-that-don-t-support-two-step-verification-5896ed9b-4263-e681-128a-a6f2979a7944",
  },
  zoho: {
    id: "zoho",
    label: "Zoho Mail",
    host: "smtp.zoho.com",
    port: 465,
    secure: true,
    credentialHint:
      "Use your full email as the username and a Zoho app-specific password (Account → Security → App Passwords).",
    docsUrl: "https://www.zoho.com/mail/help/zoho-smtp.html",
  },
  godaddy: {
    id: "godaddy",
    label: "GoDaddy email",
    host: "smtpout.secureserver.net",
    port: 465,
    secure: true,
    credentialHint: "Use your full email address and its mailbox password.",
    docsUrl: "https://www.godaddy.com/help/server-and-port-settings-for-workspace-email-6949",
  },
  "namecheap-privateemail": {
    id: "namecheap-privateemail",
    label: "Namecheap Private Email",
    host: "mail.privateemail.com",
    port: 465,
    secure: true,
    credentialHint: "Use your full email address and its mailbox password.",
    docsUrl: "https://www.namecheap.com/support/knowledgebase/article.aspx/1179/2175/",
  },
  fastmail: {
    id: "fastmail",
    label: "Fastmail",
    host: "smtp.fastmail.com",
    port: 465,
    secure: true,
    credentialHint:
      "Create an app password (Settings → Privacy & Security → App Passwords) scoped to SMTP and use your email as the username.",
    docsUrl: "https://www.fastmail.help/hc/en-us/articles/1500000278342",
  },
  icloud: {
    id: "icloud",
    label: "iCloud Mail",
    host: "smtp.mail.me.com",
    port: 587,
    secure: false,
    credentialHint:
      "Use your iCloud email and an app-specific password generated at appleid.apple.com. Custom-domain From addresses must be configured in iCloud first.",
    docsUrl: "https://support.apple.com/en-us/102654",
  },
  yahoo: {
    id: "yahoo",
    label: "Yahoo Mail",
    host: "smtp.mail.yahoo.com",
    port: 465,
    secure: true,
    credentialHint:
      "Use your full email and a Yahoo app password (Account Security → Generate app password).",
    docsUrl: "https://help.yahoo.com/kb/SLN4724.html",
  },
  // ── Transactional / shared relays (operator may already run one) ───────────
  sendgrid: {
    id: "sendgrid",
    label: "Twilio SendGrid",
    host: "smtp.sendgrid.net",
    port: 587,
    secure: false,
    credentialHint:
      'Username is the literal string "apikey"; password is a SendGrid API key with Mail Send permission. Authenticate your sending domain for deliverability.',
    docsUrl: "https://www.twilio.com/docs/sendgrid/for-developers/sending-email/integrating-with-the-smtp-api",
    sharedRelay: true,
  },
  mailgun: {
    id: "mailgun",
    label: "Mailgun",
    host: "smtp.mailgun.org",
    port: 587,
    secure: false,
    credentialHint:
      "Use the SMTP username/password from your Mailgun domain's settings. Verify the domain (SPF/DKIM) before sending.",
    docsUrl: "https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/#smtp",
    sharedRelay: true,
  },
  postmark: {
    id: "postmark",
    label: "Postmark",
    host: "smtp.postmarkapp.com",
    port: 587,
    secure: false,
    credentialHint:
      "Username and password are both your Postmark Server API token. Confirm a verified Sender Signature or domain.",
    docsUrl: "https://postmarkapp.com/support/article/824-can-i-send-emails-using-smtp",
    sharedRelay: true,
  },
  "amazon-ses": {
    id: "amazon-ses",
    label: "Amazon SES",
    host: "email-smtp.us-east-1.amazonaws.com",
    port: 587,
    secure: false,
    credentialHint:
      "Generate SES SMTP credentials (distinct from your AWS keys) and replace the region in the host to match your SES region. Verify your domain/identity and move out of the sandbox to send to arbitrary recipients.",
    docsUrl: "https://docs.aws.amazon.com/ses/latest/dg/send-email-smtp.html",
    sharedRelay: true,
  },
  brevo: {
    id: "brevo",
    label: "Brevo (Sendinblue)",
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    credentialHint:
      "Use your Brevo login email as the username and an SMTP key (SMTP & API → SMTP) as the password.",
    docsUrl: "https://help.brevo.com/hc/en-us/articles/7924908994450",
    sharedRelay: true,
  },
  resend: {
    id: "resend",
    label: "Resend",
    host: "smtp.resend.com",
    port: 465,
    secure: true,
    credentialHint:
      'Username is the literal string "resend"; password is a Resend API key. Verify your sending domain first.',
    docsUrl: "https://resend.com/docs/send-with-smtp",
    sharedRelay: true,
  },
} as const satisfies Record<string, SmtpPreset>;

export type SmtpPresetId = keyof typeof SMTP_PRESETS;

/** Lookup a preset by id. Returns null for unknown ids (caller-friendly). */
export function getSmtpPreset(id: string): SmtpPreset | null {
  return (SMTP_PRESETS as Record<string, SmtpPreset>)[id] ?? null;
}

// ─── Detection ──────────────────────────────────────────────────────────────

// Exact mailbox domains → preset. Custom business domains are detected by MX
// (see MX_SUFFIX_RULES), not here.
const CONSUMER_DOMAIN_TO_PRESET: Record<string, SmtpPresetId> = {
  "gmail.com": "google-workspace",
  "googlemail.com": "google-workspace",
  "outlook.com": "outlook",
  "hotmail.com": "outlook",
  "live.com": "outlook",
  "msn.com": "outlook",
  "zoho.com": "zoho",
  "zohomail.com": "zoho",
  "icloud.com": "icloud",
  "me.com": "icloud",
  "mac.com": "icloud",
  "yahoo.com": "yahoo",
  "ymail.com": "yahoo",
  "fastmail.com": "fastmail",
  "fastmail.fm": "fastmail",
};

// MX-host suffix → preset, for CUSTOM domains (e.g. a business on Google
// Workspace whose domain is acme.com). First match wins; order most-specific
// first. Suffixes are matched case-insensitively against each MX exchange host,
// with any trailing dot stripped.
const MX_SUFFIX_RULES: ReadonlyArray<{ suffix: string; preset: SmtpPresetId }> = [
  { suffix: "aspmx.l.google.com", preset: "google-workspace" },
  { suffix: "googlemail.com", preset: "google-workspace" },
  { suffix: "google.com", preset: "google-workspace" },
  { suffix: "mail.protection.outlook.com", preset: "microsoft-365" },
  { suffix: "protection.outlook.com", preset: "microsoft-365" },
  { suffix: "outlook.com", preset: "microsoft-365" },
  { suffix: "zoho.com", preset: "zoho" },
  { suffix: "zoho.eu", preset: "zoho" },
  { suffix: "secureserver.net", preset: "godaddy" },
  { suffix: "privateemail.com", preset: "namecheap-privateemail" },
  { suffix: "registrar-servers.com", preset: "namecheap-privateemail" },
  { suffix: "messagingengine.com", preset: "fastmail" },
  { suffix: "icloud.com", preset: "icloud" },
  { suffix: "me.com", preset: "icloud" },
  { suffix: "yahoodns.net", preset: "yahoo" },
];

/**
 * Extract a lowercased registrable-ish domain from an email address or a website
 * URL/string. Returns null when nothing usable is present. Intentionally lenient
 * — this seeds detection, it is not validation.
 */
export function domainFromEmailOrUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;

  if (s.includes("@")) {
    // email — take the part after the last @
    const at = s.lastIndexOf("@");
    s = s.slice(at + 1);
  } else {
    // url/host — strip scheme, path, port, userinfo
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
    s = s.split("/")[0] ?? s;
    const at = s.lastIndexOf("@");
    if (at !== -1) s = s.slice(at + 1);
    s = s.split(":")[0] ?? s;
  }

  s = s.replace(/\.$/, "").replace(/^www\./, "");
  // a bare domain needs at least one dot and no whitespace
  if (!s || s.includes(" ") || !s.includes(".")) return null;
  return s;
}

/** Detect a preset from an exact consumer mailbox domain. Null for custom domains. */
export function detectPresetByDomain(domain: string | null | undefined): SmtpPreset | null {
  if (!domain) return null;
  const id = CONSUMER_DOMAIN_TO_PRESET[domain.trim().toLowerCase().replace(/\.$/, "")];
  return id ? SMTP_PRESETS[id] : null;
}

/**
 * Detect a preset from a domain's MX exchange hostnames (lowercased; trailing
 * dots tolerated). This is how a custom business domain is resolved to its real
 * mail provider. Returns null when no rule matches.
 */
export function detectPresetByMxHosts(mxHosts: ReadonlyArray<string>): SmtpPreset | null {
  const hosts = mxHosts.map((h) => h.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean);
  for (const rule of MX_SUFFIX_RULES) {
    if (hosts.some((h) => h === rule.suffix || h.endsWith(`.${rule.suffix}`))) {
      return SMTP_PRESETS[rule.preset];
    }
  }
  return null;
}
