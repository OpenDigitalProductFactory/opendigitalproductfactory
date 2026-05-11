import { describe, expect, it } from "vitest";
import {
  buildKernelQdrantPoints,
  deriveSlug,
  extractWikilinks,
  parseFrontmatter,
  type SeedablePage,
  type WikiPageFrontmatter,
} from "./seed-wiki-kernel";

describe("seed-wiki-kernel: parseFrontmatter", () => {
  it("parses scalar fields", () => {
    const raw = `---
title: Digital Product
pageKind: entity
status: published
---

A digital product is...`;
    const { frontmatter, body } = parseFrontmatter<WikiPageFrontmatter>(raw);
    expect(frontmatter.title).toBe("Digital Product");
    expect(frontmatter.pageKind).toBe("entity");
    expect(frontmatter.status).toBe("published");
    expect(body).toBe("A digital product is...");
  });

  it("parses block-style lists", () => {
    const raw = `---
title: Stance on portfolio anchoring
pageKind: stance
sources:
  - papers/it4it-overview
  - articles/portfolio-as-anchor
---

Body content.`;
    const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(raw);
    expect(frontmatter.sources).toEqual([
      "papers/it4it-overview",
      "articles/portfolio-as-anchor",
    ]);
  });

  it("parses inline arrays", () => {
    const raw = `---
title: T
pageKind: entity
sources: [a, b, c]
---

Body.`;
    const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(raw);
    expect(frontmatter.sources).toEqual(["a", "b", "c"]);
  });

  it("strips surrounding quotes from scalars", () => {
    const raw = `---
title: "Quoted Title"
pageKind: 'stance'
---

Body.`;
    const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(raw);
    expect(frontmatter.title).toBe("Quoted Title");
    expect(frontmatter.pageKind).toBe("stance");
  });

  it("normalises CRLF line endings", () => {
    const raw = "---\r\ntitle: T\r\npageKind: entity\r\n---\r\nBody.\r\n";
    const { frontmatter, body } = parseFrontmatter<WikiPageFrontmatter>(raw);
    expect(frontmatter.title).toBe("T");
    expect(body).toBe("Body.");
  });

  it("throws on missing frontmatter delimiters", () => {
    expect(() => parseFrontmatter("no frontmatter here")).toThrow(/frontmatter delimiters/);
  });
});

describe("seed-wiki-kernel: extractWikilinks", () => {
  it("extracts simple wikilinks", () => {
    const body = "See [[entities/digital-product]] for the formal definition.";
    expect(extractWikilinks(body)).toEqual(["entities/digital-product"]);
  });

  it("dedupes repeated links", () => {
    const body = "[[a]] then [[a]] again, also [[b]] and [[a]] once more.";
    expect(extractWikilinks(body).sort()).toEqual(["a", "b"]);
  });

  it("handles multiple distinct links", () => {
    const body = "[[entities/a]] [[stances/b]] [[heuristics/c]]";
    expect(extractWikilinks(body).sort()).toEqual([
      "entities/a",
      "heuristics/c",
      "stances/b",
    ]);
  });

  it("ignores malformed brackets", () => {
    const body = "[ not a link ] [[ also not a link with spaces ]] [missing-closing";
    expect(extractWikilinks(body)).toEqual([]);
  });

  it("returns empty when no links present", () => {
    expect(extractWikilinks("Plain prose with no brackets.")).toEqual([]);
  });
});

describe("seed-wiki-kernel: deriveSlug", () => {
  it("strips base dir and .md extension", () => {
    const base = "/repo/docs/founder-kernel/wiki";
    const path = "/repo/docs/founder-kernel/wiki/entities/digital-product.md";
    expect(deriveSlug(path, base)).toBe("entities/digital-product");
  });

  it("returns absolute path unchanged when not under base", () => {
    const base = "/elsewhere";
    const path = "/repo/file.md";
    expect(deriveSlug(path, base)).toBe("/repo/file");
  });

  it("handles flat files at the base", () => {
    const base = "/repo/wiki";
    const path = "/repo/wiki/index.md";
    expect(deriveSlug(path, base)).toBe("index");
  });
});

describe("seed-wiki-kernel: buildKernelQdrantPoints", () => {
  const now = new Date("2026-05-10T00:00:00Z");

  const pages: SeedablePage[] = [
    {
      id: "wp_kernel_1",
      slug: "entities/digital-product",
      title: "Digital Product",
      body: "A digital product is...",
      pageKind: "entity",
      status: "published",
    },
    {
      id: "wp_kernel_2",
      slug: "stances/portfolio-as-anchor",
      title: "Portfolio as the Anchor",
      body: "The portfolio is the unit of...",
      pageKind: "stance",
      status: "published",
    },
  ];

  it("builds a point per sidecar record that matches a page", () => {
    const points = buildKernelQdrantPoints(
      pages,
      [
        { slug: "entities/digital-product", vector: [0.1, 0.2, 0.3], model: "ai/nomic-embed-text-v1.5" },
        { slug: "stances/portfolio-as-anchor", vector: [0.4, 0.5, 0.6], model: "ai/nomic-embed-text-v1.5" },
      ],
      "0.1.0",
      now,
    );
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({
      id: "wiki-page-wp_kernel_1",
      vector: [0.1, 0.2, 0.3],
      payload: {
        entityType: "wiki-page",
        entityId: "wp_kernel_1",
        slug: "entities/digital-product",
        title: "Digital Product",
        pageKind: "entity",
        status: "published",
        isKernel: true,
        organizationId: null,
        kernelVersion: "0.1.0",
        kernelPageId: null,
        timestamp: "2026-05-10T00:00:00.000Z",
      },
    });
  });

  it("skips sidecar records with no matching page", () => {
    const points = buildKernelQdrantPoints(
      pages,
      [
        { slug: "entities/digital-product", vector: [0.1], model: "m" },
        { slug: "entities/orphan", vector: [0.2], model: "m" },
      ],
      "0.1.0",
      now,
    );
    expect(points).toHaveLength(1);
    expect(points[0].payload.entityId).toBe("wp_kernel_1");
  });

  it("returns empty array for empty sidecar", () => {
    expect(buildKernelQdrantPoints(pages, [], "0.1.0", now)).toEqual([]);
  });

  it("truncates contentPreview to 500 chars", () => {
    const longBody = "x".repeat(2000);
    const longPages: SeedablePage[] = [
      { id: "wp_long", slug: "entities/long", title: "L", body: longBody, pageKind: "entity", status: "published" },
    ];
    const points = buildKernelQdrantPoints(
      longPages,
      [{ slug: "entities/long", vector: [0], model: "m" }],
      "0.1.0",
      now,
    );
    expect((points[0].payload.contentPreview as string).length).toBe(500);
  });
});
