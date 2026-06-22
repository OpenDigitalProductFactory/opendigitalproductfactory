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
