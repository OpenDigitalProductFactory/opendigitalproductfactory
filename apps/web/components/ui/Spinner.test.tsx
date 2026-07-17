import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Spinner } from "./Spinner";

describe("Spinner", () => {
  it("renders an announced status region with a default label", () => {
    const html = renderToStaticMarkup(<Spinner />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Loading…");
    expect(html).toContain("sr-only");
    expect(html).toContain("dpf-spin");
  });

  it("uses a custom label", () => {
    const html = renderToStaticMarkup(<Spinner label="Summarizing…" />);
    expect(html).toContain("Summarizing…");
  });

  it("is purely decorative when presentational (no status role, hidden ring)", () => {
    const html = renderToStaticMarkup(<Spinner presentational />);
    expect(html).not.toContain('role="status"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("dpf-spin");
  });

  it("colors the ring from tokens, never raw hex", () => {
    const html = renderToStaticMarkup(<Spinner size="lg" />);
    expect(html).toMatch(/var\(--dpf-accent\)/);
    expect(html).toMatch(/var\(--dpf-border\)/);
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("derives the ring from currentColor when tone='current'", () => {
    const html = renderToStaticMarkup(<Spinner tone="current" presentational />);
    expect(html).toMatch(/currentColor/);
    expect(html).not.toMatch(/var\(--dpf-accent\)/);
  });
});
