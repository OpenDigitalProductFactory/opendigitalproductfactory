import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    platformDevConfig: {
      findUnique: vi.fn(),
    },
    credentialEntry: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import { resolveHiveToken } from "./identity-privacy";
import { encryptSecret } from "@/lib/govern/credential-crypto";

const TEST_KEY_HEX = "0".repeat(64);

const mockHiveFind = vi.mocked(prisma.credentialEntry.findUnique);
const mockUpdateMany = vi.mocked(prisma.credentialEntry.updateMany);

describe("resolveHiveToken — opportunistic re-encryption", () => {
  let originalKey: string | undefined;
  let originalEnvToken: string | undefined;
  let originalGithubToken: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
    originalEnvToken = process.env.HIVE_CONTRIBUTION_TOKEN;
    originalGithubToken = process.env.GITHUB_TOKEN;
    // Ensure env-var priorities don't short-circuit the DB read.
    delete process.env.HIVE_CONTRIBUTION_TOKEN;
    delete process.env.GITHUB_TOKEN;
    // Default: updateMany resolves to a count-shape response.
    mockUpdateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = originalKey;
    if (originalEnvToken === undefined) delete process.env.HIVE_CONTRIBUTION_TOKEN;
    else process.env.HIVE_CONTRIBUTION_TOKEN = originalEnvToken;
    if (originalGithubToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalGithubToken;
  });

  it("re-encrypts a plaintext hive-contribution secretRef when CREDENTIAL_ENCRYPTION_KEY is set", async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY_HEX;
    mockHiveFind.mockResolvedValueOnce({
      secretRef: "ghp_plaintext",
      status: "active",
    } as Awaited<ReturnType<typeof prisma.credentialEntry.findUnique>>);

    const token = await resolveHiveToken();

    expect(token).toBe("ghp_plaintext");
    // updateMany was called with a guard clause that prevents re-encrypting
    // an already-encrypted row. Any concurrent second write becomes a no-op.
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    const call = mockUpdateMany.mock.calls[0]![0];
    expect(call.where).toMatchObject({
      providerId: "hive-contribution",
      NOT: { secretRef: { startsWith: "enc:" } },
    });
    expect(call.data.secretRef).toMatch(/^enc:/);
  });

  it("does not re-encrypt an already-encrypted hive-contribution secretRef", async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY_HEX;
    const encrypted = encryptSecret("ghp_already_encrypted");
    mockHiveFind.mockResolvedValueOnce({
      secretRef: encrypted,
      status: "active",
    } as Awaited<ReturnType<typeof prisma.credentialEntry.findUnique>>);

    const token = await resolveHiveToken();

    expect(token).toBe("ghp_already_encrypted");
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("leaves the DB untouched when no encryption key is set (dev-mode no-op)", async () => {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    mockHiveFind.mockResolvedValueOnce({
      secretRef: "ghp_plaintext",
      status: "active",
    } as Awaited<ReturnType<typeof prisma.credentialEntry.findUnique>>);

    const token = await resolveHiveToken();

    expect(token).toBe("ghp_plaintext");
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("is concurrent-call safe: two simultaneous reads both return the decrypted value", async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY_HEX;
    // Both calls see the pre-encryption plaintext row (simulates a race where
    // two reads land before either write finishes).
    mockHiveFind.mockResolvedValue({
      secretRef: "ghp_plaintext",
      status: "active",
    } as Awaited<ReturnType<typeof prisma.credentialEntry.findUnique>>);
    // Second updateMany returns count=0 because the guard clause (secretRef
    // NOT starts-with "enc:") no longer matches after the first write.
    mockUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const [a, b] = await Promise.all([resolveHiveToken(), resolveHiveToken()]);

    expect(a).toBe("ghp_plaintext");
    expect(b).toBe("ghp_plaintext");
    expect(mockUpdateMany).toHaveBeenCalledTimes(2);
    // Both calls carry the guard clause — this is what makes the second
    // write a no-op at the DB level rather than a double-encrypt.
    for (const call of mockUpdateMany.mock.calls) {
      expect(call[0].where).toMatchObject({
        providerId: "hive-contribution",
        NOT: { secretRef: { startsWith: "enc:" } },
      });
    }
  });

  it("re-encrypts a plaintext git-backup secretRef when hive-contribution is absent", async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY_HEX;
    // Priority 2 (hive-contribution) miss, priority 4 (git-backup) hit.
    mockHiveFind
      .mockResolvedValueOnce(null) // hive-contribution slot empty
      .mockResolvedValueOnce({
        secretRef: "ghp_backup_plaintext",
        status: "active",
      } as Awaited<ReturnType<typeof prisma.credentialEntry.findUnique>>);

    const token = await resolveHiveToken();

    expect(token).toBe("ghp_backup_plaintext");
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    const call = mockUpdateMany.mock.calls[0]![0];
    expect(call.where).toMatchObject({
      providerId: "git-backup",
      NOT: { secretRef: { startsWith: "enc:" } },
    });
    expect(call.data.secretRef).toMatch(/^enc:/);
  });
});
