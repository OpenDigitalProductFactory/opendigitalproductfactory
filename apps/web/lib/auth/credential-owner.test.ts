import { describe, expect, it } from "vitest";

import { resolveCredentialOwner } from "./credential-owner";

// BI-81F01D3A: the toolchain bootstrap issued Grok's credentials client with no
// --user, and the issuer defaulted to admin@dpf.local, so Grok acted as the
// bootstrap account and its approvals went to an inbox nobody reads.

const users = [
  { id: "u-admin", email: "admin@dpf.local", isActive: true },
  { id: "u-mark", email: "mark@example.com", isActive: true },
  { id: "u-gone", email: "gone@example.com", isActive: false },
];

function db(ownerUserId: string | null) {
  return {
    user: {
      findFirst: async ({ where }: { where: { email?: string; id?: string } }) =>
        users.find((u) => (where.email ? u.email === where.email : u.id === where.id)) ?? null,
    },
    findOwner: async () => ownerUserId,
  };
}

describe("resolveCredentialOwner", () => {
  it("uses the install's accountable owner when no account is named, not the bootstrap admin", async () => {
    const d = db("u-mark");
    const owner = await resolveCredentialOwner(d.user, d.findOwner, undefined);
    expect(owner).toEqual({ ok: true, user: { id: "u-mark", email: "mark@example.com" }, source: "accountable-owner" });
  });

  it("uses an explicitly named account", async () => {
    const d = db("u-mark");
    expect(await resolveCredentialOwner(d.user, d.findOwner, "admin@dpf.local"))
      .toEqual({ ok: true, user: { id: "u-admin", email: "admin@dpf.local" }, source: "named" });
  });

  it("refuses an unknown or deactivated named account", async () => {
    const d = db("u-mark");
    expect((await resolveCredentialOwner(d.user, d.findOwner, "nobody@example.com")).ok).toBe(false);
    expect((await resolveCredentialOwner(d.user, d.findOwner, "gone@example.com")).ok).toBe(false);
  });

  it("refuses when the install has nobody to own it", async () => {
    const d = db(null);
    expect((await resolveCredentialOwner(d.user, d.findOwner, undefined)).ok).toBe(false);
  });
});
