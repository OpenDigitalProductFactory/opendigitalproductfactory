import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  usePathname: () => "/ea/models",
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { EaTabNav } from "@/components/ea/EaTabNav";

describe("EaTabNav", () => {
  it("renders Views and Reference Models tabs without Agents", () => {
    const html = renderToStaticMarkup(<EaTabNav />);

    expect(html).toContain(">Views<");
    expect(html).toContain(">Reference Models<");
    expect(html).not.toContain(">Agents<");
    expect(html).toContain('href="/ea/models"');
  });
});
