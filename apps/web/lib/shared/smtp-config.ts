// Resolve the install's outbound SMTP config across three tiers, in order:
//   1. operator SMTP saved in-portal (PlatformConfig DB) — Admin → Settings → Email
//   2. env vars (SMTP_*) — for installs configured at the infra layer
//   3. bundled relay (DPF_EMAIL_RELAY_*) — a platform/operator-supplied relay
//      (e.g. an enterprise's internal MTA, or a relay the operator points all
//      their installs at). Default-empty: DPF does NOT operate a central relay
//      for every install (sender-of-record at that scale is untenable and
//      `conduit-not-broker` keeps the operator's own identity as the sender).
//      The tier exists so the seam is there when a relay IS available, and so
//      the resolution order the epic specifies (#1888) is real.
//
// The password is stored encrypted (credential-crypto) for the DB tier;
// everything else is plain PlatformConfig key/value or env.
//
// Server-only (reads the DB + decrypts + does MX lookups). Do not import from a
// client component.

import { prisma } from "@dpf/db";
import { decryptSecret } from "@/lib/govern/credential-crypto";
import {
  detectPresetByDomain,
  detectPresetByMxHosts,
  domainFromEmailOrUrl,
  type SmtpPreset,
} from "./smtp-presets";

export const SMTP_CONFIG_KEYS = [
  "smtp_host",
  "smtp_port",
  "smtp_user",
  "smtp_from",
  "smtp_secure",
  "smtp_pass_enc",
] as const;

export type SmtpSource = "db" | "env" | "relay" | "none";

export type ResolvedSmtp = {
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
  from: string | null;
  /** Where the host came from — drives the settings UI's "source" hint. */
  source: SmtpSource;
  /**
   * True when sending through a shared relay whose authorized envelope/From is
   * the relay's own address (the `from` field above). Callers should send with
   * From = the relay address and put the message's intended sender in Reply-To,
   * so a shared relay's SPF/DKIM stays aligned. Only ever true for `source:"relay"`.
   */
  rewriteFrom: boolean;
};

export type SmtpConfigStatus = {
  configured: boolean;
  host: string | null;
  port: number;
  user: string | null;
  from: string | null;
  secure: boolean;
  /** True when a password is stored (we never return the value itself). */
  passConfigured: boolean;
  source: SmtpSource;
};

async function readDbConfig(): Promise<Record<string, string>> {
  const rows = await prisma.platformConfig.findMany({
    where: { key: { in: [...SMTP_CONFIG_KEYS] } },
    select: { key: true, value: true },
  });
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.value == null) continue;
    const v = typeof r.value === "string" ? r.value : String(r.value);
    if (v.length > 0) out[r.key] = v;
  }
  return out;
}

/** Tier 3 — the platform/operator-supplied relay, from DPF_EMAIL_RELAY_* env. */
function resolveRelayConfig(): ResolvedSmtp | null {
  const host = process.env.DPF_EMAIL_RELAY_HOST;
  if (!host) return null;

  const port = Number.parseInt(process.env.DPF_EMAIL_RELAY_PORT ?? "587", 10) || 587;
  const secureRaw = process.env.DPF_EMAIL_RELAY_SECURE;
  const secure = secureRaw != null ? secureRaw === "true" : port === 465;

  // A shared relay rewrites From by default (its authenticated address must be
  // the From for SPF/DKIM alignment); an operator can opt out when the relay is
  // authorized to send as arbitrary org addresses (e.g. their own internal MTA).
  const rewriteFrom = process.env.DPF_EMAIL_RELAY_REWRITE_FROM !== "false";

  return {
    host,
    port,
    secure,
    user: process.env.DPF_EMAIL_RELAY_USER ?? null,
    pass: process.env.DPF_EMAIL_RELAY_PASS ?? null,
    from: process.env.DPF_EMAIL_RELAY_FROM ?? null,
    source: "relay",
    rewriteFrom,
  };
}

/** Full resolved config including the (decrypted) password. Server-only. */
export async function resolveSmtpConfig(): Promise<ResolvedSmtp> {
  const db = await readDbConfig();

  // Tiers 1 + 2 (DB → env) — unchanged precedence/semantics.
  const host = db.smtp_host ?? process.env.SMTP_HOST ?? null;
  if (host) {
    const source: SmtpSource = db.smtp_host ? "db" : "env";

    const portStr = db.smtp_port ?? process.env.SMTP_PORT ?? "587";
    const port = Number.parseInt(portStr, 10) || 587;

    const user = db.smtp_user ?? process.env.SMTP_USER ?? null;
    const from = db.smtp_from ?? process.env.SMTP_FROM ?? null;

    const secureRaw = db.smtp_secure ?? process.env.SMTP_SECURE ?? null;
    const secure = secureRaw != null ? secureRaw === "true" : port === 465;

    const pass = db.smtp_pass_enc
      ? decryptSecret(db.smtp_pass_enc)
      : (process.env.SMTP_PASS ?? null);

    return { host, port, secure, user, pass, from, source, rewriteFrom: false };
  }

  // Tier 3 (bundled relay) — only when the operator hasn't configured their own.
  const relay = resolveRelayConfig();
  if (relay) return relay;

  return {
    host: null,
    port: 587,
    secure: false,
    user: null,
    pass: null,
    from: null,
    source: "none",
    rewriteFrom: false,
  };
}

/** Whether outbound email can be sent (a host resolves from DB, env, or relay). */
export async function isSmtpConfigured(): Promise<boolean> {
  return Boolean((await resolveSmtpConfig()).host);
}

/** Status for the settings UI — never includes the password value. */
export async function getSmtpConfigStatus(): Promise<SmtpConfigStatus> {
  const db = await readDbConfig();
  const cfg = await resolveSmtpConfig();
  return {
    configured: Boolean(cfg.host),
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    from: cfg.from,
    secure: cfg.secure,
    passConfigured: Boolean(
      db.smtp_pass_enc || process.env.SMTP_PASS || process.env.DPF_EMAIL_RELAY_PASS,
    ),
    source: cfg.source,
  };
}

// ─── Provider auto-detection (AI-assisted setup) ────────────────────────────

export type SmtpSuggestion = {
  /** The domain detection ran against (normalized), or null when none was usable. */
  domain: string | null;
  /** How the provider was identified. */
  via: "domain" | "mx" | "none";
  /** The matched provider preset, or null when undetected. */
  preset: SmtpPreset | null;
};

/**
 * Best-effort lookup of a domain's MX exchange hostnames. Server-only.
 * Swallows all DNS errors (NXDOMAIN, no MX, timeout) → empty list, because a
 * miss just means "fall back to no suggestion", never an operation failure.
 */
export async function lookupMxHosts(domain: string): Promise<string[]> {
  try {
    const { resolveMx } = await import("node:dns/promises");
    const records = await resolveMx(domain);
    return records
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .map((r) => r.exchange);
  } catch {
    return [];
  }
}

/**
 * Given the operator's domain (or email/website), suggest the SMTP transport for
 * their existing provider so the setup form/agent can pre-fill host/port/secure
 * and tell them the one credential to paste. Tries an exact consumer-domain match
 * first, then a live MX lookup for custom business domains. Server-only.
 */
export async function suggestSmtpForDomain(input: string | null | undefined): Promise<SmtpSuggestion> {
  const domain = domainFromEmailOrUrl(input);
  if (!domain) return { domain: null, via: "none", preset: null };

  const byDomain = detectPresetByDomain(domain);
  if (byDomain) return { domain, via: "domain", preset: byDomain };

  const mxHosts = await lookupMxHosts(domain);
  const byMx = detectPresetByMxHosts(mxHosts);
  if (byMx) return { domain, via: "mx", preset: byMx };

  return { domain, via: "none", preset: null };
}
