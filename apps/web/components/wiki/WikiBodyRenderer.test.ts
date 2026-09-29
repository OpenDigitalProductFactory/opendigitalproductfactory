import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { splitMarkdownSections, WikiBodyRenderer } from "./WikiBodyRenderer";

describe("WikiBodyRenderer wikilinks", () => {
  const render = (body: string) => renderToStaticMarkup(WikiBodyRenderer({ body }));

  it("links a bare [[slug]] with the slug as its label", () => {
    expect(render("see [[entities/digital-product]] now")).toContain(
      '<a href="/coworker-decisions/entities/digital-product" class="text-[var(--dpf-accent)] hover:underline">entities/digital-product</a>',
    );
  });

  it("links [[slug|label]] with the label", () => {
    expect(render("see [[entities/digital-product|the DP page]]")).toContain(">the DP page</a>");
  });

  it("links several wikilinks in one paragraph, and inside list items", () => {
    const html = render("[[a]] then [[b|Label B]]\n\n- item [[c]]");
    expect(html).toContain('href="/coworker-decisions/a"');
    expect(html).toContain(">Label B</a>");
    expect(html).toContain('href="/coworker-decisions/c"');
  });

  it("leaves malformed and single brackets as text", () => {
    const html = render("not a [[ link with spaces ]] here, a [link] only");
    expect(html).not.toContain("<a ");
    expect(html).toContain("[[ link with spaces ]]");
  });

  it("does not link inside code", () => {
    expect(render("`[[a]]`")).not.toContain("<a ");
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
