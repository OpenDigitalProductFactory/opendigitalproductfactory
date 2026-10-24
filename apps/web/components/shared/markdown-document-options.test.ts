import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/lib/shared/markdown";
import { DOCUMENT_MARKDOWN_OPTIONS } from "./markdown-document-options";

const SAMPLE = [
  "# Title",
  "## Section",
  "Text with **bold**, *em*, ~~gone~~, `code` and [a link](https://dpf.example/x).",
  "- one\n- [x] done",
  "1. first",
  "> quoted",
  "```ts\nconst a = 1;\n```",
  "| A | B |\n| - | - |\n| 1 | 2 |",
  "---",
].join("\n\n");

describe("DOCUMENT_MARKDOWN_OPTIONS", () => {
  const html = renderMarkdown(SAMPLE, DOCUMENT_MARKDOWN_OPTIONS);

  it("gives every rendered element a class, so nothing falls back to bare preflight text", () => {
    for (const tag of ["h1", "h2", "p", "strong", "em", "s", "code", "a", "ul", "ol", "li", "blockquote", "pre", "table", "th", "td", "hr"]) {
      expect(html, tag).toMatch(new RegExp(`<${tag}[^>]* class="[^"]+"`));
    }
    expect(html).toContain('<div class="overflow-x-auto mb-3">');
  });

  it("opens external links in a new tab", () => {
    expect(html).toMatch(/<a href="https:\/\/dpf\.example\/x"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  });

  it("uses theme tokens only: no hardcoded colours and no typography-plugin classes", () => {
    const classes = Object.values(DOCUMENT_MARKDOWN_OPTIONS.classes ?? {}).join(" ");
    expect(classes).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
    expect(classes).not.toMatch(/\b(text|bg|border)-(white|black|gray-\d+|slate-\d+|zinc-\d+|neutral-\d+)\b/);
    expect(classes).not.toMatch(/\bprose\b/);
    for (const colour of classes.match(/\[[^\]]+\]/g) ?? []) {
      expect(colour).toMatch(/^\[var\(--dpf-[a-z0-9-]+\)\]$|^\[&>/);
    }
  });
});
