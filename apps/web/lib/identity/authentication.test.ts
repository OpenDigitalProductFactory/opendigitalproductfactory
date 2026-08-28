import { describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above module scope, so the spy must be created inside
// vi.hoisted or the factory closes over an uninitialised binding.
const linking = vi.hoisted(() => ({ syncUserPrincipal: vi.fn() }));
vi.mock("./principal-linking", () => linking);
const { syncUserPrincipal } = linking;

import {
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

describe("deactivatePrincipalAndCredentials — one transaction, not an eventual sync", () => {
  it("disables the principal and every bound credential together", async () => {
    const principalUpdate = vi.fn(async () => ({
      principalId: "prn-h",
      aliases: [{ aliasValue: "user-1" }, { aliasValue: "user-2" }],
    }));
    const userUpdateMany = vi.fn(async () => ({ count: 2 }));
    const client = {
      $transaction: async (fn: (tx: unknown) => unknown) =>
        fn({ principal: { update: principalUpdate }, user: { updateMany: userUpdateMany } }),
    };

    await expect(
      deactivatePrincipalAndCredentials("prn-h", client as never),
    ).resolves.toEqual({ principalId: "prn-h", userIdsDisabled: ["user-1", "user-2"] });

    expect(principalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "inactive" } }),
    );
    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["user-1", "user-2"] } },
      data: { isActive: false },
    });
  });

  it("does not attempt a credential update when the principal has none", async () => {
    const userUpdateMany = vi.fn();
    const client = {
      $transaction: async (fn: (tx: unknown) => unknown) =>
        fn({
          principal: { update: async () => ({ principalId: "prn-agent", aliases: [] }) },
          user: { updateMany: userUpdateMany },
        }),
    };
    await deactivatePrincipalAndCredentials("prn-agent", client as never);
    expect(userUpdateMany).not.toHaveBeenCalled();
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
