import { describe, expect, it, vi } from "vitest";

import {
  SERVICE_ACCOUNT_ALIAS_TYPE,
  buildServiceAccountPrincipalId,
  findOwnerlessServiceAccounts,
  resolveServiceAccountPrincipal,
} from "./service-account";
import type { ServiceAccountDb } from "./service-account";

// A minimal in-memory stand-in for the slice of Prisma this module touches.
// Mirrors the PrincipalDb injection pattern used by principal-linking.ts so the
// refusal is proven at the module boundary, not in a UI validator.
function makeDb(options?: {
  ownerPrincipalRecordId?: string | null;
  existing?: { principalId: string; sponsorPrincipalId: string | null };
  ownerless?: Array<{ principalId: string; displayName: string }>;
}) {
  const upserts: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const principalAlias = {
    findFirst: vi.fn(async () =>
      options?.ownerPrincipalRecordId === null
        ? null
        : { principal: { id: options?.ownerPrincipalRecordId ?? "prn-row-owner" } },
    ),
  };
  const principal = {
    findUnique: vi.fn(async () => options?.existing ?? null),
    findMany: vi.fn(async () => options?.ownerless ?? []),
    upsert: vi.fn(async (args: Record<string, unknown>) => {
      upserts.push(args);
      return { principalId: (args.where as { principalId: string }).principalId };
    }),
    update: vi.fn(async (args: Record<string, unknown>) => {
      updates.push(args);
      return { principalId: "unused" };
    }),
  };
  // One cast at the seam: a full Prisma delegate type cannot be hand-built, and
  // narrowing the module's own type to just these methods would stop the real
  // client satisfying it.
  const injected = { principal, principalAlias } as unknown as ServiceAccountDb;
  return { upserts, updates, principal, principalAlias, injected };
}

const OWNED = { accountableOwnerUserId: "user-1" };

describe("buildServiceAccountPrincipalId", () => {
  it("preserves the browser-drive grammar exactly — downstream ids embed it", () => {
    // browser-session integration ids are built from this string; changing the
    // shape silently orphans every existing credential and binding.
    expect(buildServiceAccountPrincipalId("browser-svc", ["substack", "default"])).toBe(
      "browser-svc:substack:default",
    );
  });

  it("is deterministic and injective over its segments", () => {
    expect(buildServiceAccountPrincipalId("ns", ["a", "b"])).toBe(
      buildServiceAccountPrincipalId("ns", ["a", "b"]),
    );
    expect(buildServiceAccountPrincipalId("ns", ["a"])).not.toBe(
      buildServiceAccountPrincipalId("ns", ["b"]),
    );
    expect(buildServiceAccountPrincipalId("ns1", ["a"])).not.toBe(
      buildServiceAccountPrincipalId("ns2", ["a"]),
    );
  });

  it("refuses a namespace or segment that would make the id ambiguous", () => {
    expect(() => buildServiceAccountPrincipalId("", ["a"])).toThrow(/namespace/i);
    expect(() => buildServiceAccountPrincipalId("ns", [])).toThrow(/segment/i);
    expect(() => buildServiceAccountPrincipalId("ns", ["a:b"])).toThrow(/separator/i);
  });
});

describe("resolveServiceAccountPrincipal — accountability is refusable", () => {
  it("refuses to mint a service account with no accountable owner", async () => {
    const { injected, upserts } = makeDb();
    await expect(
      resolveServiceAccountPrincipal(
        {
          namespace: "browser-svc",
          segments: ["substack", "default"],
          issuer: "browser-drive",
          accountableOwnerUserId: "",
        },
        injected,
      ),
    ).rejects.toThrow(/accountable owner/i);
    expect(upserts).toHaveLength(0);
  });

  it("refuses when the named owner does not resolve to a principal", async () => {
    const { injected, upserts } = makeDb({ ownerPrincipalRecordId: null });
    await expect(
      resolveServiceAccountPrincipal(
        { namespace: "browser-svc", segments: ["s", "a"], issuer: "browser-drive", ...OWNED },
        injected,
      ),
    ).rejects.toThrow(/could not be resolved/i);
    expect(upserts).toHaveLength(0);
  });

  it("binds the resolved owner as sponsorPrincipalId on create", async () => {
    const { injected, upserts } = makeDb();
    await resolveServiceAccountPrincipal(
      { namespace: "browser-svc", segments: ["substack", "default"], issuer: "browser-drive", ...OWNED },
      injected,
    );
    expect(upserts).toHaveLength(1);
    const create = upserts[0]!.create as Record<string, unknown>;
    expect(create.kind).toBe("service");
    expect(create.sponsorPrincipalId).toBe("prn-row-owner");
    const alias = (create.aliases as { create: Record<string, string> }).create;
    expect(alias.aliasType).toBe(SERVICE_ACCOUNT_ALIAS_TYPE);
    expect(alias.issuer).toBe("browser-drive");
  });

  it("is idempotent — re-resolving an owned account does not rewrite its alias set", async () => {
    const { injected, upserts, updates } = makeDb({
      existing: { principalId: "browser-svc:substack:default", sponsorPrincipalId: "prn-row-owner" },
    });
    await resolveServiceAccountPrincipal(
      { namespace: "browser-svc", segments: ["substack", "default"], issuer: "browser-drive", ...OWNED },
      injected,
    );
    expect(upserts[0]!.update).toEqual({});
    expect(updates).toHaveLength(0);
  });

  it("repairs forward: an existing owner-less account gains a sponsor when touched", async () => {
    const { injected, updates } = makeDb({
      existing: { principalId: "browser-svc:substack:default", sponsorPrincipalId: null },
    });
    await resolveServiceAccountPrincipal(
      { namespace: "browser-svc", segments: ["substack", "default"], issuer: "browser-drive", ...OWNED },
      injected,
    );
    expect(updates).toHaveLength(1);
    expect((updates[0]!.data as Record<string, unknown>).sponsorPrincipalId).toBe("prn-row-owner");
  });
});

describe("findOwnerlessServiceAccounts — the invariant guard", () => {
  it("queries service principals with no sponsor", async () => {
    const { injected, principal } = makeDb({ ownerless: [] });
    await expect(findOwnerlessServiceAccounts(injected)).resolves.toEqual([]);
    expect(principal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { kind: "service", sponsorPrincipalId: null },
      }),
    );
  });

  it("surfaces an owner-less account as a defect rather than hiding it", async () => {
    const orphan = { principalId: "browser-svc:legacy:default", displayName: "legacy" };
    const { injected } = makeDb({ ownerless: [orphan] });
    await expect(findOwnerlessServiceAccounts(injected)).resolves.toEqual([orphan]);
  });
});
