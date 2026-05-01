import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FreshnessBadge } from "./FreshnessBadge";

describe("FreshnessBadge", () => {
  it("renders 'Unknown' (muted) when freshness is null", () => {
    const html = renderToStaticMarkup(<FreshnessBadge freshness={null} />);
    expect(html).toContain("Unknown");
    expect(html).toContain("text-[var(--dpf-muted)]");
  });

  it("renders 'Unknown' (muted) when freshness is undefined", () => {
    const html = renderToStaticMarkup(<FreshnessBadge freshness={undefined} />);
    expect(html).toContain("Unknown");
    expect(html).toContain("text-[var(--dpf-muted)]");
  });

  it("renders 'Fresh' with accent token when fresh", () => {
    const html = renderToStaticMarkup(<FreshnessBadge freshness="fresh" />);
    expect(html).toContain("Fresh");
    expect(html).toContain("text-[var(--dpf-accent)]");
  });

  it("renders 'Stale' with muted token when stale", () => {
    const html = renderToStaticMarkup(<FreshnessBadge freshness="stale" />);
    expect(html).toContain("Stale");
    expect(html).toContain("text-[var(--dpf-muted)]");
  });

  it("renders 'Retired' with strikethrough + muted token when retired", () => {
    const html = renderToStaticMarkup(<FreshnessBadge freshness="retired" />);
    expect(html).toContain("Retired");
    expect(html).toContain("line-through");
    expect(html).toContain("text-[var(--dpf-muted)]");
  });

  it("uses theme tokens only (no raw white/black/gray classes)", () => {
    const html = renderToStaticMarkup(<FreshnessBadge freshness="fresh" />);
    expect(html).not.toMatch(/text-white|text-black|text-gray-|bg-white|bg-black|bg-gray-/);
    expect(html).toContain("var(--dpf-");
  });
});
