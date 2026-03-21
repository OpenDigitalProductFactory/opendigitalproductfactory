import { describe, it, expect } from "vitest";
import { parseDocFrontmatter, buildDocsIndex, extractHeadings } from "./docs";

describe("parseDocFrontmatter", () => {
  it("extracts title, area, order, and lastUpdated from frontmatter", () => {
    const raw = `---
title: "Getting Started"
area: getting-started
order: 1
lastUpdated: 2026-03-21
updatedBy: Claude (COO)
---

## Welcome

This is the getting started guide.`;

    const result = parseDocFrontmatter(raw);
    expect(result.title).toBe("Getting Started");
    expect(result.area).toBe("getting-started");
    expect(result.order).toBe(1);
    expect(result.lastUpdated).toBe("2026-03-21");
    expect(result.updatedBy).toBe("Claude (COO)");
    expect(result.content).toContain("## Welcome");
    expect(result.content).not.toContain("---");
  });

  it("returns defaults for missing optional fields", () => {
    const raw = `---
title: "Test"
area: test
order: 1
lastUpdated: 2026-03-21
updatedBy: System
---

Content here.`;

    const result = parseDocFrontmatter(raw);
    expect(result.relatedSpecs).toEqual([]);
    expect(result.roles).toEqual([]);
  });
});

describe("extractHeadings", () => {
  it("extracts h2 and h3 headings for table of contents", () => {
    const md = `## Overview\n\nSome text.\n\n### Sub Topic\n\nMore text.\n\n## Another Section`;
    const headings = extractHeadings(md);
    expect(headings).toEqual([
      { level: 2, text: "Overview", slug: "overview" },
      { level: 3, text: "Sub Topic", slug: "sub-topic" },
      { level: 2, text: "Another Section", slug: "another-section" },
    ]);
  });
});

describe("buildDocsIndex", () => {
  it("groups docs by area and sorts by order", () => {
    const docs = [
      { slug: "getting-started/roles", title: "Roles", area: "getting-started", order: 2, lastUpdated: "2026-03-21", updatedBy: "System", content: "", relatedSpecs: [], roles: [] },
      { slug: "getting-started/index", title: "Overview", area: "getting-started", order: 1, lastUpdated: "2026-03-21", updatedBy: "System", content: "", relatedSpecs: [], roles: [] },
      { slug: "compliance/index", title: "Compliance", area: "compliance", order: 1, lastUpdated: "2026-03-21", updatedBy: "System", content: "", relatedSpecs: [], roles: [] },
    ];
    const index = buildDocsIndex(docs);
    expect(Object.keys(index)).toContain("getting-started");
    expect(Object.keys(index)).toContain("compliance");
    expect(index["getting-started"]![0]!.title).toBe("Overview");
    expect(index["getting-started"]![1]!.title).toBe("Roles");
  });
});
