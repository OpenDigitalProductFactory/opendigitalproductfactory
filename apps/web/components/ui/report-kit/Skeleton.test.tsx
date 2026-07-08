import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("renders a single shimmering bar by default", () => {
    const html = renderToStaticMarkup(<Skeleton />);
    expect(html).toContain("animate-pulse");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("width:100%");
  });

  it("applies numeric width/height as px", () => {
    const html = renderToStaticMarkup(<Skeleton width={120} height={40} />);
    expect(html).toContain("width:120px");
    expect(html).toContain("height:40px");
  });

  it("renders N line bars with a shortened last line", () => {
    const html = renderToStaticMarkup(<Skeleton lines={3} />);
    // 3 <span> line bars.
    expect(html.match(/animate-pulse/g)?.length).toBe(3);
    expect(html).toContain("width:60%");
  });

  it("uses only tokens — no raw hex", () => {
    const html = renderToStaticMarkup(<Skeleton />);
    expect(html).toContain("var(--dpf-surface-2)");
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  });
});
