import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
    credentialEntry: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import { getStoredGitHubToken } from "./platform-dev-config";
import { encryptSecret } from "@/lib/govern/credential-crypto";

const TEST_KEY_HEX = "0".repeat(64);

const mockFind = vi.mocked(prisma.credentialEntry.findUnique);
const mockUpdateMany = vi.mocked(prisma.credentialEntry.updateMany);

describe("getStoredGitHubToken — opportunistic re-encryption", () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
    mockUpdateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = originalKey;
  });

  it("re-encrypts a plaintext git-backup secretRef when CREDENTIAL_ENCRYPTION_KEY is set", async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY_HEX;
    mockFind.mockResolvedValueOnce({
      secretRef: "ghp_plaintext",
      status: "active",
    } as Awaited<ReturnType<typeof prisma.credentialEntry.findUnique>>);

    const token = await getStoredGitHubToken();

    expect(token).toBe("ghp_plaintext");
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    const call = mockUpdateMany.mock.calls[0]![0];
    expect(call.where).toMatchObject({
      providerId: "git-backup",
      NOT: { secretRef: { startsWith: "enc:" } },
    });
    expect(call.data.secretRef).toMatch(/^enc:/);
  });

  it("does not re-encrypt an already-encrypted secretRef", async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY_HEX;
    const encrypted = encryptSecret("ghp_already_encrypted");
    mockFind.mockResolvedValueOnce({
      secretRef: encrypted,
      status: "active",
    } as Awaited<ReturnType<typeof prisma.credentialEntry.findUnique>>);

    const token = await getStoredGitHubToken();

    expect(token).toBe("ghp_already_encrypted");
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("leaves the DB untouched in dev-mode (no encryption key)", async () => {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    mockFind.mockResolvedValueOnce({
      secretRef: "ghp_plaintext",
      status: "active",
    } as Awaited<ReturnType<typeof prisma.credentialEntry.findUnique>>);

    const token = await getStoredGitHubToken();

    expect(token).toBe("ghp_plaintext");
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("returns null when decrypt fails (encryption key rotated)", async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY_HEX;
    // Malformed enc: value → decryptSecret returns null.
    mockFind.mockResolvedValueOnce({
      secretRef: "enc:nope:nope:nope",
      status: "active",
    } as Awaited<ReturnType<typeof prisma.credentialEntry.findUnique>>);

    const token = await getStoredGitHubToken();

    expect(token).toBeNull();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});
