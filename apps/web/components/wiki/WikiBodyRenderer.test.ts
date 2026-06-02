import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { splitMarkdownSections, splitWikilinks, WikiBodyRenderer } from "./WikiBodyRenderer";

describe("splitWikilinks", () => {
  it("returns the whole string when no wikilinks are present", () => {
    expect(splitWikilinks("plain text without brackets")).toEqual([
      { kind: "text", value: "plain text without brackets" },
    ]);
  });

  it("recognises a bare [[slug]]", () => {
    expect(splitWikilinks("see [[entities/digital-product]] now")).toEqual([
      { kind: "text", value: "see " },
      { kind: "wikilink", slug: "entities/digital-product", label: "entities/digital-product" },
      { kind: "text", value: " now" },
    ]);
  });

  it("recognises [[slug|label]]", () => {
    expect(splitWikilinks("see [[entities/digital-product|the DP page]]")).toEqual([
      { kind: "text", value: "see " },
      { kind: "wikilink", slug: "entities/digital-product", label: "the DP page" },
    ]);
  });

  it("handles multiple wikilinks in one string", () => {
    expect(splitWikilinks("[[a]] then [[b|Label B]] and [[c]]")).toEqual([
      { kind: "wikilink", slug: "a", label: "a" },
      { kind: "text", value: " then " },
      { kind: "wikilink", slug: "b", label: "Label B" },
      { kind: "text", value: " and " },
      { kind: "wikilink", slug: "c", label: "c" },
    ]);
  });

  it("leaves malformed brackets as plain text", () => {
    expect(splitWikilinks("not a [[ link with spaces ]] here")).toEqual([
      { kind: "text", value: "not a [[ link with spaces ]] here" },
    ]);
  });

  it("does not match a single-bracket [link]", () => {
    expect(splitWikilinks("a [link] only")).toEqual([
      { kind: "text", value: "a [link] only" },
    ]);
  });

  it("returns an empty array for an empty string", () => {
    expect(splitWikilinks("")).toEqual([]);
  });
});

describe("splitMarkdownSections", () => {
  it("keeps introduction markdown visible before collapsible h2 sections", () => {
    expect(splitMarkdownSections("Intro copy\n\n## Rule\nBody\n\n## Why\nMore")).toEqual([
      { kind: "intro", markdown: "Intro copy" },
      { kind: "section", heading: "Rule", markdown: "Body" },
      { kind: "section", heading: "Why", markdown: "More" },
    ]);
  });

  it("does not split headings inside fenced code blocks", () => {
    expect(
      splitMarkdownSections("## Rule\n\n```md\n## Not a section\n```\n\nBody"),
    ).toEqual([
      { kind: "section", heading: "Rule", markdown: "```md\n## Not a section\n```\n\nBody" },
    ]);
  });

  it("renders h2 sections as native disclosure controls", () => {
    const html = renderToStaticMarkup(
      WikiBodyRenderer({ body: "## Rule\nBody\n\n## Why\nMore" }),
    );

    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("Rule");
    expect(html).toContain("Why");
    expect(html).toContain("Body");
  });
});
