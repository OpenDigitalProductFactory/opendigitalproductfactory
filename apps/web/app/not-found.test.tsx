// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const pathname = vi.fn<() => string>();
vi.mock("next/navigation", () => ({ usePathname: () => pathname() }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import NotFound from "./not-found";
import { withMessages } from "@/test-support/with-messages";

// BI-B9D54962: the global 404 must not send a public prospect hitting an
// unprovisioned archetype demo route (source-registered in
// packages/storefront-templates but not wired to a live route) or a stray
// public /s/… path to the internal Workspace/Docs recovery. Internal
// shell-route typos keep the existing operator-oriented recovery.
describe("global not-found recovery", () => {
  it("tells a warehousing prospect the demo isn't generated yet, not workspace/docs", () => {
    pathname.mockReturnValue("/third-party-logistics");
    const html = renderToStaticMarkup(withMessages(<NotFound />));
    expect(html).toMatch(/has not been generated yet/i);
    expect(html).toMatch(/3PL Contract Warehousing/);
    expect(html).not.toContain("/workspace");
    expect(html).not.toContain("Browse docs");
  });

  it("covers every source-registered warehousing archetype, not just one", () => {
    for (const id of [
      "third-party-logistics",
      "ecommerce-fulfilment",
      "cold-chain-storage",
      "cross-dock-transload",
    ]) {
      pathname.mockReturnValue(`/${id}`);
      const html = renderToStaticMarkup(withMessages(<NotFound />));
      expect(html).toMatch(/has not been generated yet/i);
      expect(html).not.toContain("/workspace");
    }
  });

  it("keeps a stray public /s/… path customer-safe when no nested boundary matched", () => {
    pathname.mockReturnValue("/s/");
    const html = renderToStaticMarkup(withMessages(<NotFound />));
    expect(html).not.toContain("/workspace");
    expect(html).not.toContain("Browse docs");
    expect(html).toContain('href="/"');
  });

  it("keeps the operator-oriented recovery for an internal shell-route typo", () => {
    pathname.mockReturnValue("/platfrom/ai/agents");
    const html = renderToStaticMarkup(withMessages(<NotFound />));
    expect(html).toContain("Back to workspace");
    expect(html).toContain("Browse docs");
    expect(html).toContain('href="/workspace"');
  });

  // AC-PILOTS: every string comes from the catalog, so the en-XA pseudo-locale
  // leaves no raw English behind.
  it("renders from the catalog: en-XA leaves no raw English in the pilot copy", () => {
    pathname.mockReturnValue("/workspace/nowhere");
    const html = renderToStaticMarkup(withMessages(<NotFound />, "en-XA"));
    for (const english of ["This page could not be found", "Back to workspace", "Browse docs", "left rail"]) {
      expect(html).not.toContain(english);
    }
    expect(html).toContain("⟦");
  });
});
