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

import { getPlatformFamily } from "@/components/platform/platform-nav";
import { PlatformTabNav } from "@/components/platform/PlatformTabNav";

describe("Identity workspace platform nav", () => {
  it("maps identity routes into the Identity & Access family", () => {
    expect(getPlatformFamily("/platform/identity").key).toBe("identity");
    expect(getPlatformFamily("/platform/identity/principals").key).toBe("identity");
    expect(getPlatformFamily("/platform/identity/agents").key).toBe("identity");
  });

  it("renders identity family links in the platform tab nav", () => {
    pathname = "/platform/identity/principals";
    const html = renderToStaticMarkup(<PlatformTabNav />);

    expect(html).toContain(">Identity &amp; Access<");
    expect(html).toContain('href="/platform/identity"');
    expect(html).toContain('href="/platform/identity/principals"');
    expect(html).toContain('href="/platform/identity/federation"');
  });
});
