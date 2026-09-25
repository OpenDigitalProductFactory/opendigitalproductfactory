import { describe, expect, it } from "vitest";
import { markdownToHtmlDocument } from "./markdown-html";

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("markdownToHtmlDocument", () => {
  it("renders headings, a GFM table, lists and emphasis as HTML", () => {
    const html = markdownToHtmlDocument(
      [
        "# Board pack",
        "",
        "## Adoption",
        "",
        "Some **bold** and _italic_ text.",
        "",
        "| Region | Units |",
        "| :--- | ---: |",
        "| North | 42 |",
        "",
        "- first",
        "- second",
        "",
        "1. one",
        "2. two",
      ].join("\n"),
      "Board pack",
    );
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<title>Board pack</title>");
    expect(html).toContain("<h1>Board pack</h1>");
    expect(html).toContain("<h2>Adoption</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toMatch(/<table>[\s\S]*<th style="text-align:left">Region<\/th>[\s\S]*<td style="text-align:right">42<\/td>[\s\S]*<\/table>/);
    expect(html).toMatch(/<ul>\s*<li>first<\/li>\s*<li>second<\/li>\s*<\/ul>/);
    expect(html).toMatch(/<ol>\s*<li>one<\/li>/);
  });

  it("keeps an embedded data-URI image and turns a remote image into its alt text", () => {
    const html = markdownToHtmlDocument(`![Logo](${PIXEL})\n\n![Chart](https://example.com/chart.png)`, "Images");
    expect(html).toContain(`<img src="${PIXEL}" alt="Logo">`);
    expect(html).not.toContain("example.com");
    expect(html).toContain("[Chart]");
  });

  it("escapes text and never passes raw HTML or unsafe links through", () => {
    const html = markdownToHtmlDocument(
      '<script>alert(1)</script>\n\nA < B & "C"\n\n[bad](javascript:alert(1)) [good](https://dpf.example/a?b=1&c=2)',
      'T <1> & "q"',
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("A &lt; B &amp; \"C\"");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<a href="https://dpf.example/a?b=1&amp;c=2">good</a>');
    expect(html).toContain("<title>T &lt;1&gt; &amp; \"q\"</title>");
  });
});
