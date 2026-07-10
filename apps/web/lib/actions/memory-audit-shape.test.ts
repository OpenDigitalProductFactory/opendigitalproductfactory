import { describe, it, expect } from "vitest";
import {
  toAuditRow,
  groupAuditRows,
  summarizeAudit,
  categoryLabel,
  humanizeKey,
  type MemoryAuditFact,
} from "./memory-audit-shape";

function fact(over: Partial<MemoryAuditFact>): MemoryAuditFact {
  return {
    id: "f1",
    category: "preference",
    key: "review_style",
    value: "bullets",
    scope: "user",
    sensitivity: "normal",
    sourceRoute: "/workspace",
    createdAt: new Date("2026-07-01"),
    lastAccessedAt: null,
    ...over,
  };
}

describe("humanizeKey / categoryLabel", () => {
  it("humanizes keys and labels categories in plain language", () => {
    expect(humanizeKey("cloud_provider")).toBe("cloud provider");
    expect(categoryLabel("domain_context")).toBe("About your work");
    expect(categoryLabel("preference")).toBe("Preference");
    expect(categoryLabel("unknown_cat")).toBe("unknown cat");
  });
});

describe("toAuditRow", () => {
  it("maps scope, sensitivity, and provenance without raw enum ids", () => {
    const row = toAuditRow(fact({ scope: "org", sensitivity: "sensitive", sourceRoute: "/build" }));
    expect(row.scope).toBe("org");
    expect(row.sensitive).toBe(true);
    expect(row.provenance).toBe("Learned in /build");
    expect(row.label).toBe("review style");
  });

  it("falls back to a generic provenance when no route", () => {
    expect(toAuditRow(fact({ sourceRoute: null })).provenance).toBe("Learned in conversation");
  });
});

describe("groupAuditRows", () => {
  it("groups by category in display order, newest-first within a group", () => {
    const groups = groupAuditRows([
      fact({ id: "a", category: "domain_context", key: "stack", createdAt: new Date("2026-07-01") }),
      fact({ id: "b", category: "preference", key: "p1", createdAt: new Date("2026-07-02") }),
      fact({ id: "c", category: "preference", key: "p2", createdAt: new Date("2026-07-05") }),
    ]);
    expect(groups.map((g) => g.category)).toEqual(["preference", "domain_context"]);
    // preference group newest-first
    expect(groups[0].rows.map((r) => r.id)).toEqual(["c", "b"]);
  });

  it("appends unknown categories after the known order", () => {
    const groups = groupAuditRows([
      fact({ id: "x", category: "misc", key: "k" }),
      fact({ id: "y", category: "preference", key: "k" }),
    ]);
    expect(groups.map((g) => g.category)).toEqual(["preference", "misc"]);
  });

  it("returns no groups for no facts", () => {
    expect(groupAuditRows([])).toEqual([]);
  });
});

describe("summarizeAudit", () => {
  it("counts total, org-shared, and sensitive", () => {
    const s = summarizeAudit([
      fact({ scope: "org", sensitivity: "normal" }),
      fact({ scope: "user", sensitivity: "sensitive" }),
      fact({ scope: "user", sensitivity: "normal" }),
    ]);
    expect(s).toEqual({ total: 3, orgShared: 1, sensitive: 1 });
  });
});
