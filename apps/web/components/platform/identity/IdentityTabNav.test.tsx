import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let pathname = "/platform/identity";

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

import { IdentityTabNav } from "@/components/platform/identity/IdentityTabNav";

describe("IdentityTabNav", () => {
  it("renders the identity workspace routes for operators", () => {
    pathname = "/platform/identity";
    const html = renderToStaticMarkup(<IdentityTabNav />);

    expect(html).toContain(">Overview<");
    expect(html).toContain(">Principals<");
    expect(html).toContain(">Groups<");
    expect(html).toContain(">Directory<");
    expect(html).toContain(">Federation<");
    expect(html).toContain(">Applications<");
    expect(html).toContain(">Authorization<");
    expect(html).toContain(">Agents<");
  });

  it("marks nested identity routes as active", () => {
    pathname = "/platform/identity/federation";
    const html = renderToStaticMarkup(<IdentityTabNav />);

    expect(html).toContain('href="/platform/identity/federation"');
    expect(html).toContain("border-b-2 border-[var(--dpf-accent)]");
  });
});
