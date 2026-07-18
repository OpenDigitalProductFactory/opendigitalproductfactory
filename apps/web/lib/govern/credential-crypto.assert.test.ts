import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  assertCredentialEncryptionKeyIsSet,
  assertEncryptionReadyForCredentialWrite,
} from "./credential-crypto";

vi.mock("@dpf/db", () => ({
  prisma: {
    credentialEntry: { count: vi.fn() },
    integrationCredential: { count: vi.fn() },
  },
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
    vi.mocked(prisma.integrationCredential.count).mockResolvedValue(0);
    await expect(assertCredentialEncryptionKeyIsSet()).rejects.toThrow(/FATAL: CREDENTIAL_ENCRYPTION_KEY/);
  });

  it("passes in production when key is set, without querying the DB", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "a".repeat(64));
    const { prisma } = await import("@dpf/db");
    await expect(assertCredentialEncryptionKeyIsSet()).resolves.toBeUndefined();
    expect(prisma.credentialEntry.count).not.toHaveBeenCalled();
    expect(prisma.integrationCredential.count).not.toHaveBeenCalled();
  });

  it("passes in production when key missing AND no credentials exist", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "");
    const { prisma } = await import("@dpf/db");
    vi.mocked(prisma.credentialEntry.count).mockResolvedValue(0);
    vi.mocked(prisma.integrationCredential.count).mockResolvedValue(0);
    await expect(assertCredentialEncryptionKeyIsSet()).resolves.toBeUndefined();
  });

  it("passes in development regardless", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "");
    await expect(assertCredentialEncryptionKeyIsSet()).resolves.toBeUndefined();
  });

  it("throws when integration credentials exist even if credential entries do not", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "");
    const { prisma } = await import("@dpf/db");
    vi.mocked(prisma.credentialEntry.count).mockResolvedValue(0);
    vi.mocked(prisma.integrationCredential.count).mockResolvedValue(1);
    await expect(assertCredentialEncryptionKeyIsSet()).rejects.toThrow(/FATAL: CREDENTIAL_ENCRYPTION_KEY/);
  });

  it("refuses a production credential write with an absent or malformed key even on an empty install", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "not-a-valid-key");
    await expect(assertEncryptionReadyForCredentialWrite()).rejects.toThrow(/CREDENTIAL_ENCRYPTION_KEY/);
  });

  it("preserves development plaintext fallback for credential writes", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "");
    await expect(assertEncryptionReadyForCredentialWrite()).resolves.toBeUndefined();
  });
});
