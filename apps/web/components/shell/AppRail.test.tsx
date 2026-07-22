import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let pathname = "/finance";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ refresh: () => {} }),
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
        orgCapabilityKey: null,
        audienceModes: ["worker", "operator"],
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
        orgCapabilityKey: null,
        audienceModes: ["worker", "operator"],
      },
      {
        key: "compliance",
        label: "Compliance",
        href: "/compliance",
        description: "Controls, risk, obligations, and posture.",
        sectionKey: "business",
        capabilityKey: "view_compliance",
        orgCapabilityKey: null,
        audienceModes: ["worker", "operator"],
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

  it("wraps the grouped rail on small screens and uses a vertical rail on desktop", () => {
    // BI-882B3680: the mobile rail must wrap (not force a single wide
    // horizontal-scroll row) so a 390px viewport never overflows the page.
    pathname = "/finance";
    const html = renderToStaticMarkup(<AppRail sections={sections} />);

    expect(html).toContain("flex-wrap");
    expect(html).not.toContain("overflow-x-auto");
    expect(html).not.toContain("min-w-max");
    expect(html).toContain("lg:grid");
    expect(html).toContain("whitespace-nowrap");
  });

  it("renders the worker/operator mode toggle reflecting the active mode", () => {
    pathname = "/finance";
    const html = renderToStaticMarkup(<AppRail sections={sections} mode="worker" />);

    expect(html).toContain(">Simple<");
    expect(html).toContain(">Full<");
    // In worker mode, "Simple" is the pressed control.
    const simpleIdx = html.indexOf(">Simple<");
    const buttonStart = html.lastIndexOf("<button", simpleIdx);
    expect(html.slice(buttonStart, simpleIdx)).toContain('aria-pressed="true"');
  });

  it("defaults to operator (full) mode when no mode is passed", () => {
    pathname = "/finance";
    const html = renderToStaticMarkup(<AppRail sections={sections} />);
    const fullIdx = html.indexOf(">Full<");
    const buttonStart = html.lastIndexOf("<button", fullIdx);
    expect(html.slice(buttonStart, fullIdx)).toContain('aria-pressed="true"');
  });
});
