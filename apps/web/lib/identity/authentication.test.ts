import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above module scope, so the spy must be created inside
// vi.hoisted or the factory closes over an uninitialised binding.
const linking = vi.hoisted(() => ({
  syncUserPrincipal: vi.fn(),
  syncCustomerPrincipal: vi.fn(),
}));
vi.mock("./principal-linking", () => linking);
const { syncUserPrincipal, syncCustomerPrincipal } = linking;

import {
  AUTHENTICATION_REFUSAL_CODES,
  authorizeIdentityForSession,
  authorizePrincipalForSession,
  deactivatePrincipalAndCredentials,
  resolveAuthenticationAuthority,
} from "./authentication";

function makeDb(principal: { id: string; principalId: string; status: string } | null) {
  let current = principal;
  return {
    set: (next: typeof principal) => {
      current = next;
    },
    db: {
      principalAlias: { findFirst: vi.fn(async () => (current ? { principal: current } : null)) },
      principal: {},
      user: {},
    },
  };
}

const ACTIVE = { id: "row-1", principalId: "prn-h", status: "active" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authorizePrincipalForSession — the spine gates the session", () => {
  it("authorizes an active principal", async () => {
    const { db } = makeDb(ACTIVE);
    await expect(authorizePrincipalForSession("user-1", db as never)).resolves.toMatchObject({
      authorized: true,
      principalId: "prn-h",
      authority: "install",
    });
  });

  it("REFUSES an inactive principal — this is the invariant that was missing", async () => {
    // Before BI-CEACBD0D, auth.ts never read Principal at all, so a principal
    // could be disabled while its User row still logged in.
    const { db } = makeDb({ ...ACTIVE, status: "inactive" });
    await expect(authorizePrincipalForSession("user-1", db as never)).resolves.toMatchObject({
      authorized: false,
      reason: "principal-inactive",
    });
  });

  it("materializes a missing principal rather than falling back to the User row", async () => {
    const { db, set } = makeDb(null);
    syncUserPrincipal.mockImplementationOnce(async () => {
      set(ACTIVE);
    });
    await expect(authorizePrincipalForSession("user-1", db as never)).resolves.toMatchObject({ authorized: true });
    expect(syncUserPrincipal).toHaveBeenCalledWith("user-1", db);
  });

  it("fails closed when the principal still cannot be resolved", async () => {
    const { db } = makeDb(null);
    syncUserPrincipal.mockImplementationOnce(async () => {});
    await expect(authorizePrincipalForSession("user-2", db as never)).resolves.toMatchObject({
      authorized: false,
      reason: "principal-not-resolved",
    });
  });

  it("fails closed when materialization throws", async () => {
    const { db } = makeDb(null);
    syncUserPrincipal.mockImplementationOnce(async () => {
      throw new Error("db down");
    });
    await expect(authorizePrincipalForSession("user-3", db as never)).resolves.toMatchObject({
      authorized: false,
      reason: "principal-not-resolved",
    });
  });
});

describe("authorizeIdentityForSession — every human population crosses one authority seam", () => {
  const contact = {
    id: "contact-1",
    email: "buyer@example.com",
    isActive: true,
    mergedIntoId: null,
    account: {
      id: "account-row-1",
      accountId: "CUST-1",
      name: "Buyer Co",
      status: "active",
      partnerEnrollment: null,
    },
  };

  function customerDb(input?: {
    contact?: typeof contact | null;
    aliases?: Array<{ principal: typeof ACTIVE }>;
  }) {
    return {
      customerContact: {
        findUnique: vi.fn(async () => input?.contact === undefined ? contact : input.contact),
        updateMany: vi.fn(),
      },
      principalAlias: {
        findFirst: vi.fn(),
        findMany: vi.fn(async () => input?.aliases ?? [{ principal: ACTIVE }]),
      },
      principal: {},
      user: {},
    };
  }

  it("publishes one closed refusal-code contract", () => {
    expect(AUTHENTICATION_REFUSAL_CODES).toEqual([
      "no-credential-match",
      "credential-inactive",
      "account-inactive",
      "principal-not-resolved",
      "principal-inactive",
      "authority-conflict",
    ]);
  });

  it("authorizes an active customer through its canonical contact alias", async () => {
    await expect(authorizeIdentityForSession(
      { population: "customer", credentialId: "contact-1" },
      customerDb() as never,
    )).resolves.toMatchObject({
      authorized: true,
      population: "customer",
      credentialId: "contact-1",
      principalId: "prn-h",
    });
  });

  it.each([
    [{ ...contact, isActive: false }, "credential-inactive"],
    [{ ...contact, mergedIntoId: "contact-2" }, "credential-inactive"],
    [{ ...contact, account: { ...contact.account, status: "suspended" } }, "account-inactive"],
    [{ ...contact, account: { ...contact.account, status: "closed" } }, "account-inactive"],
  ] as const)("refuses inactive customer state before materialization", async (row, reason) => {
    await expect(authorizeIdentityForSession(
      { population: "customer", credentialId: "contact-1" },
      customerDb({ contact: row as typeof contact }) as never,
    )).resolves.toMatchObject({ authorized: false, reason });
    expect(syncCustomerPrincipal).not.toHaveBeenCalled();
  });

  it("materializes a missing customer Principal through the shared linker", async () => {
    const db = customerDb({ aliases: [] });
    syncCustomerPrincipal.mockResolvedValueOnce({ ...ACTIVE, kind: "customer", aliases: [] });
    await expect(authorizeIdentityForSession(
      { population: "customer", credentialId: "contact-1" },
      db as never,
    )).resolves.toMatchObject({ authorized: true, principalId: "prn-h" });
    expect(syncCustomerPrincipal).toHaveBeenCalledWith("contact-1", db);
  });

  it("fails closed when contact aliases disagree on the Principal", async () => {
    const db = customerDb({ aliases: [
      { principal: ACTIVE },
      { principal: { ...ACTIVE, id: "row-2", principalId: "prn-other" } },
    ] });
    await expect(authorizeIdentityForSession(
      { population: "customer", credentialId: "contact-1" },
      db as never,
    )).resolves.toMatchObject({ authorized: false, reason: "authority-conflict" });
  });
});

describe("deactivatePrincipalAndCredentials — one transaction, not an eventual sync", () => {
  it("disables the principal and every bound credential together", async () => {
    const principalUpdate = vi.fn(async () => ({
      principalId: "prn-h",
      aliases: [
        { aliasType: "user", aliasValue: "user-1" },
        { aliasType: "user", aliasValue: "user-2" },
      ],
    }));
    const userUpdateMany = vi.fn(async () => ({ count: 2 }));
    const contactUpdateMany = vi.fn(async () => ({ count: 1 }));
    const client = {
      $transaction: async (fn: (tx: unknown) => unknown) =>
        fn({
          principal: { update: principalUpdate },
          user: { updateMany: userUpdateMany },
          customerContact: { updateMany: contactUpdateMany },
        }),
    };

    await expect(
      deactivatePrincipalAndCredentials("prn-h", client as never),
    ).resolves.toEqual({
      principalId: "prn-h",
      userIdsDisabled: ["user-1", "user-2"],
      customerContactIdsDisabled: [],
    });

    expect(principalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "inactive" } }),
    );
    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["user-1", "user-2"] } },
      data: { isActive: false },
    });
    expect(contactUpdateMany).not.toHaveBeenCalled();
  });

  it("does not attempt a credential update when the principal has none", async () => {
    const userUpdateMany = vi.fn();
    const client = {
      $transaction: async (fn: (tx: unknown) => unknown) =>
        fn({
          principal: { update: async () => ({ principalId: "prn-agent", aliases: [] }) },
          user: { updateMany: userUpdateMany },
          customerContact: { updateMany: vi.fn() },
        }),
    };
    await deactivatePrincipalAndCredentials("prn-agent", client as never);
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it("deactivates customer credentials in the same transaction", async () => {
    const customerContactUpdateMany = vi.fn(async () => ({ count: 2 }));
    const client = {
      $transaction: async (fn: (tx: unknown) => unknown) => fn({
        principal: {
          update: async () => ({
            principalId: "prn-customer",
            aliases: [
              { aliasType: "customer_contact", aliasValue: "contact-1" },
              { aliasType: "partner_contact", aliasValue: "contact-2" },
              { aliasType: "email", aliasValue: "buyer@example.com" },
            ],
          }),
        },
        user: { updateMany: vi.fn() },
        customerContact: { updateMany: customerContactUpdateMany },
      }),
    };

    await expect(deactivatePrincipalAndCredentials(
      "prn-customer",
      client as never,
    )).resolves.toEqual({
      principalId: "prn-customer",
      userIdsDisabled: [],
      customerContactIdsDisabled: ["contact-1", "contact-2"],
    });
    expect(customerContactUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["contact-1", "contact-2"] } },
      data: { isActive: false },
    });
  });
});

describe("resolveAuthenticationAuthority — the install is complete without federation", () => {
  it("makes the install authoritative when no upstream is connected", () => {
    expect(
      resolveAuthenticationAuthority({ hasLocalPrincipal: true, connectedUpstreams: [] }),
    ).toMatchObject({ authority: "install", conflict: false });
  });

  it("keeps the install winning when an upstream also claims the identity, and SURFACES the overlap", () => {
    const result = resolveAuthenticationAuthority({
      hasLocalPrincipal: true,
      connectedUpstreams: ["entra"],
    });
    expect(result.authority).toBe("install");
    expect(result.conflict).toBe(true);
    expect(result.explanation).toMatch(/entra/);
  });

  it("defers to an upstream only when there is no local principal", () => {
    expect(
      resolveAuthenticationAuthority({ hasLocalPrincipal: false, connectedUpstreams: ["ldap"] }),
    ).toMatchObject({ authority: "upstream", conflict: false });
  });

  it("reports that nobody can attest an identity the install does not hold", () => {
    expect(
      resolveAuthenticationAuthority({ hasLocalPrincipal: false, connectedUpstreams: [] }),
    ).toMatchObject({ authority: null });
  });
});
