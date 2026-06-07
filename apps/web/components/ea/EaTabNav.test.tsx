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
  it("renders the architecture aspect tabs without Agents", () => {
    const html = renderToStaticMarkup(<EaTabNav />);

    expect(html).toContain(">Capability Map<");
    expect(html).toContain(">Value Streams<");
    expect(html).toContain(">Data Model<");
    expect(html).toContain(">Reference Models<");
    expect(html).not.toContain(">Agents<");
    expect(html).toContain('href="/ea/capabilities"');
    expect(html).toContain('href="/ea/value-streams"');
    expect(html).toContain('href="/ea/data-model"');
    expect(html).toContain('href="/ea/views"');
    expect(html).toContain('href="/ea/models"');
  });
});
