import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let pathname = "/portfolio/product/product-1/direction";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { BusinessProductTabNav } from "./BusinessProductTabNav";

describe("BusinessProductTabNav", () => {
  it("exposes Direction without leaking DigitalProduct lifecycle families", () => {
    const html = renderToStaticMarkup(
      <BusinessProductTabNav productId="product-1" />,
    );

    expect(html).toContain(">Direction<");
    expect(html).toContain(">Brief<");
    expect(html).toContain(">Intelligence<");
    expect(html).toContain(">Roadmap<");
    expect(html).toContain(">Outcomes<");
    expect(html).not.toContain(">Architecture<");
    expect(html).not.toContain(">Operate<");
  });

  it("keeps the Direction family active for sibling views", () => {
    pathname = "/portfolio/product/product-1/direction/outcomes";
    const html = renderToStaticMarkup(
      <BusinessProductTabNav productId="product-1" />,
    );

    expect(html).toContain('href="/portfolio/product/product-1/direction/outcomes"');
  });
});
