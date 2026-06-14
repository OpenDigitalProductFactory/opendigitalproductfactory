import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: { platformConfig: { findMany: vi.fn() } },
}));

// MX lookups for suggestSmtpForDomain — mocked so tests are hermetic (no DNS).
const mockResolveMx = vi.fn();
vi.mock("node:dns/promises", () => ({ resolveMx: mockResolveMx }));

import { prisma } from "@dpf/db";
import {
  resolveSmtpConfig,
  isSmtpConfigured,
  getSmtpConfigStatus,
  suggestSmtpForDomain,
} from "./smtp-config";

const mockFindMany = (
  prisma as unknown as { platformConfig: { findMany: ReturnType<typeof vi.fn> } }
).platformConfig.findMany;

const ENV_KEYS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "SMTP_SECURE",
  "DPF_EMAIL_RELAY_HOST",
  "DPF_EMAIL_RELAY_PORT",
  "DPF_EMAIL_RELAY_USER",
  "DPF_EMAIL_RELAY_PASS",
  "DPF_EMAIL_RELAY_FROM",
  "DPF_EMAIL_RELAY_SECURE",
  "DPF_EMAIL_RELAY_REWRITE_FROM",
];
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  vi.clearAllMocks();
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  mockFindMany.mockResolvedValue([]);
  mockResolveMx.mockReset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("resolveSmtpConfig", () => {
  it("returns no host when neither DB, env, nor relay is configured", async () => {
    const cfg = await resolveSmtpConfig();
    expect(cfg.host).toBeNull();
    expect(cfg.source).toBe("none");
    expect(cfg.rewriteFrom).toBe(false);
    expect(await isSmtpConfigured()).toBe(false);
  });

  it("falls back to env vars when the DB has no config", async () => {
    process.env.SMTP_HOST = "smtp.env.example";
    process.env.SMTP_PORT = "2525";
    process.env.SMTP_USER = "envuser";
    process.env.SMTP_PASS = "envpass";
    process.env.SMTP_FROM = "env@example.com";

    const cfg = await resolveSmtpConfig();
    expect(cfg).toMatchObject({
      host: "smtp.env.example",
      port: 2525,
      user: "envuser",
      pass: "envpass",
      from: "env@example.com",
      source: "env",
      rewriteFrom: false,
    });
    expect(await isSmtpConfigured()).toBe(true);
  });

  it("prefers DB config over env vars", async () => {
    process.env.SMTP_HOST = "smtp.env.example";
    mockFindMany.mockResolvedValue([
      { key: "smtp_host", value: "smtp.db.example" },
      { key: "smtp_port", value: "465" },
      { key: "smtp_user", value: "dbuser" },
      { key: "smtp_from", value: "db@example.com" },
      { key: "smtp_secure", value: "true" },
      { key: "smtp_pass_enc", value: "dbsecret" }, // stored plaintext → decrypt passes through
    ]);

    const cfg = await resolveSmtpConfig();
    expect(cfg).toMatchObject({
      host: "smtp.db.example",
      port: 465,
      user: "dbuser",
      pass: "dbsecret",
      from: "db@example.com",
      secure: true,
      source: "db",
    });
  });

  it("derives secure=true from port 465 when not explicitly set", async () => {
    mockFindMany.mockResolvedValue([
      { key: "smtp_host", value: "h" },
      { key: "smtp_port", value: "465" },
    ]);
    expect((await resolveSmtpConfig()).secure).toBe(true);
  });

  describe("tier 3 — bundled relay (DPF_EMAIL_RELAY_*)", () => {
    it("resolves the relay when neither DB nor env SMTP is set", async () => {
      process.env.DPF_EMAIL_RELAY_HOST = "relay.internal";
      process.env.DPF_EMAIL_RELAY_USER = "relayuser";
      process.env.DPF_EMAIL_RELAY_PASS = "relaypass";
      process.env.DPF_EMAIL_RELAY_FROM = "noreply@relay.internal";

      const cfg = await resolveSmtpConfig();
      expect(cfg).toMatchObject({
        host: "relay.internal",
        port: 587,
        user: "relayuser",
        pass: "relaypass",
        from: "noreply@relay.internal",
        source: "relay",
        rewriteFrom: true, // shared relay rewrites From by default
      });
      expect(await isSmtpConfigured()).toBe(true);
    });

    it("does NOT override operator SMTP (DB) or env SMTP", async () => {
      process.env.DPF_EMAIL_RELAY_HOST = "relay.internal";
      process.env.SMTP_HOST = "smtp.env.example";
      expect((await resolveSmtpConfig()).source).toBe("env");

      mockFindMany.mockResolvedValue([{ key: "smtp_host", value: "smtp.db.example" }]);
      expect((await resolveSmtpConfig()).source).toBe("db");
    });

    it("honors DPF_EMAIL_RELAY_REWRITE_FROM=false (relay authorized for arbitrary senders)", async () => {
      process.env.DPF_EMAIL_RELAY_HOST = "mta.corp";
      process.env.DPF_EMAIL_RELAY_REWRITE_FROM = "false";
      const cfg = await resolveSmtpConfig();
      expect(cfg.source).toBe("relay");
      expect(cfg.rewriteFrom).toBe(false);
    });

    it("derives relay secure=true from port 465", async () => {
      process.env.DPF_EMAIL_RELAY_HOST = "mta.corp";
      process.env.DPF_EMAIL_RELAY_PORT = "465";
      expect((await resolveSmtpConfig()).secure).toBe(true);
    });
  });
});

describe("getSmtpConfigStatus", () => {
  it("reports configured + passConfigured without exposing the password", async () => {
    mockFindMany.mockResolvedValue([
      { key: "smtp_host", value: "smtp.db.example" },
      { key: "smtp_pass_enc", value: "stored-secret" },
    ]);
    const s = await getSmtpConfigStatus();
    expect(s.configured).toBe(true);
    expect(s.passConfigured).toBe(true);
    expect(s).not.toHaveProperty("pass");
    expect(Object.values(s)).not.toContain("stored-secret");
  });

  it("reports not-configured on a cold install", async () => {
    const s = await getSmtpConfigStatus();
    expect(s.configured).toBe(false);
    expect(s.passConfigured).toBe(false);
    expect(s.source).toBe("none");
  });

  it("reports source 'relay' and passConfigured when only the relay is set", async () => {
    process.env.DPF_EMAIL_RELAY_HOST = "relay.internal";
    process.env.DPF_EMAIL_RELAY_PASS = "relaypass";
    const s = await getSmtpConfigStatus();
    expect(s.configured).toBe(true);
    expect(s.source).toBe("relay");
    expect(s.passConfigured).toBe(true);
  });
});

describe("suggestSmtpForDomain", () => {
  it("detects a consumer mailbox by exact domain without a DNS lookup", async () => {
    const s = await suggestSmtpForDomain("owner@gmail.com");
    expect(s).toMatchObject({ domain: "gmail.com", via: "domain" });
    expect(s.preset?.id).toBe("google-workspace");
    expect(mockResolveMx).not.toHaveBeenCalled();
  });

  it("detects a custom business domain via MX lookup", async () => {
    mockResolveMx.mockResolvedValue([
      { exchange: "alt1.aspmx.l.google.com", priority: 5 },
      { exchange: "aspmx.l.google.com", priority: 1 },
    ]);
    const s = await suggestSmtpForDomain("https://www.acme.com");
    expect(s).toMatchObject({ domain: "acme.com", via: "mx" });
    expect(s.preset?.id).toBe("google-workspace");
    expect(mockResolveMx).toHaveBeenCalledWith("acme.com");
  });

  it("returns via:'none' when the domain has no recognized provider", async () => {
    mockResolveMx.mockResolvedValue([{ exchange: "mail.unknown-host.net", priority: 10 }]);
    const s = await suggestSmtpForDomain("hello@acme.com");
    expect(s).toMatchObject({ domain: "acme.com", via: "none", preset: null });
  });

  it("returns via:'none' and skips DNS for unusable input", async () => {
    const s = await suggestSmtpForDomain("");
    expect(s).toMatchObject({ domain: null, via: "none", preset: null });
    expect(mockResolveMx).not.toHaveBeenCalled();
  });

  it("tolerates DNS failures (NXDOMAIN/timeout) by returning no suggestion", async () => {
    mockResolveMx.mockRejectedValue(new Error("ENOTFOUND"));
    const s = await suggestSmtpForDomain("acme.com");
    expect(s).toMatchObject({ domain: "acme.com", via: "none", preset: null });
  });
});
