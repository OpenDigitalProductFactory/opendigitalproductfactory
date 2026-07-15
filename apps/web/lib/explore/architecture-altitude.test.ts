import { describe, it, expect } from "vitest";
import {
  classifyArchitectureAltitude,
  isCorePlatformAltitude,
} from "./architecture-altitude";

describe("classifyArchitectureAltitude (BI-4A30D8AC)", () => {
  it("treats ordinary product features as functional", () => {
    const v = classifyArchitectureAltitude({
      title: "Add invoice CSV export",
      body: "Operator can download last month's invoices.",
      workType: "feature",
    });
    expect(v.altitude).toBe("functional");
    expect(v.reason).toBeNull();
    expect(v.signals).toEqual([]);
    expect(
      isCorePlatformAltitude({
        title: "Add invoice CSV export",
        body: "Operator can download last month's invoices.",
        workType: "feature",
      }),
    ).toBe(false);
  });

  it("elevates workType=refactor as core-platform", () => {
    const v = classifyArchitectureAltitude({
      title: "Tidy helpers",
      body: "No schema changes.",
      workType: "refactor",
    });
    expect(v.altitude).toBe("core-platform");
    expect(v.signals).toContain("workType=refactor");
    expect(v.reason).toMatch(/direct expert build/i);
    expect(v.reason).toMatch(/force=true/i);
  });

  it("elevates schema.prisma / migration language", () => {
    const v = classifyArchitectureAltitude({
      title: "Add unique constraint on WikiPage",
      body: "Update schema.prisma and ship a prisma migrate.",
      workType: "feature",
    });
    expect(v.altitude).toBe("core-platform");
    expect(v.signals.some((s) => s.includes("schema") || s.includes("migration"))).toBe(true);
  });

  it("elevates datastore / BET refactors", () => {
    const v = classifyArchitectureAltitude({
      title: "BET-5 · Hybridize Neo4j + Qdrant onto Postgres",
      body: "Retire Neo4j and Qdrant; use pgvector.",
      workType: "refactor",
    });
    expect(v.altitude).toBe("core-platform");
    expect(v.signals).toEqual(expect.arrayContaining(["workType=refactor", "bet-refactor"]));
  });

  it("does not flag customer CRM work as core-platform", () => {
    const v = classifyArchitectureAltitude({
      title: "Add prospect Emma3D to CRM",
      body: "Create account and contact for Ian Pruden.",
      workType: "feature",
    });
    expect(v.altitude).toBe("functional");
  });
});
