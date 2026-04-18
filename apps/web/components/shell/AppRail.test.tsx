import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let pathname = "/finance";

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

import { AppRail } from "@/components/shell/AppRail";
import type { ShellNavSection } from "@/lib/permissions";

const sections: ShellNavSection[] = [
  {
    key: "workspace",
    label: "Workspace",
    description: "Your queue, recents, and AI-guided next steps.",
    items: [
      {
        key: "workspace",
        label: "Workspace",
        href: "/workspace",
        description: "See what needs attention next.",
        sectionKey: "workspace",
        capabilityKey: null,
      },
    ],
  },
  {
    key: "business",
    label: "Business",
    description: "Run customer, people, finance, compliance, and portal operations.",
    items: [
      {
        key: "finance",
        label: "Finance",
        href: "/finance",
        description: "Cashflow, receivables, payables, and close.",
        sectionKey: "business",
        capabilityKey: "view_finance",
      },
      {
        key: "compliance",
        label: "Compliance",
        href: "/compliance",
        description: "Controls, risk, obligations, and posture.",
        sectionKey: "business",
        capabilityKey: "view_compliance",
      },
    ],
  },
];

describe("AppRail", () => {
  it("renders grouped sections and keeps the active marker", () => {
    pathname = "/finance";
    const html = renderToStaticMarkup(<AppRail sections={sections} />);

    expect(html).toContain(">Workspace<");
    expect(html).toContain(">Business<");
    expect(html).toContain(">Finance<");
    expect(html).toContain(">Compliance<");
    expect(html).toContain(">Here<");
  });

  it("keeps the persistent rail compact instead of rendering long item descriptions", () => {
    pathname = "/finance";
    const html = renderToStaticMarkup(<AppRail sections={sections} />);

    expect(html).not.toContain("See what needs attention next.");
    expect(html).not.toContain("Cashflow, receivables, payables, and close.");
    expect(html).not.toContain("Controls, risk, obligations, and posture.");
  });
});
