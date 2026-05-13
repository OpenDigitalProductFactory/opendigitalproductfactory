import { describe, expect, it } from "vitest";
import {
  buildKernelQdrantPoints,
  deriveSlug,
  extractPrinciplePayload,
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

  it("parses inline JSON objects (used for principleDimensionVector)", () => {
    const raw = `---
title: T
pageKind: principle
principleDimensionVector: {"long_term_maintainability": 1.0, "schema_grounding": 0.8, "speed_to_value": -0.4}
---

Body.`;
    const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(raw);
    expect(frontmatter.principleDimensionVector).toEqual({
      long_term_maintainability: 1.0,
      schema_grounding: 0.8,
      speed_to_value: -0.4,
    });
  });

  it("coerces true/false scalars to booleans", () => {
    const raw = `---
title: T
pageKind: principle
principlePublic: true
---

Body.`;
    const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(raw);
    expect(frontmatter.principlePublic).toBe(true);
  });

  it("coerces numeric scalars to numbers", () => {
    const raw = `---
title: T
pageKind: principle
principleWeight: 0.85
---

Body.`;
    const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(raw);
    expect(frontmatter.principleWeight).toBe(0.85);
  });

  it("keeps quoted booleans/numbers as strings (escape hatch for values that look numeric)", () => {
    const raw = `---
title: T
pageKind: principle
principleWeightRationale: "0.8"
---

Body.`;
    const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(raw);
    expect(frontmatter.principleWeightRationale).toBe("0.8");
  });
});

describe("seed-wiki-kernel: extractPrinciplePayload", () => {
  it("returns the principle subset of frontmatter for a principle page", () => {
    const payload = extractPrinciplePayload({
      title: "Architecture Over Shortcuts",
      pageKind: "principle",
      principleTier: "commandment",
      principleDirection:
        "Prefer long-term maintainability over short-term speed.",
      principleDimensionVector: {
        long_term_maintainability: 1.0,
        schema_grounding: 0.8,
      },
      principleAppliesTo: ["in_platform_coworker", "external_coding_agent"],
      principlePublic: true,
      principlePublicRationale:
        "Adopters need to understand DPF's architecture posture.",
    });

    expect(payload).toEqual({
      principleTier: "commandment",
      principleDirection:
        "Prefer long-term maintainability over short-term speed.",
      principleDimensionVector: {
        long_term_maintainability: 1.0,
        schema_grounding: 0.8,
      },
      principleDimensions: ["long_term_maintainability", "schema_grounding"],
      principleAppliesTo: ["in_platform_coworker", "external_coding_agent"],
      principlePublic: true,
      principlePublicRationale:
        "Adopters need to understand DPF's architecture posture.",
    });
  });

  it("derives principleDimensions from vector keys when not explicit", () => {
    const payload = extractPrinciplePayload({
      title: "T",
      pageKind: "principle",
      principleTier: "core",
      principleDimensionVector: {
        capacity_utilization: 1.0,
        governance_compliance: 0.7,
      },
      principleAppliesTo: ["in_platform_coworker"],
    });
    expect(payload.principleDimensions).toEqual([
      "capacity_utilization",
      "governance_compliance",
    ]);
  });

  it("preserves explicit principleDimensions (even when sparser than vector keys)", () => {
    const payload = extractPrinciplePayload({
      title: "T",
      pageKind: "principle",
      principleTier: "core",
      principleDimensions: ["capacity_utilization"],
      principleDimensionVector: {
        capacity_utilization: 1.0,
        governance_compliance: 0.7,
      },
      principleAppliesTo: ["in_platform_coworker"],
    });
    expect(payload.principleDimensions).toEqual(["capacity_utilization"]);
  });

  it("throws with a clear message when the vector references an unknown dimension", () => {
    expect(() =>
      extractPrinciplePayload({
        title: "T",
        pageKind: "principle",
        principleTier: "commandment",
        principleDimensionVector: {
          fictional_axis: 1.0,
          long_term_maintainability: 0.5,
        },
        principleAppliesTo: ["in_platform_coworker"],
      }),
    ).toThrow(/fictional_axis/);
  });

  it("throws when an explicit dimension is outside the registry", () => {
    expect(() =>
      extractPrinciplePayload({
        title: "T",
        pageKind: "principle",
        principleTier: "core",
        principleDimensions: ["long_term_maintainability", "totally_made_up"],
        principleAppliesTo: ["in_platform_coworker"],
      }),
    ).toThrow(/totally_made_up/);
  });

  it("returns an empty payload for non-principle pages", () => {
    const payload = extractPrinciplePayload({
      title: "Edge Node",
      pageKind: "entity",
    });
    expect(payload).toEqual({});
  });

  it("accepts incomplete principle data — validation lives in lint", () => {
    // A draft principle missing direction and vector should still extract;
    // lint detectors (spec section 14) surface the missing fields later.
    const payload = extractPrinciplePayload({
      title: "Draft",
      pageKind: "principle",
      principleTier: "core",
      principleAppliesTo: ["human"],
    });
    expect(payload.principleTier).toBe("core");
    expect(payload.principleAppliesTo).toEqual(["human"]);
    expect(payload.principleDirection).toBeUndefined();
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
