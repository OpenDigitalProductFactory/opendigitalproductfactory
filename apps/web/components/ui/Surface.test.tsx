import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Surface } from "./Surface";

describe("Surface", () => {
  it("defaults to the dominant inline card pattern: div, surface-1, rounded-lg, p-4", () => {
    const html = renderToStaticMarkup(<Surface>Body</Surface>);
    expect(html).toContain("<div");
    expect(html).toContain("border-[var(--dpf-border)]");
    expect(html).toContain("bg-[var(--dpf-surface-1)]");
    expect(html).toContain("rounded-lg");
    expect(html).toContain("p-4");
    expect(html).toContain("Body");
  });

  it("level 2 nests on surface-2 for panels inside a card", () => {
    const html = renderToStaticMarkup(<Surface level={2}>Nested</Surface>);
    expect(html).toContain("bg-[var(--dpf-surface-2)]");
    expect(html).not.toContain("bg-[var(--dpf-surface-1)]");
  });

  it("padding none serves table/list wrappers that pad per row", () => {
    const html = renderToStaticMarkup(<Surface padding="none">rows</Surface>);
    expect(html).not.toMatch(/\bp-(?:3|4|6)\b/);
  });

  it("padding and radius variants map to the measured densities", () => {
    expect(renderToStaticMarkup(<Surface padding="sm">x</Surface>)).toContain("p-3");
    expect(renderToStaticMarkup(<Surface padding="lg">x</Surface>)).toContain("p-6");
    expect(renderToStaticMarkup(<Surface rounded="md">x</Surface>)).toContain("rounded-md");
    expect(renderToStaticMarkup(<Surface rounded="xl">x</Surface>)).toContain("rounded-xl");
  });

  it("renders semantic elements via `as` and forwards native props", () => {
    const html = renderToStaticMarkup(
      <Surface as="section" aria-label="Line items" className="mb-8">
        s
      </Surface>,
    );
    expect(html).toContain("<section");
    expect(html).toContain('aria-label="Line items"');
    expect(html).toContain("mb-8");
  });

  it("uses tokens only — no raw hex anywhere", () => {
    const html = renderToStaticMarkup(<Surface level={2} padding="lg" rounded="xl">x</Surface>);
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  });
});
