import { describe, expect, it } from "vitest";

import { getDomainNavEntries, getAllNavEntries } from "./domain-nav-sources";

describe("getDomainNavEntries", () => {
  const entries = getDomainNavEntries();

  it("registers Finance section routes as navigation entries", () => {
    const paths = entries.map((e) => e.path);
    expect(paths).toContain("/finance/invoices");
    expect(paths).toContain("/finance/bills");
    expect(paths).toContain("/finance/reports");
    expect(paths).toContain("/finance/banking");
  });

  it("registers Admin section routes as navigation entries in the admin domain", () => {
    const paths = entries.map((e) => e.path);
    expect(paths).toContain("/admin/settings");
    expect(paths).toContain("/admin/branding");
    const admin = entries.filter((e) => e.path.startsWith("/admin"));
    expect(admin.length).toBeGreaterThan(0);
    expect(admin.every((e) => e.domain === "admin" && e.targetDomain === "admin")).toBe(true);
  });

  it("registers Compliance section routes as navigation entries", () => {
    const paths = entries.map((e) => e.path);
    expect(paths).toContain("/compliance/risks");
    expect(paths).toContain("/compliance/controls");
    expect(paths).toContain("/compliance/audits");
  });

  it("registers EA, Ops, and Marketing section routes as navigation entries", () => {
    const paths = entries.map((e) => e.path);
    // EA + Ops are delivery-domain; Marketing is customer-domain — all in-domain.
    expect(paths).toContain("/ea/capabilities");
    expect(paths).toContain("/ea/value-streams");
    expect(paths).toContain("/ops/self-upgrade");
    expect(paths).toContain("/ops/changes");
    expect(paths).toContain("/customer/marketing/campaigns");
    expect(paths).toContain("/customer/marketing/strategy");
  });

  it("registers Storefront section + settings routes as navigation entries", () => {
    const paths = entries.map((e) => e.path);
    expect(paths).toContain("/storefront/team");
    expect(paths).toContain("/storefront/inbox");
    expect(paths).toContain("/storefront/settings/business");
    expect(paths).toContain("/storefront/settings/operations");
  });

  it("attributes Finance entries to the business domain with no teleport (all in-domain)", () => {
    const finance = entries.filter((e) => e.path.startsWith("/finance"));
    expect(finance.length).toBeGreaterThan(0);
    expect(finance.every((e) => e.domain === "business")).toBe(true);
    expect(finance.every((e) => e.targetDomain === "business")).toBe(true);
  });

  it("has no duplicate paths", () => {
    const paths = entries.map((e) => e.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("follows the redirect map so a per-domain entry that bounces into another domain is a teleport", () => {
    // Synthetic map: pretend /finance/invoices is a shim that redirects into the admin domain.
    const withMap = getDomainNavEntries(new Map([["/finance/invoices", "/admin/settings"]]));
    const invoice = withMap.find((e) => e.path === "/finance/invoices");
    expect(invoice?.domain).toBe("business");
    expect(invoice?.viaRedirect).toBe(true);
    expect(invoice?.effectivePath).toBe("/admin/settings");
    expect(invoice?.targetDomain).toBe("admin"); // resolved THROUGH the redirect → cross-domain
  });
});

describe("getAllNavEntries (canonical + per-domain, unified)", () => {
  const entries = getAllNavEntries();

  it("merges canonical and per-domain sources", () => {
    const paths = entries.map((e) => e.path);
    expect(paths).toContain("/platform"); // canonical
    expect(paths).toContain("/finance/invoices"); // per-domain (Finance)
  });

  it("dedupes by path so a shared path (/finance) appears once", () => {
    const paths = entries.map((e) => e.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.filter((p) => p === "/finance")).toHaveLength(1);
  });

  it("introduces no cross-domain teleports", () => {
    expect(entries.filter((e) => e.domain !== e.targetDomain)).toEqual([]);
  });
});
