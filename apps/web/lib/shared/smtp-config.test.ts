import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: { platformConfig: { findMany: vi.fn() } },
}));

import { prisma } from "@dpf/db";
import { resolveSmtpConfig, isSmtpConfigured, getSmtpConfigStatus } from "./smtp-config";

const mockFindMany = (
  prisma as unknown as { platformConfig: { findMany: ReturnType<typeof vi.fn> } }
).platformConfig.findMany;

const ENV_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "SMTP_SECURE"];
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  vi.clearAllMocks();
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  mockFindMany.mockResolvedValue([]);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("resolveSmtpConfig", () => {
  it("returns no host when neither DB nor env is configured", async () => {
    const cfg = await resolveSmtpConfig();
    expect(cfg.host).toBeNull();
    expect(cfg.source).toBe("none");
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
});
