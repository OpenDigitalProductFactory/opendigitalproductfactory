import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let pathname = "/admin";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import { AdminTabNav } from "@/components/admin/AdminTabNav";

// EP-NAV-COHERENCE P1: AdminTabNav is now the shared operator-console tab row (it
// re-exports ConsoleTabNav). On /admin the SAME row as /platform renders, with the
// Administration family active — so crossing the boundary never swaps the whole context.
describe("AdminTabNav (shared operator-console row)", () => {
  it("renders the one console family row with Administration active on admin paths", () => {
    pathname = "/admin";
    const html = renderToStaticMarkup(<AdminTabNav />);

    // The same console families as /platform — the row persists across the boundary.
    expect(html).toContain(">Overview<");
    expect(html).toContain(">AI Operations<");
    expect(html).toContain(">Tools &amp; Services<");
    expect(html).toContain(">Governance &amp; Audit<");
    expect(html).toContain(">Administration<");
    // The old separate admin family row (Access/Organization/Configuration/Advanced) is gone.
    expect(html).not.toContain(">Access<");
    expect(html).not.toContain(">Advanced<");
    expect(html).not.toContain(">Core Admin<");
  });

  it("exposes the admin areas in the Administration sub-nav", () => {
    pathname = "/admin/settings";
    const html = renderToStaticMarkup(<AdminTabNav />);

    expect(html).toContain('href="/admin/settings"');
    expect(html).toContain('href="/admin/reference-data"');
    expect(html).toContain('href="/admin/business-models"');
    expect(html).toContain('href="/admin/platform-development"');
    expect(html).toContain('href="/admin/diagnostics"');
  });

  it("can reach the platform families from within Admin (one console, no dead end)", () => {
    pathname = "/admin";
    const html = renderToStaticMarkup(<AdminTabNav />);
    // The AI Operations / Tools family tabs link back into /platform — the way out.
    expect(html).toContain('href="/platform/ai"');
    expect(html).toContain('href="/platform/tools"');
  });
});
