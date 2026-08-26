import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    // BI-3181909E: a service account is now minted only against an accountable
    // owner, so the provisioning path resolves the delegating human's principal
    // first. `delegatingUserId: "user-1"` is expected to resolve.
    principalAlias: {
      findFirst: vi.fn().mockResolvedValue({ principal: { id: "prn-row-user-1" } }),
    },
    principal: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({ principalId: "browser-svc:substack:default" }),
    },
    integrationCredential: {
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    browserSessionBinding: {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
    },
  },
}));

import { provisionServiceAccount } from "./provisioning";
import { checkSessionFreshness, deriveReauthState } from "./reauth";
import { listBrowserSessions } from "./ledger";
import { prisma } from "@dpf/db";

beforeEach(() => vi.clearAllMocks());

describe("provisionServiceAccount (§9.2)", () => {
  const base = {
    siteKey: "substack",
    accountKey: "default",
    targetDomains: ["substack.com"],
    delegatingUserId: "user-1",
    profileRef: "/profiles/browser-svc:substack:default/substack/",
    credential: { mode: "storageState" as const, storageState: { cookies: [] } },
    sessionId: "boot-1",
  };

  it("resolves the service principal, stores the credential, and records the binding", async () => {
    const result = await provisionServiceAccount(base);
    expect(result.principalId).toBe("browser-svc:substack:default");
    expect(result.credentialId).toBe("browser-session:browser-svc:substack:default:substack");
    expect(prisma.principal.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.integrationCredential.upsert).toHaveBeenCalledTimes(1);
    const bindingArg = vi.mocked(prisma.browserSessionBinding.create).mock.calls[0][0].data as Record<string, unknown>;
    expect(bindingArg.profileKind).toBe("service-account");
    expect(bindingArg.actingPrincipalId).toBe("browser-svc:substack:default");
    expect(bindingArg.attended).toBe(false);
  });

  it("refuses to provision a service account without a target-domain allowlist", async () => {
    await expect(provisionServiceAccount({ ...base, targetDomains: [] })).rejects.toThrow(/allowlist/);
    expect(prisma.principal.upsert).not.toHaveBeenCalled();
  });

  it("binds the delegating human as the service account's accountable owner", async () => {
    await provisionServiceAccount(base);
    expect(prisma.principalAlias.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ aliasType: "user", aliasValue: "user-1" }),
      }),
    );
    const createArg = vi.mocked(prisma.principal.upsert).mock.calls[0][0].create as Record<string, unknown>;
    expect(createArg.sponsorPrincipalId).toBe("prn-row-user-1");
  });

  it("refuses to provision when the delegating human resolves to no principal (BI-3181909E)", async () => {
    vi.mocked(prisma.principalAlias.findFirst).mockResolvedValueOnce(null);
    await expect(provisionServiceAccount(base)).rejects.toThrow(/accountable owner/i);
    expect(prisma.principal.upsert).not.toHaveBeenCalled();
  });
});

describe("checkSessionFreshness (§9.3)", () => {
  it("returns fresh when the authenticated endpoint is reachable", async () => {
    const res = await checkSessionFreshness({
      credentialId: "c1",
      probeUrl: "https://substack.com/account",
      probe: async () => ({ authenticated: true }),
    });
    expect(res.state).toBe("fresh");
    expect(prisma.integrationCredential.update).not.toHaveBeenCalled();
  });

  it("marks the credential stale and blocks the session on redirect-to-auth", async () => {
    const res = await checkSessionFreshness({
      credentialId: "c1",
      probeUrl: "https://substack.com/account",
      probe: async () => ({ authenticated: false, redirectedToAuth: true }),
      sessionId: "s1",
    });
    expect(res.state).toBe("needs-reauth");
    expect(prisma.integrationCredential.update).toHaveBeenCalledTimes(1);
    const blockArg = vi.mocked(prisma.browserSessionBinding.update).mock.calls[0][0] as Record<string, unknown>;
    expect((blockArg.data as Record<string, unknown>).status).toBe("blocked-on-reauth");
  });

  it("returns unknown (not expired) when the probe throws", async () => {
    const res = await checkSessionFreshness({
      credentialId: "c1",
      probeUrl: "https://substack.com/account",
      probe: async () => { throw new Error("network down"); },
    });
    expect(res.state).toBe("unknown");
    expect(prisma.integrationCredential.update).not.toHaveBeenCalled();
  });

  it("deriveReauthState is pure", () => {
    expect(deriveReauthState({ authenticated: true })).toBe("fresh");
    expect(deriveReauthState({ authenticated: false })).toBe("needs-reauth");
  });
});

describe("listBrowserSessions (§10.1)", () => {
  it("maps binding rows to ledger rows newest-first with ISO timestamps", async () => {
    vi.mocked(prisma.browserSessionBinding.findMany).mockResolvedValueOnce([
      {
        sessionId: "s1", means: "plugin", engine: "chromium", profileKind: "service-account",
        attended: false, status: "active", targetDomains: ["substack.com"], delegatingUserId: "u1",
        actingPrincipalId: "p1", credentialId: "c1", evidenceDir: null,
        startedAt: new Date("2026-06-05T12:00:00Z"), closedAt: null,
      } as never,
    ]);
    const rows = await listBrowserSessions({ status: "active", limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0].sessionId).toBe("s1");
    expect(rows[0].startedAt).toBe("2026-06-05T12:00:00.000Z");
    expect(rows[0].closedAt).toBeNull();
    const arg = vi.mocked(prisma.browserSessionBinding.findMany).mock.calls[0][0];
    expect(arg?.where).toMatchObject({ status: "active" });
    expect(arg?.take).toBe(10);
  });
});
