import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@dpf/db", () => ({
  prisma: {
    credentialEntry: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import LegacyTokenOverrideBanner from "./LegacyTokenOverrideBanner";

const mockFind = vi.mocked(prisma.credentialEntry.findUnique);

describe("LegacyTokenOverrideBanner", () => {
  let originalEnvToken: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnvToken = process.env.HIVE_CONTRIBUTION_TOKEN;
  });

  afterEach(() => {
    if (originalEnvToken === undefined) delete process.env.HIVE_CONTRIBUTION_TOKEN;
    else process.env.HIVE_CONTRIBUTION_TOKEN = originalEnvToken;
  });

  it("renders nothing when HIVE_CONTRIBUTION_TOKEN is unset", async () => {
    delete process.env.HIVE_CONTRIBUTION_TOKEN;
    const element = await LegacyTokenOverrideBanner();
    expect(element).toBeNull();
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("renders nothing when env var is set but no DB credential exists", async () => {
    process.env.HIVE_CONTRIBUTION_TOKEN = "ghp_env";
    mockFind.mockResolvedValueOnce(null);
    const element = await LegacyTokenOverrideBanner();
    expect(element).toBeNull();
  });

  it("renders nothing when DB credential is inactive", async () => {
    process.env.HIVE_CONTRIBUTION_TOKEN = "ghp_env";
    mockFind.mockResolvedValueOnce({
      secretRef: "enc:abc:def:ghi",
      status: "revoked",
    } as Awaited<ReturnType<typeof prisma.credentialEntry.findUnique>>);
    const element = await LegacyTokenOverrideBanner();
    expect(element).toBeNull();
  });

  it("renders the override banner when env var shadows an active DB credential", async () => {
    process.env.HIVE_CONTRIBUTION_TOKEN = "ghp_env";
    mockFind.mockResolvedValueOnce({
      secretRef: "enc:abc:def:ghi",
      status: "active",
    } as Awaited<ReturnType<typeof prisma.credentialEntry.findUnique>>);

    const element = await LegacyTokenOverrideBanner();
    expect(element).not.toBeNull();
    const html = renderToStaticMarkup(element as React.ReactElement);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Legacy env-var token is overriding your configured credential");
    expect(html).toContain("HIVE_CONTRIBUTION_TOKEN");
    expect(html).toContain("Unset the env var");
  });
});
