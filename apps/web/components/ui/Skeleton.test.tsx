import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Skeleton, SkeletonText } from "./Skeleton";

describe("Skeleton", () => {
  it("renders a decorative shimmer block with a token gradient", () => {
    const html = renderToStaticMarkup(<Skeleton width="50%" height="1rem" />);
    expect(html).toContain("dpf-shimmer");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/var\(--dpf-surface-2\)/);
    expect(html).toMatch(/var\(--dpf-surface-3\)/);
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("applies numeric width/height as pixels", () => {
    const html = renderToStaticMarkup(<Skeleton width={120} height={12} />);
    expect(html).toMatch(/width:120px/);
    expect(html).toMatch(/height:12px/);
  });

  it("renders a circle when asked", () => {
    const html = renderToStaticMarkup(<Skeleton circle width={24} height={24} />);
    expect(html).toContain("rounded-full");
  });
});

describe("SkeletonText", () => {
  it("renders the requested number of lines", () => {
    const html = renderToStaticMarkup(<SkeletonText lines={4} />);
    // 4 shimmer lines inside the aria-hidden wrapper.
    expect(html.match(/dpf-shimmer/g)?.length).toBe(4);
  });

  it("shortens the last line for a paragraph tail", () => {
    const html = renderToStaticMarkup(
      <SkeletonText lines={2} lastLineWidth="40%" />,
    );
    expect(html).toMatch(/width:40%/);
  });
});
