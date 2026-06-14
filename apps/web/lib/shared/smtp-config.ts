// Resolve the install's outbound SMTP config from the in-portal settings
// (PlatformConfig) with a fall-back to environment variables, so existing
// env-configured installs keep working while operators can self-serve via
// Admin → Settings → Email. The password is stored encrypted (credential-crypto);
// everything else is plain PlatformConfig key/value.
//
// Server-only (reads the DB + decrypts). Do not import from a client component.

import { prisma } from "@dpf/db";
import { decryptSecret } from "@/lib/govern/credential-crypto";

export const SMTP_CONFIG_KEYS = [
  "smtp_host",
  "smtp_port",
  "smtp_user",
  "smtp_from",
  "smtp_secure",
  "smtp_pass_enc",
] as const;

export type ResolvedSmtp = {
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
  from: string | null;
  /** Where the host came from — drives the settings UI's "source" hint. */
  source: "db" | "env" | "none";
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
  source: ResolvedSmtp["source"];
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

/** Full resolved config including the (decrypted) password. Server-only. */
export async function resolveSmtpConfig(): Promise<ResolvedSmtp> {
  const db = await readDbConfig();

  const host = db.smtp_host ?? process.env.SMTP_HOST ?? null;
  const source: ResolvedSmtp["source"] = db.smtp_host
    ? "db"
    : process.env.SMTP_HOST
      ? "env"
      : "none";

  const portStr = db.smtp_port ?? process.env.SMTP_PORT ?? "587";
  const port = Number.parseInt(portStr, 10) || 587;

  const user = db.smtp_user ?? process.env.SMTP_USER ?? null;
  const from = db.smtp_from ?? process.env.SMTP_FROM ?? null;

  const secureRaw = db.smtp_secure ?? process.env.SMTP_SECURE ?? null;
  const secure = secureRaw != null ? secureRaw === "true" : port === 465;

  const pass = db.smtp_pass_enc
    ? decryptSecret(db.smtp_pass_enc)
    : (process.env.SMTP_PASS ?? null);

  return { host, port, secure, user, pass, from, source };
}

/** Whether outbound email can be sent (a host is resolvable from DB or env). */
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
    passConfigured: Boolean(db.smtp_pass_enc || process.env.SMTP_PASS),
    source: cfg.source,
  };
}
