import { describe, it, expect } from "vitest";
import {
  buildDocSearchText,
  parseDocFrontmatter,
  buildDocsIndex,
  extractHeadings,
} from "./docs";

describe("parseDocFrontmatter", () => {
  it("extracts title, area, and order from frontmatter", () => {
    const raw = `---
title: "Getting Started"
area: getting-started
order: 1
---

## Welcome

This is the getting started guide.`;

    const result = parseDocFrontmatter(raw);
    expect(result.title).toBe("Getting Started");
    expect(result.area).toBe("getting-started");
    expect(result.order).toBe(1);
    expect(result.content).toContain("## Welcome");
    expect(result.content).not.toContain("---");
  });

  it("returns defaults for missing optional fields", () => {
    const raw = `---
title: "Test"
area: test
order: 1
---

Content here.`;

    const result = parseDocFrontmatter(raw);
    expect(result.relatedSpecs).toEqual([]);
    expect(result.roles).toEqual([]);
  });

  it("uses the canonical frontmatter description when present", () => {
    const raw = `---
title: "Storefront"
description: "Create, verify, and publish the customer portal."
area: storefront
order: 1
---

## Overview

Body copy that should not replace the authored description.`;

    expect(parseDocFrontmatter(raw).description).toBe(
      "Create, verify, and publish the customer portal.",
    );
  });

  it("derives a readable description from the first prose paragraph", () => {
    const raw = `---
title: "Storefront"
area: storefront
order: 1
---

## Overview

Use **Storefront** to manage [customer content](./content.md) and \`booking\` flows.

## Later

More detail.`;

    expect(parseDocFrontmatter(raw).description).toBe(
      "Use Storefront to manage customer content and booking flows.",
    );
  });
});

describe("buildDocSearchText", () => {
  it("keeps useful terms beyond the old 500-character cutoff and removes markdown noise", () => {
    const markdown = `## Overview

${"intro ".repeat(100)}

## Recovery

Restore the prior configuration from the evidence ledger.`;

    const result = buildDocSearchText(markdown);
    expect(result).toContain("Recovery");
    expect(result).toContain("evidence ledger");
    expect(result).not.toContain("##");
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
      { slug: "getting-started/roles", title: "Roles", description: "", area: "getting-started", order: 2, content: "", relatedSpecs: [], roles: [] },
      { slug: "getting-started/index", title: "Overview", description: "", area: "getting-started", order: 1, content: "", relatedSpecs: [], roles: [] },
      { slug: "compliance/index", title: "Compliance", description: "", area: "compliance", order: 1, content: "", relatedSpecs: [], roles: [] },
    ];
    const index = buildDocsIndex(docs);
    expect(Object.keys(index)).toContain("getting-started");
    expect(Object.keys(index)).toContain("compliance");
    expect(index["getting-started"]![0]!.title).toBe("Overview");
    expect(index["getting-started"]![1]!.title).toBe("Roles");
  });
});
