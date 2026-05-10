import { describe, expect, it } from "vitest";
import {
  deriveSlug,
  extractWikilinks,
  parseFrontmatter,
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
