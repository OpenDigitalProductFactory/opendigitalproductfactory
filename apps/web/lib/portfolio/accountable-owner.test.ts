import { describe, expect, it, vi } from "vitest";

import {
  FOUNDATIONAL_PORTFOLIO_SLUG,
  resolveWorkOwner,
  setPortfolioOwner,
  type AccountableOwnerDb,
} from "./accountable-owner";

// A small in-memory install: principals link to users through a `user` alias.
function install(opts: {
  portfolios?: Array<{ id: string; slug: string; accountablePrincipalId: string | null }>;
  orgAccountable?: string | null;
  principals?: Array<{ id: string; kind: string; status: string; userId?: string; displayName?: string }>;
  users?: Array<{ id: string; email: string; isActive: boolean; isSuperuser?: boolean }>;
}) {
  const portfolios = opts.portfolios ?? [];
  const principals = opts.principals ?? [];
  const users = opts.users ?? [];
  const update = vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => ({ id: args.where.id }));
  const db: AccountableOwnerDb = {
    portfolio: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; slug?: string } }) =>
        portfolios.find((p) => (where.id ? p.id === where.id : p.slug === where.slug)) ?? null),
      update,
    },
    organization: { findFirst: vi.fn(async () => ({ topAccountablePrincipalId: opts.orgAccountable ?? null })) },
    principal: {
      findFirst: vi.fn(async ({ where }: { where: { OR: Array<{ id?: string; principalId?: string }> } }) => {
        const ref = where.OR[0].id ?? where.OR[1].principalId;
        const p = principals.find((x) => x.id === ref || `PRN-${x.id}` === ref);
        return p ? { id: p.id, kind: p.kind, status: p.status, displayName: p.displayName ?? p.id } : null;
      }),
    },
    principalAlias: {
      findFirst: vi.fn(async ({ where }: { where: { principalId: string } }) => {
        const p = principals.find((x) => x.id === where.principalId && x.kind === "human" && x.status === "active");
        return p?.userId ? { aliasValue: p.userId } : null;
      }),
    },
    user: {
      findFirst: vi.fn(async ({ where }: { where: { id?: string; isActive?: boolean; isSuperuser?: boolean } }) => {
        if (where.id) return users.find((u) => u.id === where.id && u.isActive) ?? null;
        return users.find((u) => u.isSuperuser && u.isActive) ?? null;
      }),
    },
  };
  return { db, update };
}

const mark = { id: "p-mark", kind: "human", status: "active", userId: "u-mark", displayName: "Mark" };
const laura = { id: "p-laura", kind: "human", status: "active", userId: "u-laura", displayName: "Laura" };
const users = [
  { id: "u-admin", email: "admin@dpf.local", isActive: true, isSuperuser: true },
  { id: "u-mark", email: "mark@example.com", isActive: true, isSuperuser: true },
  { id: "u-laura", email: "laura@example.com", isActive: true },
];

describe("resolveWorkOwner (BI-67B27832)", () => {
  it("uses the given portfolio's accountable owner first", async () => {
    const { db } = install({
      portfolios: [{ id: "pf-sold", slug: "products_and_services_sold", accountablePrincipalId: "p-mark" }],
      orgAccountable: "p-laura", principals: [mark, laura], users,
    });
    await expect(resolveWorkOwner(db, { portfolioId: "pf-sold" })).resolves.toEqual({ userId: "u-mark", source: "portfolio" });
  });

  it("falls to the Foundational portfolio's owner for platform work with no portfolio", async () => {
    const { db } = install({
      portfolios: [{ id: "pf-found", slug: FOUNDATIONAL_PORTFOLIO_SLUG, accountablePrincipalId: "p-mark" }],
      orgAccountable: "p-laura", principals: [mark, laura], users,
    });
    await expect(resolveWorkOwner(db, {})).resolves.toEqual({ userId: "u-mark", source: "foundational" });
  });

  it("falls to the organization's top accountable when no portfolio owner is set", async () => {
    const { db } = install({
      portfolios: [{ id: "pf-sold", slug: "products_and_services_sold", accountablePrincipalId: null }],
      orgAccountable: "p-laura", principals: [mark, laura], users,
    });
    await expect(resolveWorkOwner(db, { portfolioId: "pf-sold" })).resolves.toEqual({ userId: "u-laura", source: "organization" });
  });

  it("skips an owner who is not an active person with an active account", async () => {
    const retired = { ...mark, status: "retired" };
    const { db } = install({
      portfolios: [{ id: "pf-sold", slug: "products_and_services_sold", accountablePrincipalId: "p-mark" }],
      orgAccountable: "p-laura", principals: [retired, laura], users,
    });
    await expect(resolveWorkOwner(db, { portfolioId: "pf-sold" })).resolves.toEqual({ userId: "u-laura", source: "organization" });
  });

  it("only guesses the oldest superuser when nothing is recorded, and says so", async () => {
    const { db } = install({ portfolios: [], orgAccountable: null, principals: [], users });
    await expect(resolveWorkOwner(db, {})).resolves.toEqual({ userId: "u-admin", source: "fallback" });
  });

  it("throws when there is no owner at all rather than inventing one", async () => {
    const { db } = install({ users: [] });
    await expect(resolveWorkOwner(db, {})).rejects.toThrow(/owner/i);
  });
});

describe("setPortfolioOwner (BI-67B27832)", () => {
  const base = {
    portfolios: [{ id: "pf-found", slug: FOUNDATIONAL_PORTFOLIO_SLUG, accountablePrincipalId: null }],
    principals: [mark, { id: "p-bot", kind: "agent", status: "active" }, { ...laura, status: "retired" }],
    users,
  };
  const now = new Date("2026-09-29T20:00:00Z");

  it("records the owner, who set it, when, and why", async () => {
    const { db, update } = install(base);
    const result = await setPortfolioOwner(db, {
      portfolioId: "pf-found", principalRef: "PRN-p-mark", reason: "Runs the platform", actor: { userId: "u-mark" }, now,
    });
    expect(result).toEqual({ ok: true, data: { portfolioId: "pf-found", accountablePrincipalId: "p-mark" } });
    expect(update).toHaveBeenCalledWith({
      where: { id: "pf-found" },
      data: { accountablePrincipalId: "p-mark", accountableSetById: "u-mark", accountableSetAt: now, accountableReason: "Runs the platform" },
      select: { id: true },
    });
  });

  it("clears the owner when no principal is given", async () => {
    const { db, update } = install(base);
    const result = await setPortfolioOwner(db, { portfolioId: "pf-found", principalRef: null, reason: "Handing over", actor: { userId: "u-mark" }, now });
    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accountablePrincipalId: null }) }));
  });

  it.each([
    [{ reason: " " }, "reason_required"],
    [{ actor: { userId: null } }, "actor_required"],
    [{ portfolioId: "nope" }, "unknown_portfolio"],
    [{ principalRef: "PRN-missing" }, "unknown_principal"],
    [{ principalRef: "PRN-p-bot" }, "not_a_person"],
    [{ principalRef: "PRN-p-laura" }, "not_active"],
  ])("refuses %o with %s and writes nothing", async (override, error) => {
    const { db, update } = install(base);
    const result = await setPortfolioOwner(db, {
      portfolioId: "pf-found", principalRef: "PRN-p-mark", reason: "Runs the platform", actor: { userId: "u-mark" }, now,
      ...(override as object),
    });
    expect(result).toMatchObject({ ok: false, error });
    expect(update).not.toHaveBeenCalled();
  });
});
