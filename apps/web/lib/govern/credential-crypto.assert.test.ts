import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { assertCredentialEncryptionKeyIsSet } from "./credential-crypto";

vi.mock("@dpf/db", () => ({
  prisma: { credentialEntry: { count: vi.fn() } },
}));

describe("assertCredentialEncryptionKeyIsSet", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws in production when key missing AND credentials exist", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "");
    const { prisma } = await import("@dpf/db");
    vi.mocked(prisma.credentialEntry.count).mockResolvedValue(3);
    await expect(assertCredentialEncryptionKeyIsSet()).rejects.toThrow(/FATAL: CREDENTIAL_ENCRYPTION_KEY/);
  });

  it("passes in production when key is set, without querying the DB", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "a".repeat(64));
    const { prisma } = await import("@dpf/db");
    await expect(assertCredentialEncryptionKeyIsSet()).resolves.toBeUndefined();
    expect(prisma.credentialEntry.count).not.toHaveBeenCalled();
  });

  it("passes in production when key missing AND no credentials exist", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "");
    const { prisma } = await import("@dpf/db");
    vi.mocked(prisma.credentialEntry.count).mockResolvedValue(0);
    await expect(assertCredentialEncryptionKeyIsSet()).resolves.toBeUndefined();
  });

  it("passes in development regardless", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "");
    await expect(assertCredentialEncryptionKeyIsSet()).resolves.toBeUndefined();
  });
});
